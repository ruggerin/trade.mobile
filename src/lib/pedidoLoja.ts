import type { AvisoPedido, PedidoLoja, StatusPedidoLoja } from './api/historicoLoja';

// Apresentação do pedido do ERP (docs/54-DETALHE-PEDIDO-PREVISAO-E-NOTIFICACAO.md) — compartilhada
// entre o cartão da aba "Histórico da loja" e a tela de detalhe.

/**
 * "03/10" de uma data pura (YYYY-MM-DD) SEM passar por `new Date()`: meia-noite UTC vira o dia
 * anterior em fuso negativo (Manaus), e o cartão mostrava a data errada.
 */
export function diaMes(data: string): string {
  const [, mes, dia] = data.slice(0, 10).split('-');
  return `${dia}/${mes}`;
}

/** Data com hora (entrega confirmada) — essa sim é um instante, vai pelo fuso do aparelho. */
export function diaMesInstante(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** APK novo falando com API antiga (status PENDENTE): trata como a caminho. */
export function statusDoPedido(pedido: Pick<PedidoLoja, 'status'>): Exclude<StatusPedidoLoja, 'PENDENTE'> {
  return pedido.status === 'PENDENTE' ? 'A_CAMINHO' : pedido.status;
}

export function rotuloStatusPedido(pedido: PedidoLoja): string {
  const status = statusDoPedido(pedido);
  if (status === 'ENTREGUE') return pedido.entregue_em ? `Entregue ${diaMesInstante(pedido.entregue_em)}` : 'Entregue';
  if (status === 'ATRASADO') return 'Atrasado';
  return pedido.data_previsao_entrega ? `Chega ${diaMes(pedido.data_previsao_entrega)}` : 'A caminho';
}

/** "Pedido 123 a caminho da Loja X — chega 03/10" / "Pedido 123 chegou na Loja X". */
export function textoAvisoPedido(aviso: AvisoPedido): string {
  const loja = aviso.ponto_venda ? ` ${aviso.tipo === 'ENTREGUE' ? 'na' : 'para a'} ${aviso.ponto_venda}` : '';
  if (aviso.tipo === 'ENTREGUE') return `Pedido ${aviso.numero_pedido} chegou${loja}`;
  return `Pedido ${aviso.numero_pedido} a caminho${loja}${aviso.data_previsao ? ` — previsão ${diaMes(aviso.data_previsao)}` : ''}`;
}
