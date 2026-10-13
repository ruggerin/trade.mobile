import { apiClient } from './client';

// Histórico da loja (docs/28-RELATORIOS-FEEDBACK-HISTORICO.md §4): só consulta, online. Sem cache
// local de propósito — é contexto "de bônus" ao entrar na loja, não pode travar nem quebrar o
// fluxo offline-first de visita; sem rede o cartão simplesmente não aparece.

export interface EventoHistorico {
  id: string;
  ocorrido_em: string;
  promotor: string | null;
  tipo_registro: string | null;
  produto: string | null;
  observacao: string | null;
  resolvido?: boolean;
}

export interface VisitaHistorico {
  id: string;
  inicio_data: string;
  fim_data: string | null;
  promotor: string | null;
}

export interface HistoricoLoja {
  visitas: VisitaHistorico[];
  rupturas: EventoHistorico[];
  alertas: EventoHistorico[];
}

export async function buscarHistoricoLoja(pontoVendaUuid: string): Promise<HistoricoLoja> {
  const { data } = await apiClient.get<{ historico: HistoricoLoja }>(`/pontos-venda/${pontoVendaUuid}/historico`);
  return data.historico;
}

export interface ItemPedido {
  id: string;
  descricao_produto: string;
  quantidade: number;
}

// Calculado no backend, nunca gravado (docs/54 §4): ATRASADO = previsão já passou sem entrega.
// PENDENTE só vem de API antiga (antes do doc 54) — tratado como a caminho.
export type StatusPedidoLoja = 'A_CAMINHO' | 'ATRASADO' | 'ENTREGUE' | 'PENDENTE';

export interface PedidoLoja {
  id: string;
  numero_pedido: string;
  numero_nf: string | null;
  // Datas puras (YYYY-MM-DD) — formatar com lib/pedidoLoja.diaMes, nunca com new Date().
  data_pedido: string;
  // Previsão de chegada mandada pelo ERP; null quando o ERP não manda.
  data_previsao_entrega?: string | null;
  observacao?: string | null;
  ponto_venda?: string | null;
  status: StatusPedidoLoja;
  entregue_em: string | null;
  itens: ItemPedido[];
  entregas?: { id: string; data_entrega: string; observacao: string | null }[];
}

// Pedidos do ERP gravados por um integrador — nunca têm valor monetário (promotor não vê preço).
export async function buscarPedidosLoja(pontoVendaUuid: string): Promise<PedidoLoja[]> {
  const { data } = await apiClient.get<{ pedidos: PedidoLoja[] }>(`/pontos-venda/${pontoVendaUuid}/pedidos`);
  return data.pedidos;
}

/** Um pedido só — tela de detalhe (aberta pelo cartão da loja ou pelo sino). */
export async function buscarPedido(pedidoUuid: string): Promise<PedidoLoja> {
  const { data } = await apiClient.get<{ pedido: PedidoLoja }>(`/pedidos/${pedidoUuid}`);
  return data.pedido;
}

/** Abriu o detalhe: os avisos desse pedido somem do sino. */
export async function marcarPedidoLido(pedidoUuid: string): Promise<void> {
  await apiClient.post(`/pedidos/${pedidoUuid}/lido`);
}

// Aviso no sino (docs/54 §5 Fase 3): PREVISTO = a caminho (ou previsão revisada); ENTREGUE.
export interface AvisoPedido {
  id: string;
  tipo: 'PREVISTO' | 'ENTREGUE';
  pedido_id: string;
  numero_pedido: string;
  ponto_venda: string | null;
  data_previsao: string | null;
  em: string;
}

export async function buscarAvisosPedido(): Promise<{ total: number; avisos: AvisoPedido[] }> {
  const { data } = await apiClient.get<{ total: number; avisos: AvisoPedido[] }>('/pedidos/notificacoes');
  return data;
}
