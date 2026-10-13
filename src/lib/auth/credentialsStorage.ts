import * as SecureStore from 'expo-secure-store';

/**
 * "Lembrar meu e-mail" da tela de login — pré-preenche só o e-mail (docs/67 §4.5). A senha não é
 * mais guardada: com ela salva, dois promotores revezavam o mesmo login em dois aparelhos com um
 * toque. O retorno rápido ao app agora é o desbloqueio por biometria (`biometria`), que libera o
 * token já salvo sem reenviar senha nenhuma — ver AuthContext.
 *
 * Só existe quando o promotor marca a opção na tela de login. Logout explícito limpa tudo (aparelho
 * compartilhado: docs/04-APP-MOBILE.md "Aparelho compartilhado").
 */
const STORAGE_KEY = 'pdv_mobile_credenciais';

export interface CredenciaisSalvas {
  email: string;
  /** Pedir digital/rosto ao abrir o app com sessão ativa. */
  biometria: boolean;
}

export const credenciaisStorage = {
  async get(): Promise<CredenciaisSalvas | null> {
    const valor = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!valor) return null;

    try {
      const salvas = JSON.parse(valor) as Partial<CredenciaisSalvas> & { senha?: string };
      if (!salvas.email) return null;
      // Versão antiga guardava a senha — regrava sem ela.
      if (salvas.senha !== undefined) {
        await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ email: salvas.email, biometria: false }));
      }
      return { email: salvas.email, biometria: Boolean(salvas.biometria) };
    } catch {
      return null; // formato inesperado — trata como se não tivesse nada salvo
    }
  },
  async set(credenciais: CredenciaisSalvas): Promise<void> {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(credenciais));
  },
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  },
};
