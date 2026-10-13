import type { AvisoPedido, PedidoLoja } from './api/historicoLoja';
import { diaMes, rotuloStatusPedido, statusDoPedido, textoAvisoPedido } from './pedidoLoja';

// docs/54 — apresentação do pedido do ERP no app.

function pedido(extra: Partial<PedidoLoja> = {}): PedidoLoja {
  return {
    id: 'p1',
    numero_pedido: '7',
    numero_nf: null,
    data_pedido: '2026-09-29',
    data_previsao_entrega: null,
    status: 'A_CAMINHO',
    entregue_em: null,
    itens: [],
    ...extra,
  };
}

describe('pedido da loja', () => {
  it('data pura não "volta um dia" em fuso negativo (Manaus)', () => {
    expect(diaMes('2026-10-03')).toBe('03/10');
  });

  it('a caminho com previsão, sem previsão, atrasado e entregue', () => {
    expect(rotuloStatusPedido(pedido({ data_previsao_entrega: '2026-10-03' }))).toBe('Chega 03/10');
    expect(rotuloStatusPedido(pedido())).toBe('A caminho');
    expect(rotuloStatusPedido(pedido({ status: 'ATRASADO', data_previsao_entrega: '2026-09-30' }))).toBe('Atrasado');
    expect(rotuloStatusPedido(pedido({ status: 'ENTREGUE', entregue_em: null }))).toBe('Entregue');
  });

  it('API antiga (status PENDENTE) conta como a caminho', () => {
    expect(statusDoPedido(pedido({ status: 'PENDENTE' }))).toBe('A_CAMINHO');
  });
});

describe('aviso de pedido no sino', () => {
  const base: AvisoPedido = {
    id: 'a1',
    tipo: 'PREVISTO',
    pedido_id: 'p1',
    numero_pedido: '7',
    ponto_venda: 'Mercantil',
    data_previsao: '2026-10-03',
    em: '2026-10-01T15:00:00Z',
  };

  it('a caminho com a previsão', () => {
    expect(textoAvisoPedido(base)).toBe('Pedido 7 a caminho para a Mercantil — previsão 03/10');
  });

  it('chegou na loja', () => {
    expect(textoAvisoPedido({ ...base, tipo: 'ENTREGUE' })).toBe('Pedido 7 chegou na Mercantil');
  });
});
