import * as SecureStore from 'expo-secure-store';

/**
 * "Lembrar-me" da tela de login — pré-preenche e-mail/senha na próxima vez que a tela de login
 * aparecer (sessão revogada por outro login, token expirado), pra não redigitar tudo de novo.
 * Mesmo mecanismo de tokenStorage.ts (SecureStore, criptografado no Keychain/Keystore do
 * aparelho), guardado como um JSON único em vez de duas chaves separadas — mais simples de
 * limpar tudo de uma vez.
 *
 * Só existe quando o promotor marca a opção na tela de login (ver LoginScreen) — nunca é
 * automático. Isso importa especialmente no cenário de aparelho compartilhado entre promotores
 * (mesmo raciocínio de `limparCacheLocal`, docs/04-APP-MOBILE.md "Aparelho compartilhado"): um
 * logout explícito limpa isso (ver AuthContext::logout) — guardar a SENHA de alguém (não só o
 * e-mail) sobrevivendo a um logout de propósito deixaria a próxima pessoa entrar na conta
 * anterior só de tocar "Entrar", sem nunca saber a senha.
 */
const STORAGE_KEY = 'pdv_mobile_credenciais';

export interface CredenciaisSalvas {
  email: string;
  senha: string;
}

export const credenciaisStorage = {
  async get(): Promise<CredenciaisSalvas | null> {
    const valor = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!valor) return null;

    try {
      return JSON.parse(valor) as CredenciaisSalvas;
    } catch {
      return null; // formato inesperado (ex.: versão antiga do app) — trata como se não tivesse nada salvo
    }
  },
  async set(credenciais: CredenciaisSalvas): Promise<void> {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(credenciais));
  },
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  },
};
