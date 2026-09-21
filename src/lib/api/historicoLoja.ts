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

export interface PedidoLoja {
  id: string;
  numero_pedido: string;
  numero_nf: string | null;
  data_pedido: string;
  status: 'PENDENTE' | 'ENTREGUE';
  entregue_em: string | null;
  itens: ItemPedido[];
}

// Pedidos do ERP gravados por um integrador — nunca têm valor monetário (promotor não vê preço).
export async function buscarPedidosLoja(pontoVendaUuid: string): Promise<PedidoLoja[]> {
  const { data } = await apiClient.get<{ pedidos: PedidoLoja[] }>(`/pontos-venda/${pontoVendaUuid}/pedidos`);
  return data.pedidos;
}
