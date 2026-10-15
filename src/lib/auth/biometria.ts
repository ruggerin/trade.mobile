import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

/**
 * Desbloqueio por biometria ao abrir o app com sessão ativa (docs/67 §4.5). Libera o token já
 * salvo sem reenviar senha nenhuma — ver AuthContext.
 *
 * Antes era um checkbox na tela de login, junto do "Lembrar meu e-mail". Agora segue o padrão de
 * mercado: o app pergunta uma vez, logo depois do primeiro login (OfertaBiometriaModal), e a opção
 * fica no Perfil. A escolha é guardada com o id de quem respondeu — outro promotor que entrar no
 * mesmo aparelho é perguntado de novo, em vez de herdar a resposta (aparelho compartilhado:
 * docs/04-APP-MOBILE.md). Logout explícito limpa.
 */
const STORAGE_KEY = 'pdv_mobile_biometria';

export interface PreferenciaBiometria {
  usuarioId: string;
  ativa: boolean;
}

export const preferenciaBiometria = {
  async get(): Promise<PreferenciaBiometria | null> {
    const valor = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!valor) return null;
    try {
      const salva = JSON.parse(valor) as Partial<PreferenciaBiometria>;
      if (!salva.usuarioId) return null;
      return { usuarioId: salva.usuarioId, ativa: Boolean(salva.ativa) };
    } catch {
      return null; // formato inesperado — trata como se nunca tivesse respondido
    }
  },
  async set(preferencia: PreferenciaBiometria): Promise<void> {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(preferencia));
  },
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  },
};

/** O aparelho tem leitor E o usuário já cadastrou uma biometria no sistema. */
export async function aparelhoTemBiometria(): Promise<boolean> {
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

/** Abre o prompt do sistema. `true` só quando o usuário passou. */
export async function confirmarBiometria(promptMessage: string): Promise<boolean> {
  try {
    const resultado = await LocalAuthentication.authenticateAsync({ promptMessage, cancelLabel: 'Cancelar' });
    return resultado.success;
  } catch {
    return false;
  }
}
