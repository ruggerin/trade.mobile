import { estaNaLoja, mixAprovado, opcoesDaAba } from './recorteEscolhido';
import type { CatalogoItem, SortimentoPontoVenda, TipoRegistro } from '../types/api';

// "Cada seção / linha" como lista guiada (docs/100): o admin define o nível (seção, departamento ou
// marca) e a origem — o que a loja tem no Mix (calculado aqui, offline, com o Mix em cache) ou uma
// lista fixa que vem pronta da API. O promotor percorre linha por linha.

export interface LinhaGuiada {
  uuid: string;
  descricao: string;
}

/** null = formulário sem lista guiada (o promotor vincula livre, como antes). */
export function linhasDoFormulario(
  tipo: Pick<TipoRegistro, 'linha_nivel' | 'linha_origem' | 'linhas_fixas'>,
  catalogoDoNivel: CatalogoItem[],
  mix: SortimentoPontoVenda[] | undefined,
): LinhaGuiada[] | null {
  const nivel = tipo.linha_nivel;
  if (!nivel) return null;
  if (tipo.linha_origem === 'FIXA') return (tipo.linhas_fixas ?? []).map((l) => ({ uuid: l.id, descricao: l.descricao }));

  const aprovados = mixAprovado(mix);
  return opcoesDaAba(nivel, catalogoDoNivel, undefined)
    .filter((o) => estaNaLoja(nivel, o, aprovados, undefined))
    .map((o) => ({ uuid: o.uuid, descricao: o.descricao }));
}

/** Linhas que já viraram registro nesta visita (pelo vínculo do registro). */
export function linhasFeitas(
  registros: { tipoRegistroUuid: string; secaoUuid: string | null; departamentoUuid: string | null; marcaUuid: string | null }[],
  tipoRegistroUuid: string,
  nivel: 'SECAO' | 'DEPARTAMENTO' | 'MARCA',
): Set<string> {
  const coluna = nivel === 'SECAO' ? 'secaoUuid' : nivel === 'DEPARTAMENTO' ? 'departamentoUuid' : 'marcaUuid';
  return new Set(registros.filter((r) => r.tipoRegistroUuid === tipoRegistroUuid && r[coluna]).map((r) => r[coluna] as string));
}
