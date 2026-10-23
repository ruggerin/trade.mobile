import { createNavigationContainerRef } from '@react-navigation/native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { apiClient } from './api/client';

/**
 * Push notifications — docs/77-PUSH-NOTIFICATIONS.md §3.1. O servidor manda pela Expo (App\Support\Push)
 * pro aparelho ativo do promotor; aqui o app registra o token, cria os canais Android e, no toque,
 * abre o mesmo destino que o sino (NotificacoesScreen, docs/29 §4).
 *
 * O push só leva `tipo` + ids (LGPD, §3.3): o conteúdo é buscado na API, já autenticado, ao abrir.
 */

/** Ref do NavigationContainer — o toque na notificação chega fora de qualquer tela. */
export const navegacaoRef = createNavigationContainerRef();

/** Último token que o servidor confirmou — só manda de novo quando muda (§3.1, "Registro do token"). */
const CHAVE_TOKEN_ENVIADO = 'pdv_push_token_enviado';

/** Mesmos ids de App\Support\Push::CANAL_* — o promotor silencia cada um nos ajustes do Android. */
const CANAIS: { id: string; nome: string; descricao: string }[] = [
  { id: 'comentarios', nome: 'Comentários do gestor', descricao: 'Quando o gestor comenta num registro seu.' },
  { id: 'pedidos', nome: 'Pedidos', descricao: 'Pedido a caminho ou entregue numa loja sua.' },
  { id: 'agenda', nome: 'Agenda', descricao: 'Visita nova na sua agenda.' },
];

// App aberto: mostra o aviso mesmo assim (banner), senão o promotor não fica sabendo.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Expo Go não recebe push desde o SDK 53 (docs/77 §4) — lá tudo aqui vira no-op. */
function suportado(): boolean {
  return Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
}

async function criarCanais(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Promise.all(
    CANAIS.map((c) =>
      Notifications.setNotificationChannelAsync(c.id, {
        name: c.nome,
        description: c.descricao,
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: '#4f46e5',
      }),
    ),
  );
}

/** Situação da permissão sem pedir nada — usada pelo "Preparar o celular" (preparoAparelho.ts). */
export async function permissaoNotificacoes(): Promise<{ status: string; canAskAgain: boolean }> {
  if (!suportado()) return { status: 'granted', canAskAgain: false };
  const { status, canAskAgain } = await Notifications.getPermissionsAsync();
  return { status, canAskAgain };
}

/** Android 13+ mostra o pedido do sistema; os canais precisam existir antes (senão o pedido não aparece). */
export async function pedirPermissaoNotificacoes(): Promise<void> {
  if (!suportado()) return;
  await criarCanais();
  await Notifications.requestPermissionsAsync();
  await registrarPush();
}

/**
 * Depois do login e a cada abertura: com permissão, pega o token Expo e manda pro servidor se
 * mudou. Sem permissão, não pede (quem pede é a tela de preparo) e não faz nada. Best-effort: sem
 * rede, a próxima abertura tenta de novo.
 */
export async function registrarPush(): Promise<void> {
  if (!suportado()) return;
  try {
    await criarCanais();
    if ((await Notifications.getPermissionsAsync()).status !== 'granted') return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (__DEV__) console.log('[push] token', token);
    if ((await SecureStore.getItemAsync(CHAVE_TOKEN_ENVIADO)) === token) return;

    await apiClient.put('/dispositivos/atual/push-token', { token });
    await SecureStore.setItemAsync(CHAVE_TOKEN_ENVIADO, token);
  } catch (err) {
    if (__DEV__) console.log('[push] não registrou', err);
  }
}

/**
 * Logout explícito: apaga o token no servidor ANTES de limpar a sessão (o DELETE precisa dela),
 * senão o próximo promotor no mesmo celular receberia os avisos de quem saiu.
 */
export async function apagarPushNoLogout(): Promise<void> {
  try {
    if (suportado()) await apiClient.delete('/dispositivos/atual/push-token');
  } catch {
    // Best-effort: o servidor também troca o token de dono no próximo login neste celular.
  }
  await esquecerPushLocal();
}

/** Sessão caiu (401): não dá pra chamar a API, só esquece o "já enviado" pro próximo login mandar de novo. */
export async function esquecerPushLocal(): Promise<void> {
  await SecureStore.deleteItemAsync(CHAVE_TOKEN_ENVIADO).catch(() => {});
}

type DadosPush = { tipo?: string; visita_id?: string; registro_id?: string; pedido_id?: string };

/** Mesmo destino do sino (NotificacoesScreen): conversa do registro ou detalhe do pedido. */
function abrirDestino(dados: DadosPush): void {
  if (!navegacaoRef.isReady()) return;
  // A tipagem do ref é genérica (as abas aninham pilhas tipadas) — mesmo formato do BotaoNotificacoes.
  const navegar = navegacaoRef.navigate as (aba: string, params: object) => void;
  if (dados.tipo === 'comentario' && dados.visita_id) {
    navegar('Historico', { screen: 'VisitaDetalhe', params: { visitaId: dados.visita_id, abrirRegistroId: dados.registro_id } });
  } else if (dados.tipo === 'pedido' && dados.pedido_id) {
    navegar('Historico', { screen: 'PedidoDetalhe', params: { pedidoId: dados.pedido_id } });
  }
}

/**
 * Escuta o toque nas notificações enquanto o promotor está nas abas. Também trata a notificação que
 * ABRIU o app (estava fechado): ela chega antes deste listener existir.
 */
export function ouvirToquesNasNotificacoes(): () => void {
  if (!suportado()) return () => {};
  const assinatura = Notifications.addNotificationResponseReceivedListener((resposta) => {
    abrirDestino(resposta.notification.request.content.data as DadosPush);
  });
  const ultima = Notifications.getLastNotificationResponse();
  if (ultima) {
    abrirDestino(ultima.notification.request.content.data as DadosPush);
    Notifications.clearLastNotificationResponse();
  }
  return () => assinatura.remove();
}
