import type { ProdutoSortimento, RecortesDoMix } from './api/campoSortimento';
import type { TipoRegistro } from '../types/api';

// Formulário em que o promotor escolhe onde é o registro (marca/departamento/seção) e o Mix segue
// essa escolha — docs/79-CHECKLIST-MIX-POR-ESCOLHA-DO-PROMOTOR.md. Funções puras pra serem
// testáveis; a tela fica em components/RegistroFormModal.tsx.

export type TipoRecorte = 'MARCA' | 'DEPARTAMENTO' | 'SECAO';

export interface RecorteEscolhido {
  tipo: TipoRecorte;
  uuid: string;
  descricao: string;
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

/** Produtos do mix que caem no recorte escolhido. Marca = os departamentos ligados a ela. */
export function produtosDoRecorte(
  produtos: ProdutoSortimento[],
  recorte: RecorteEscolhido,
  recortes: RecortesDoMix | undefined,
): ProdutoSortimento[] {
  if (recorte.tipo === 'SECAO') return produtos.filter((p) => p.secao_uuid === recorte.uuid);
  if (recorte.tipo === 'DEPARTAMENTO') return produtos.filter((p) => p.departamento_uuid === recorte.uuid);
  const departamentos = new Set(recortes?.marcas.find((m) => m.uuid === recorte.uuid)?.departamentos_uuids ?? []);
  return produtos.filter((p) => !!p.departamento_uuid && departamentos.has(p.departamento_uuid));
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
