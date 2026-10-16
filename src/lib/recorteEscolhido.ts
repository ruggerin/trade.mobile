import type { ProdutoSortimento, RecortesDoMix } from './api/campoSortimento';
import { cobreRecorte } from './acaoObrigatoria';
import type { CatalogoItem, SortimentoPontoVenda, TipoRegistro } from '../types/api';

// Formulário em que o promotor escolhe onde é o registro (marca/departamento/seção) e o Mix segue
// essa escolha — docs/79-CHECKLIST-MIX-POR-ESCOLHA-DO-PROMOTOR.md. Funções puras pra serem
// testáveis; a tela fica em components/RegistroFormModal.tsx.

export type TipoRecorte = 'MARCA' | 'DEPARTAMENTO' | 'SECAO';

export interface RecorteEscolhido {
  tipo: TipoRecorte;
  uuid: string;
  descricao: string;
  // Filtro de marca depois da seção/departamento (docs/82 §5.2): "Biscoito · Piraquê".
  // null/ausente = "Todas".
  marca?: { uuid: string; descricao: string } | null;
}

/** "Biscoito · Piraquê" — ou só o recorte, sem filtro de marca. */
export function descricaoRecorte(recorte: RecorteEscolhido): string {
  return recorte.marca ? `${recorte.descricao} · ${recorte.marca.descricao}` : recorte.descricao;
}

export const ROTULO_RECORTE: Record<TipoRecorte, string> = {
  MARCA: 'Marca',
  DEPARTAMENTO: 'Departamento',
  SECAO: 'Seção',
};

/** Recortes que o formulário deixa escolher, na ordem das abas. Vazio = não pede escolha. */
export function recortesPermitidos(tipo: Pick<TipoRegistro, 'escolhe_marca' | 'escolhe_departamento' | 'escolhe_secao'>): TipoRecorte[] {
  return [
    tipo.escolhe_marca ? ('MARCA' as const) : null,
    tipo.escolhe_departamento ? ('DEPARTAMENTO' as const) : null,
    tipo.escolhe_secao ? ('SECAO' as const) : null,
  ].filter((t): t is TipoRecorte => t !== null);
}

/**
 * Produtos do mix que caem no recorte escolhido. Marca = a marca do próprio produto (docs/82
 * §5.3); com filtro de marca, a interseção. Cache antigo sem `marca_uuid` no produto cai no
 * critério antigo (departamentos ligados à marca) e ignora o filtro, até recarregar online.
 */
export function produtosDoRecorte(
  produtos: ProdutoSortimento[],
  recorte: RecorteEscolhido,
  recortes: RecortesDoMix | undefined,
): ProdutoSortimento[] {
  const semMarcaNoCache = produtos.length > 0 && produtos.every((p) => p.marca_uuid === undefined);
  const daMarca = (p: ProdutoSortimento, marca: string) => p.marca_uuid === marca;

  let lista: ProdutoSortimento[];
  if (recorte.tipo === 'SECAO') lista = produtos.filter((p) => p.secao_uuid === recorte.uuid);
  else if (recorte.tipo === 'DEPARTAMENTO') lista = produtos.filter((p) => p.departamento_uuid === recorte.uuid);
  else if (semMarcaNoCache) {
    const departamentos = new Set(recortes?.marcas.find((m) => m.uuid === recorte.uuid)?.departamentos_uuids ?? []);
    lista = produtos.filter((p) => !!p.departamento_uuid && departamentos.has(p.departamento_uuid));
  } else lista = produtos.filter((p) => daMarca(p, recorte.uuid));

  return recorte.marca && recorte.tipo !== 'MARCA' && !semMarcaNoCache ? lista.filter((p) => daMarca(p, recorte.marca!.uuid)) : lista;
}

// ---------------------------------------------------------------------------------------------
// docs/82 — "Onde é este registro?": o que a loja tem primeiro, só o que ela tem, e marca depois.

export interface OpcaoRecorte {
  uuid: string;
  descricao: string;
  /** Seção: o departamento dela (título do grupo e "departamento cobre a seção"). */
  departamento: { uuid: string; descricao: string } | null;
}

/**
 * Opções de uma aba: o catálogo (cache offline); sem catálogo, o que o Mix do campo trouxe.
 * Em ordem alfabética (decisão 6).
 */
export function opcoesDaAba(aba: TipoRecorte, catalogo: CatalogoItem[], recortesDoMix: RecortesDoMix | undefined): OpcaoRecorte[] {
  let opcoes: OpcaoRecorte[] = catalogo.map((c) => ({
    uuid: c.id,
    descricao: c.descricao,
    departamento: c.departamento ? { uuid: c.departamento.id, descricao: c.departamento.descricao } : null,
  }));
  if (opcoes.length === 0 && recortesDoMix) {
    const deptos = new Map(recortesDoMix.departamentos.map((d) => [d.uuid, d.descricao]));
    opcoes =
      aba === 'MARCA'
        ? recortesDoMix.marcas.map((m) => ({ uuid: m.uuid, descricao: m.descricao, departamento: null }))
        : aba === 'DEPARTAMENTO'
          ? recortesDoMix.departamentos.map((d) => ({ uuid: d.uuid, descricao: d.descricao, departamento: null }))
          : recortesDoMix.secoes.map((s) => ({
              uuid: s.uuid,
              descricao: s.descricao,
              departamento: s.departamento_uuid ? { uuid: s.departamento_uuid, descricao: deptos.get(s.departamento_uuid) ?? '' } : null,
            }));
  }
  return opcoes.sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'));
}

