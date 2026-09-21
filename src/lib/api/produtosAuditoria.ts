import type { ProdutoCatalogo } from '../../types/api';
import { apiClient } from './client';

// Busca no catálogo pra escolher o que vincular ao sortimento ("+ adicionar produto loja") —
// ação online, sem cache local (o promotor já precisa de rede pra vincular/cadastrar mesmo).
// Ver docs/14-SORTIMENTO-PONTO-VENDA.md §8/§9.
export interface FiltrosProdutosCatalogo {
  busca?: string;
  departamentoUuid?: string | null;
  secaoUuid?: string | null;
  marcaUuid?: string | null;
}

export interface PaginaProdutosCatalogo {
  produtos: ProdutoCatalogo[];
  paginaAtual: number;
  ultimaPagina: number;
}

// `busca` bate em nome, código de barras ou código externo (docs/27-BUSCA-MULTIPLA-DE-PRODUTOS.md).
// Paginado no servidor — o modal pede a próxima página ao rolar até o fim.
export async function listarProdutosCatalogo(
  filtros: FiltrosProdutosCatalogo = {},
  pagina = 1,
): Promise<PaginaProdutosCatalogo> {
  const { data } = await apiClient.get<{
    produtos: ProdutoCatalogo[];
    meta: { current_page: number; last_page: number };
  }>('/produtos-auditoria', {
    params: {
      ativo: 1,
      busca: filtros.busca || undefined,
      departamento_uuid: filtros.departamentoUuid || undefined,
      secao_uuid: filtros.secaoUuid || undefined,
      marca_uuid: filtros.marcaUuid || undefined,
      page: pagina,
    },
  });
  return { produtos: data.produtos, paginaAtual: data.meta.current_page, ultimaPagina: data.meta.last_page };
}

export interface CriarProdutoProprioPayload {
  descricao: string;
  codigo_barras?: string;
  propriedade: 'PROPRIA' | 'CONCORRENTE';
}

// Self-service (mobile): o promotor cadastra um produto que ainda não existe no catálogo,
// durante a visita ("ou ele mesmo cadastrar") — nasce ativo (modo AUTONOMO) ou pendente/inativo
// até um gestor decidir (modo REQUER_APROVACAO, default). Ver
// docs/14-SORTIMENTO-PONTO-VENDA.md §9.
export async function criarProdutoProprio(payload: CriarProdutoProprioPayload): Promise<ProdutoCatalogo> {
  const { data } = await apiClient.post<{ produto: ProdutoCatalogo }>('/produtos-auditoria/proprio', payload);
  return data.produto;
}
