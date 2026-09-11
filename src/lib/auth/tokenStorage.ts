import * as SecureStore from 'expo-secure-store';

// Único ponto de leitura/escrita do token — equivalente nativo de
// admin/src/lib/auth/tokenStorage.ts, mas assíncrono (SecureStore não tem API síncrona, ao
// contrário do localStorage do browser).
const STORAGE_KEY = 'pdv_mobile_token';

export const tokenStorage = {
  async get(): Promise<string | null> {
    return SecureStore.getItemAsync(STORAGE_KEY);
  },
  async set(token: string): Promise<void> {
    await SecureStore.setItemAsync(STORAGE_KEY, token);
  },
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  },
};
