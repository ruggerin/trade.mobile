import type { PaginatedMeta, PedidoVenda, StatusPedidoVenda } from '../../types/api';
import { apiClient } from './client';

// Pedido de Venda ("modo Vendedor") — ação online na v1, sem fila offline: preço mínimo e
// autorização são decididos no servidor na hora (docs/38-PEDIDO-VENDEDOR.md §8). Ver
// App\Http\Controllers\PedidoVendaController.

export interface PedidosVendaListResponse {
  pedidos_venda: PedidoVenda[];
  meta: PaginatedMeta;
}

export async function listarMeusPedidosVenda(
  filtros: { status?: StatusPedidoVenda[]; visita_uuid?: string; page?: number } = {},
): Promise<PedidosVendaListResponse> {
  const { data } = await apiClient.get<PedidosVendaListResponse>('/pedidos-venda', { params: filtros });
  return data;
}

// O que o usuário pode fazer AGORA com o pedido — calculado no backend.
export interface PermissoesPedidoVenda {
  editar: boolean;
  enviar: boolean;
  aprovar: boolean;
  concluir: boolean;
  cancelar: boolean;
  e_autor: boolean;
}

export interface PedidoVendaDetailResponse {
  pedido_venda: PedidoVenda;
  permissoes: PermissoesPedidoVenda;
}

export async function buscarPedidoVenda(uuid: string): Promise<PedidoVendaDetailResponse> {
  const { data } = await apiClient.get<PedidoVendaDetailResponse>(`/pedidos-venda/${uuid}`);
  return data;
}

export interface ItemPedidoVendaPayload {
  produto_uuid: string;
  quantidade: number;
  preco: number;
}

export async function criarPedidoVenda(payload: {
  ponto_venda_uuid: string;
  visita_uuid?: string | null;
  observacao?: string | null;
  itens: ItemPedidoVendaPayload[];
}): Promise<PedidoVendaDetailResponse> {
  const { data } = await apiClient.post<PedidoVendaDetailResponse>('/pedidos-venda', payload);
  return data;
}

// Lista de itens sempre inteira — substitui a anterior.
export async function atualizarPedidoVenda(
  uuid: string,
  payload: { observacao?: string | null; itens: ItemPedidoVendaPayload[] },
): Promise<PedidoVendaDetailResponse> {
  const { data } = await apiClient.put<PedidoVendaDetailResponse>(`/pedidos-venda/${uuid}`, payload);
  return data;
}

export async function acaoPedidoVenda(
  uuid: string,
  acao: 'enviar' | 'concluir' | 'cancelar',
  motivo?: string,
): Promise<PedidoVendaDetailResponse> {
  const { data } = await apiClient.post<PedidoVendaDetailResponse>(
    `/pedidos-venda/${uuid}/${acao}`,
    motivo ? { motivo } : {},
  );
  return data;
}
