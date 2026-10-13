import * as SecureStore from 'expo-secure-store';

// Único ponto de leitura/escrita do token — equivalente nativo de
// admin/src/lib/auth/tokenStorage.ts, mas assíncrono (SecureStore não tem API síncrona, ao
// contrário do localStorage do browser).
const STORAGE_KEY = 'pdv_mobile_token';
// Quando o token atual foi emitido (login ou refresh) — o token do app vence em 7 dias e é
// renovado antes disso, ver renovacaoSessao.ts e docs/67 §4.4.
const EMITIDO_EM_KEY = 'pdv_mobile_token_emitido_em';

export const tokenStorage = {
  async get(): Promise<string | null> {
    return SecureStore.getItemAsync(STORAGE_KEY);
  },
  async set(token: string): Promise<void> {
    await SecureStore.setItemAsync(STORAGE_KEY, token);
    await SecureStore.setItemAsync(EMITIDO_EM_KEY, String(Date.now()));
  },
  /** Momento (ms) em que o token atual foi emitido; null pra token salvo antes da docs/67. */
  async emitidoEm(): Promise<number | null> {
    const valor = await SecureStore.getItemAsync(EMITIDO_EM_KEY);
    return valor ? Number(valor) : null;
  },
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
    await SecureStore.deleteItemAsync(EMITIDO_EM_KEY);
  },
};
