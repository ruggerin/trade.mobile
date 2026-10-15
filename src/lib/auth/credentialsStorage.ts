import * as SecureStore from 'expo-secure-store';

/**
 * "Lembrar meu e-mail" da tela de login — pré-preenche só o e-mail (docs/67 §4.5). A senha não é
 * mais guardada: com ela salva, dois promotores revezavam o mesmo login em dois aparelhos com um
 * toque. O retorno rápido ao app agora é o desbloqueio por biometria (lib/auth/biometria.ts), que
 * libera o token já salvo sem reenviar senha nenhuma.
 *
 * Só existe quando o promotor marca a opção na tela de login. Logout explícito limpa tudo (aparelho
 * compartilhado: docs/04-APP-MOBILE.md "Aparelho compartilhado").
 */
const STORAGE_KEY = 'pdv_mobile_credenciais';

export interface CredenciaisSalvas {
  email: string;
}

export const credenciaisStorage = {
  async get(): Promise<CredenciaisSalvas | null> {
    const valor = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!valor) return null;

    try {
      const salvas = JSON.parse(valor) as Partial<CredenciaisSalvas> & { senha?: string; biometria?: boolean };
      if (!salvas.email) return null;
      // Versões antigas guardavam a senha e o checkbox de biometria — regrava só com o e-mail.
      if (salvas.senha !== undefined || salvas.biometria !== undefined) {
        await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ email: salvas.email }));
      }
      return { email: salvas.email };
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
