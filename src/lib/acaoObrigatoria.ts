import type { PontoVenda, TipoRegistro } from '../types/api';

// Resolve se um TipoRegistro com acao_obrigatoria=true vira pendência ("Ação") nesta visita — por
// escopo (App\Enums\EscopoAcaoTipoRegistro no backend). Extraído de VisitaAndamentoScreen pra ser
// testável; o backend não cobra Ação no checkout, a regra vive só aqui.
//
// - SEMPRE: sempre.
// - CAMPANHA: alguma campanha desta visita bate com a do tipo.
// - CONTRATO: PDV com contrato ativo (booleano pronto do backend).
// - LOJA_REDE (docs/40-ACAO-OBRIGATORIA-LOJA-REDE.md): loja listada OU rede do PDV listada (OR);
//   as duas listas vazias = todas as lojas.
export function acaoValeNestaVisita(
  tipo: TipoRegistro,
  pontoVenda: Pick<PontoVenda, 'id' | 'rede_loja' | 'tem_contrato_ativo'> | null | undefined,
  campanhasDaVisita: Set<string>,
): boolean {
  if (!tipo.acao_obrigatoria) return false;

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
    default:
      return false;
  }
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
