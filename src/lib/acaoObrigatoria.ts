import type { PontoVenda, SortimentoPontoVenda, TipoRegistro } from '../types/api';

// Resolve se um TipoRegistro com acao_obrigatoria=true vira pendência ("Ação") nesta visita — por
// escopo (App\Enums\EscopoAcaoTipoRegistro no backend). Extraído de VisitaAndamentoScreen pra ser
// testável; o backend não cobra Ação no checkout, a regra vive só aqui.
//
// - SEMPRE: sempre.
// - CAMPANHA: alguma campanha desta visita bate com a do tipo.
// - CONTRATO: PDV com contrato ativo (booleano pronto do backend).
// - LOJA_REDE (docs/40-ACAO-OBRIGATORIA-LOJA-REDE.md): loja listada OU rede do PDV listada (OR);
//   as duas listas vazias = todas as lojas.
// - LINHA_AUSENTE (docs/80-MONITORAMENTO-LINHA-AUSENTE.md §5.1): nenhum item aprovado do Mix cobre
//   o recorte do tipo. Mix vazio (ou ainda não carregado) não cobra. Mesma regra de
//   App\Support\LinhaAusente no backend.
// Antes do escopo, o filtro por ramo de atividade (docs/80 §5.4): com ramos no tipo, só lojas
// desses ramos — loja sem ramo cadastrado passa. E o intervalo (docs/80 §5.2): com intervalo_dias
// N, a Ação só volta N dias (de calendário) depois do último registro do formulário na loja.
// Registro feito nesta mesma visita não conta — senão a Ação sumiria em vez de aparecer feita.
export interface ContextoIntervalo {
  ultimosRegistros?: Record<string, string>;
  inicioVisita?: string;
  agora?: Date;
}

export function acaoValeNestaVisita(
  tipo: TipoRegistro,
  pontoVenda: (Pick<PontoVenda, 'id' | 'rede_loja' | 'tem_contrato_ativo'> & Partial<Pick<PontoVenda, 'ramo_atividade'>>) | null | undefined,
  campanhasDaVisita: Set<string>,
  mix?: SortimentoPontoVenda[],
  intervalo: ContextoIntervalo = {},
): boolean {
  if (!tipo.acao_obrigatoria) return false;
  if (dentroDoIntervalo(tipo, intervalo)) return false;

  const ramos = tipo.ramos_atividade_uuids ?? [];
  const ramoDaLoja = pontoVenda?.ramo_atividade?.id;
  if (ramos.length > 0 && ramoDaLoja && !ramos.includes(ramoDaLoja)) return false;

  switch (tipo.escopo_acao) {
    case 'SEMPRE':
      return true;
    case 'CAMPANHA':
      return !!tipo.campanha_auditoria_uuid && campanhasDaVisita.has(tipo.campanha_auditoria_uuid);
    case 'CONTRATO':
      return pontoVenda?.tem_contrato_ativo ?? false;
    case 'LOJA_REDE': {
      const lojas = tipo.pontos_venda_uuids ?? [];
      const redes = tipo.redes_lojas_uuids ?? [];
      if (lojas.length === 0 && redes.length === 0) return true;
      if (!pontoVenda) return false;
      const rede = pontoVenda.rede_loja?.id;
      return lojas.includes(pontoVenda.id) || (!!rede && redes.includes(rede));
    }
    case 'LINHA_AUSENTE':
      return linhaAusente(tipo, mix ?? []);
    default:
      return false;
  }
}

function dentroDoIntervalo(tipo: TipoRegistro, { ultimosRegistros, inicioVisita, agora = new Date() }: ContextoIntervalo): boolean {
  const dias = tipo.intervalo_dias ?? 0;
  const ultimo = ultimosRegistros?.[tipo.id];
  if (dias <= 0 || !ultimo) return false;
  const ultimoEm = new Date(ultimo);
  if (inicioVisita && ultimoEm >= new Date(inicioVisita)) return false;
  return diasDeCalendario(ultimoEm, agora) < dias;
}

/** Junta o último registro por formulário de duas fontes (servidor e fila do celular), ficando com o mais recente. */
export function juntarUltimosRegistros(...fontes: (Record<string, string> | undefined)[]): Record<string, string> {
  const resultado: Record<string, string> = {};
  for (const fonte of fontes) {
    for (const [tipo, data] of Object.entries(fonte ?? {})) {
      if (!resultado[tipo] || new Date(data) > new Date(resultado[tipo])) resultado[tipo] = data;
    }
  }
  return resultado;
}

