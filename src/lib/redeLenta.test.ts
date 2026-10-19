// Rede lenta: leitura com prazo antes do cache, foto reduzida na captura e timeout de envio
// proporcional ao tamanho.

jest.mock('./db/database', () => ({ ehErroDeRede: (err: { semRede?: boolean }) => Boolean(err?.semRede) }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('expo-file-system/legacy', () => ({ getInfoAsync: jest.fn() }));

import { dimensoesReduzidas, LADO_MAXIMO_FOTO_PX } from './compressaoFoto';
import { redeComPrazo } from './redeComPrazo';
import { TIMEOUT_ENVIO_BASE_MS, TIMEOUT_ENVIO_MAXIMO_MS, timeoutDeEnvio } from './timeoutEnvio';

const depois = <T,>(ms: number, valor: T) => new Promise<T>((resolve) => setTimeout(() => resolve(valor), ms));

describe('redeComPrazo', () => {
  it('rede dentro do prazo: usa a rede e grava no cache', async () => {
    const salvar = jest.fn(() => Promise.resolve());
    const dados = await redeComPrazo({ rede: () => depois(5, ['novo']), salvar, lerCache: async () => ['velho'], prazoMs: 50 });
    expect(dados).toEqual(['novo']);
    expect(salvar).toHaveBeenCalledWith(['novo']);
  });

  it('rede lenta com cache: responde com o cache no prazo e grava a rede quando ela chega', async () => {
    const salvar = jest.fn(() => Promise.resolve());
    const dados = await redeComPrazo({ rede: () => depois(80, ['novo']), salvar, lerCache: async () => ['velho'], prazoMs: 20 });
    expect(dados).toEqual(['velho']);
    expect(salvar).not.toHaveBeenCalled();
    await depois(100, null);
    expect(salvar).toHaveBeenCalledWith(['novo']);
  });

  it('rede lenta sem cache (ou lista vazia): espera a rede em vez de responder vazio', async () => {
    expect(await redeComPrazo({ rede: () => depois(40, ['novo']), lerCache: async () => [], prazoMs: 10 })).toEqual(['novo']);
    expect(await redeComPrazo({ rede: () => depois(40, 'novo'), lerCache: async () => null, prazoMs: 10 })).toBe('novo');
  });

  it('sem rede: cai pro cache; sem cache, repassa o erro', async () => {
    const semRede = { semRede: true };
    expect(await redeComPrazo({ rede: () => Promise.reject(semRede), lerCache: async () => ['velho'] })).toEqual(['velho']);
    await expect(redeComPrazo({ rede: () => Promise.reject(semRede), lerCache: async () => null })).rejects.toBe(semRede);
  });

  it('erro do servidor nunca é escondido atrás do cache', async () => {
    const erro = { response: { status: 500 } };
    await expect(redeComPrazo({ rede: () => Promise.reject(erro), lerCache: async () => ['velho'] })).rejects.toBe(erro);
  });

  it('rede que falha depois de o cache responder não vira rejeição solta', async () => {
    const dados = await redeComPrazo({
      rede: () => depois(30, null).then(() => Promise.reject({ semRede: true })),
      lerCache: async () => ['velho'],
      prazoMs: 10,
    });
    expect(dados).toEqual(['velho']);
    await depois(50, null);
  });
});

describe('dimensoesReduzidas', () => {
  it('reduz pelo lado maior e mantém a proporção', () => {
    expect(dimensoesReduzidas(4000, 3000)).toEqual({ width: LADO_MAXIMO_FOTO_PX });
    expect(dimensoesReduzidas(3000, 4000)).toEqual({ height: LADO_MAXIMO_FOTO_PX });
  });

  it('não amplia foto pequena nem mexe sem dimensão', () => {
    expect(dimensoesReduzidas(1200, 900)).toBeNull();
    expect(dimensoesReduzidas(0, 0)).toBeNull();
  });
});

describe('timeoutDeEnvio', () => {
  it('cresce com o tamanho, entre o mínimo e o teto', () => {
    expect(timeoutDeEnvio(0)).toBe(TIMEOUT_ENVIO_BASE_MS);
    expect(timeoutDeEnvio(200 * 1024)).toBe(45_000);
    expect(timeoutDeEnvio(5 * 1024 * 1024)).toBe(TIMEOUT_ENVIO_MAXIMO_MS);
  });
});
