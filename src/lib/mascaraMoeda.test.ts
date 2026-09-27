import { mascararMoeda, moedaParaApi, numeroParaMoeda } from './mascaraMoeda';

describe('mascaraMoeda', () => {
  it('a vírgula anda sozinha conforme digita', () => {
    expect(mascararMoeda('1')).toBe('0,01');
    expect(mascararMoeda('12')).toBe('0,12');
    expect(mascararMoeda('125')).toBe('1,25');
    expect(mascararMoeda('1250')).toBe('12,50');
    expect(mascararMoeda('123456')).toBe('1.234,56');
    expect(mascararMoeda('123456789')).toBe('1.234.567,89');
  });

  it('reaplica em cima do valor já mascarado (é assim que o TextInput manda)', () => {
    // "12,50" + digitar 3 → "12,503" → "125,03"
    expect(mascararMoeda('12,503')).toBe('125,03');
    // apagar um dígito de "125,03" → "125,0" → "12,50"
    expect(mascararMoeda('125,0')).toBe('12,50');
  });

  it('zero ou vazio vira campo vazio (não fica "0,00" preso)', () => {
    expect(mascararMoeda('')).toBe('');
    expect(mascararMoeda('0,0')).toBe('');
    expect(mascararMoeda('abc')).toBe('');
  });

  it('converte pro formato da API e de volta', () => {
    expect(moedaParaApi('1.234,56')).toBe('1234.56');
    expect(moedaParaApi('0,05')).toBe('0.05');
    expect(moedaParaApi('')).toBe('');
    expect(numeroParaMoeda(10.5)).toBe('10,50');
    expect(numeroParaMoeda(1234.56)).toBe('1.234,56');
    expect(numeroParaMoeda(0.1 + 0.2)).toBe('0,30');
  });
});