/** Itens aprovados do Mix da loja — pendente de aprovação não conta (docs/80 decisão 3). */
export function mixAprovado(mix: SortimentoPontoVenda[] | undefined): SortimentoPontoVenda[] {
  return (mix ?? []).filter((i) => !i.status_aprovacao);
}

/**
 * A opção está "Na loja"? Algum item aprovado do Mix cobre o recorte (mesma regra da linha
 * ausente) — ou ela veio no `recortes` do Mix do campo, que só tem o que a loja tem.
 */
export function estaNaLoja(
  aba: TipoRecorte,
  opcao: OpcaoRecorte,
  aprovados: SortimentoPontoVenda[],
  recortesDoMix: RecortesDoMix | undefined,
): boolean {
  if (aprovados.some((item) => cobreRecorte(aba, opcao.uuid, opcao.departamento?.uuid ?? null, item))) return true;
  if (!recortesDoMix) return false;
  const lista = aba === 'MARCA' ? recortesDoMix.marcas : aba === 'DEPARTAMENTO' ? recortesDoMix.departamentos : recortesDoMix.secoes;
  return lista.some((r) => r.uuid === opcao.uuid);
}

/**
 * Marcas que a loja tem dentro da seção/departamento escolhido (chips do passo 2, docs/82 §5.2):
 * dos produtos do Mix do campo e dos itens de produto do Mix em cache. Nomes pelo catálogo de
 * marcas quando o item não traz.
 */
export function marcasNaLoja(
  recorte: RecorteEscolhido,
  produtosDoMixDoCampo: ProdutoSortimento[],
  aprovados: SortimentoPontoVenda[],
  catalogoMarcas: CatalogoItem[],
): { uuid: string; descricao: string }[] {
  const nomes = new Map(catalogoMarcas.map((m) => [m.id, m.descricao]));
  const marcas = new Map<string, string>();
  const dentro = (secao: string | null | undefined, departamento: string | null | undefined) =>
    recorte.tipo === 'SECAO' ? secao === recorte.uuid : recorte.tipo === 'DEPARTAMENTO' ? departamento === recorte.uuid : false;

  for (const p of produtosDoMixDoCampo) {
    if (p.marca_uuid && dentro(p.secao_uuid, p.departamento_uuid)) marcas.set(p.marca_uuid, p.marca_descricao ?? nomes.get(p.marca_uuid) ?? '');
  }
  for (const item of aprovados) {
    const p = item.produto;
    if (item.tipo_item === 'PRODUTO' && p?.marca_uuid && dentro(p.secao_uuid, p.departamento_uuid)) {
      marcas.set(p.marca_uuid, marcas.get(p.marca_uuid) || nomes.get(p.marca_uuid) || '');
    }
  }
  return [...marcas.entries()]
    .filter(([, descricao]) => descricao !== '')
    .map(([uuid, descricao]) => ({ uuid, descricao }))
    .sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'));
}

export interface GrupoChecklist {
  chave: string;
  titulo: string;
  // Departamento acima da seção quando o recorte é uma marca (decisão 4).
  supertitulo: string | null;
  produtos: ProdutoSortimento[];
}

/**
 * Agrupamento do checklist (docs/79 decisão 4): seção → lista simples (um grupo sem título);
 * departamento → por seção; marca → por departamento e seção. Grupos e produtos em ordem
 * alfabética.
 */
export function agruparChecklist(produtos: ProdutoSortimento[], tipo: TipoRecorte): GrupoChecklist[] {
  if (tipo === 'SECAO') return [{ chave: 'todos', titulo: '', supertitulo: null, produtos }];

  const grupos = new Map<string, GrupoChecklist>();
  for (const p of produtos) {
    const secao = p.secao_descricao ?? 'Sem seção';
    const departamento = p.departamento_descricao ?? 'Sem departamento';
    const chave = tipo === 'MARCA' ? `${departamento}|${secao}` : secao;
    const grupo = grupos.get(chave) ?? { chave, titulo: secao, supertitulo: tipo === 'MARCA' ? departamento : null, produtos: [] };
    grupo.produtos.push(p);
    grupos.set(chave, grupo);
  }
  return [...grupos.values()].sort((a, b) =>
    `${a.supertitulo ?? ''}|${a.titulo}`.localeCompare(`${b.supertitulo ?? ''}|${b.titulo}`, 'pt-BR'),
  );
}
