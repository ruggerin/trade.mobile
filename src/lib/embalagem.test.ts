import { descreverEmbalagem, precoPorReferencia, quantidadeDigitada } from './embalagem';

describe('embalagem (docs/85)', () => {
  it('lê a quantidade digitada com vírgula ou ponto', () => {
    expect(quantidadeDigitada('1,5')).toBe(1.5);
    expect(quantidadeDigitada('500')).toBe(500);
    expect(quantidadeDigitada('0')).toBeNull();
    expect(quantidadeDigitada('abc')).toBeNull();
  });

  it('descreve a embalagem', () => {
    expect(descreverEmbalagem(500, 'ML')).toBe('500 ml');
    expect(descreverEmbalagem(1.5, 'L')).toBe('1,5 L');
    expect(descreverEmbalagem(null, 'L')).toBeNull();
    expect(descreverEmbalagem(2, 'XX')).toBeNull();
  });

  it('calcula R$ por litro/kg e não calcula pra unidade avulsa', () => {
    expect(precoPorReferencia(12, 500, 'ML')).toEqual({ valor: 24, referencia: 'L' });
    expect(precoPorReferencia(5.99, 2, 'L')).toEqual({ valor: 3, referencia: 'L' });
    expect(precoPorReferencia(10, 250, 'G')).toEqual({ valor: 40, referencia: 'kg' });
    expect(precoPorReferencia(3, 1, 'UN')).toBeNull();
    expect(precoPorReferencia(null, 1, 'L')).toBeNull();
  });
});
