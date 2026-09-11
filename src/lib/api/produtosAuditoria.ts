import type { ProdutoCatalogo } from '../../types/api';
import { apiClient } from './client';

// Busca no catálogo pra escolher o que vincular ao sortimento ("+ adicionar produto loja") —
// ação online, sem cache local (o promotor já precisa de rede pra vincular/cadastrar mesmo).
// Ver docs/14-SORTIMENTO-PONTO-VENDA.md §8/§9.
export async function listarProdutosCatalogo(busca?: string): Promise<ProdutoCatalogo[]> {
  const { data } = await apiClient.get<{ produtos: ProdutoCatalogo[] }>('/produtos-auditoria', {
    params: { ativo: 1, busca: busca || undefined },
  });
  return data.produtos;
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
