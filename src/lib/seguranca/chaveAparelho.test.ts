import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha2';
import { utf8ToBytes } from '@noble/hashes/utils';

// O formato da assinatura precisa bater byte a byte com EnsureAssinaturaAparelho (API) — conferido
// também contra o openssl do PHP e no celular de verdade em 12/10/2026.

const mockMemoria = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockMemoria.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    mockMemoria.set(k, v);
  }),
}));
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256) }));

import { assinarRequisicao, caminhoDaRequisicao, chavePublicaBase64, sha256Hex } from './chaveAparelho';

const base64ParaBytes = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));

describe('caminhoDaRequisicao', () => {
  it.each([
    ['http://192.168.0.10:8000/api', '/visitas', '/api/visitas'],
    ['http://127.0.0.1:8010/api/', 'auth/me', '/api/auth/me'],
    ['https://trade.exemplo.com.br/api', '/pontos-venda?pagina=2', '/api/pontos-venda'],
    [undefined, 'https://trade.exemplo.com.br/api/usuarios/x/foto?v=3', '/api/usuarios/x/foto'],
  ])('%s + %s → %s', (base, url, esperado) => {
    expect(caminhoDaRequisicao(base, url)).toBe(esperado);
  });
});

describe('assinarRequisicao', () => {
  it('assina "MÉTODO\\n/caminho\\ntimestamp\\nsha256(segredo do token)" com a chave do aparelho', async () => {
    const token = '42|segredoDoToken';
    const headers = await assinarRequisicao('get', '/api/auth/me', token);
    const mensagem = `GET\n/api/auth/me\n${headers['X-Assinatura-Em']}\n${sha256Hex('segredoDoToken')}`;
    const publica = base64ParaBytes(await chavePublicaBase64());

    expect(publica).toHaveLength(65);
    expect(publica[0]).toBe(4);
    expect(Math.abs(Number(headers['X-Assinatura-Em']) - Date.now() / 1000)).toBeLessThan(5);
    const assinatura = p256.Signature.fromDER(base64ParaBytes(headers['X-Assinatura']));
    expect(p256.verify(assinatura.toCompactRawBytes(), sha256(utf8ToBytes(mensagem)), publica, { prehash: false })).toBe(true);
  });

  it('a mesma chave é reaproveitada entre aberturas do app', async () => {
    expect(await chavePublicaBase64()).toBe(await chavePublicaBase64());
  });
});
