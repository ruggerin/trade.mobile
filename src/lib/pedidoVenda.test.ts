import type { Usuario } from '../types/api';
import { numeroDigitado, paraCampo, podeTirarPedido, precoMinimo } from './pedidoVenda';

describe('pedidoVenda', () => {
  it('preço mínimo = tabela × (1 − desconto máximo), desconto nulo = 0', () => {
    expect(precoMinimo(10, 10)).toBe(9);
    expect(precoMinimo(12.9, 7.5)).toBe(11.93);
    expect(precoMinimo(5, null)).toBe(5);
  });

  it('entende o que o teclado do celular manda', () => {
    expect(numeroDigitado('10,50')).toBe(10.5);
    expect(numeroDigitado('1.234,56')).toBe(1234.56);
    expect(numeroDigitado('10.5')).toBe(10.5);
    expect(numeroDigitado(' 3 ')).toBe(3);
    expect(numeroDigitado('')).toBeNaN();
    expect(numeroDigitado('abc')).toBeNaN();
  });

  it('volta pro campo em pt-BR', () => {
    expect(paraCampo(2)).toBe('2');
    expect(paraCampo(2.5)).toBe('2,5');
    expect(paraCampo(10, 2)).toBe('10,00');
  });

  it('modo Vendedor = perfil com pedidos_venda.criar numa empresa com o módulo', () => {
    const empresa = { id: 'e', razao_social: 'X', nome_fantasia: 'X', cnpj: '1', ativo: true, pedidos_venda_habilitado: true };
    const base = {
      id: '1', nome: 'A', email: 'a@a', user_type: 'PROMOTOR', ativo: true, avatar_url: null, foto_url: null, empresa,
    } as Usuario;
    const vendedor = { id: 'p', nome: 'Vendedor', permissoes: ['pedidos_venda.criar'] };
    expect(podeTirarPedido({ ...base, perfil: vendedor, empresa: { ...empresa, pedidos_venda_habilitado: false } })).toBe(false);
    expect(podeTirarPedido(null)).toBe(false);
    expect(podeTirarPedido(base)).toBe(false);
    expect(podeTirarPedido({ ...base, perfil: { id: 'p', nome: 'Vendedor', permissoes: ['pedidos_venda.criar'] } })).toBe(true);
    expect(podeTirarPedido({ ...base, perfil: { id: 'p', nome: 'Visual', permissoes: ['pedidos_venda.visualizar'] } })).toBe(false);
  });
});