/** Diferença em dias de calendário no fuso do aparelho (ontem 23h → hoje 8h = 1 dia). */
export function diasDeCalendario(de: Date, ate: Date): number {
  const inicioDoDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((inicioDoDia(ate) - inicioDoDia(de)) / 86_400_000);
}

// Item pendente/rejeitado não conta como linha presente (docs/80 decisão 3).
function linhaAusente(tipo: TipoRegistro, mix: SortimentoPontoVenda[]): boolean {
  const aprovados = mix.filter((i) => !i.status_aprovacao);
  if (aprovados.length === 0) return false;
  return !aprovados.some((item) => cobre(tipo, item));
}

function cobre(tipo: TipoRegistro, item: SortimentoPontoVenda): boolean {
  switch (tipo.escopo_tipo_vinculo) {
    case 'SECAO':
      return !tipo.escopo_secao || cobreRecorte('SECAO', tipo.escopo_secao.id, tipo.escopo_secao.departamento_uuid ?? null, item);
    case 'DEPARTAMENTO':
      return !tipo.escopo_departamento?.id || cobreRecorte('DEPARTAMENTO', tipo.escopo_departamento.id, null, item);
    case 'MARCA':
      return !tipo.escopo_marca?.id || cobreRecorte('MARCA', tipo.escopo_marca.id, null, item);
    default:
      // Sem recorte configurado (cache antigo): nada a levantar.
      return true;
  }
}

/**
 * O item do Mix cobre o recorte? Mesma regra do backend (LinhaAusente::cobreRecorte) — usada pela
 * linha ausente (docs/80) e pela lista "Na loja" (docs/82). `departamentoDaSecao`: só pra seção
 * (item de departamento cobre as seções dele).
 */
export function cobreRecorte(
  tipo: 'SECAO' | 'DEPARTAMENTO' | 'MARCA',
  uuid: string,
  departamentoDaSecao: string | null,
  item: SortimentoPontoVenda,
): boolean {
  const produto = item.produto;
  if (tipo === 'SECAO') {
    if (item.tipo_item === 'PRODUTO') return produto?.secao_uuid === uuid;
    if (item.tipo_item === 'SECAO') return item.secao?.id === uuid;
    if (item.tipo_item === 'DEPARTAMENTO') return !!departamentoDaSecao && item.departamento?.id === departamentoDaSecao;
    return false;
  }
  if (tipo === 'DEPARTAMENTO') {
    if (item.tipo_item === 'PRODUTO') return produto?.departamento_uuid === uuid;
    if (item.tipo_item === 'SECAO') return item.secao?.departamento_uuid === uuid;
    if (item.tipo_item === 'DEPARTAMENTO') return item.departamento?.id === uuid;
    return false;
  }
  if (item.tipo_item === 'PRODUTO') return produto?.marca_uuid === uuid;
  if (item.tipo_item === 'MARCA') return item.marca?.id === uuid;
  return false;
}

/**
 * Quantos produtos da lista predefinida já têm registro, e quantos a lista tem — null quando o
 * formulário não tem lista (aí vale a regra de sempre: um registro basta).
 */
export function progressoLista(
  tipo: Pick<TipoRegistro, 'granularidade_padrao' | 'produtos_predefinidos'>,
  produtosRegistrados: Iterable<string | null>,
): { feitos: number; total: number } | null {
  const lista = tipo.granularidade_padrao === 'PRODUTO' ? (tipo.produtos_predefinidos ?? []) : [];
  if (lista.length === 0) return null;
  const registrados = new Set(produtosRegistrados);
  return { feitos: lista.filter((p) => registrados.has(p.id)).length, total: lista.length };
}

// Ação feita: com lista predefinida, TODOS os produtos dela coletados (senão uma pesquisa de preço
// de 20 produtos contaria como feita no primeiro); sem lista, um registro basta.
export function acaoConcluida(
  tipo: Pick<TipoRegistro, 'granularidade_padrao' | 'produtos_predefinidos'>,
  registros: { produtoAuditoriaUuid: string | null }[],
): boolean {
  const progresso = progressoLista(tipo, registros.map((r) => r.produtoAuditoriaUuid));
  return progresso ? progresso.feitos === progresso.total : registros.length > 0;
}
