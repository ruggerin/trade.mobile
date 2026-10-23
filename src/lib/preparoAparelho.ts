import * as Battery from 'expo-battery';
import * as ImagePicker from 'expo-image-picker';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { Linking, Platform } from 'react-native';
import { buscarConfigRastreamento } from './api/parametros';
import { pedirPermissaoNotificacoes, permissaoNotificacoes } from './push';

/**
 * "Preparar o celular" (protótipo "Preparar Aparelho Horus", aprovado em 15/10/2026): no primeiro
 * acesso, as permissões viram um checklist pra ativar de uma vez, em vez de o app ir pedindo no meio
 * do trabalho (check-in, primeira foto, explicação da localização). Celular entregue pela TI já
 * liberado nem vê a tela.
 *
 * A tela só é conferida ao abrir o app e depois do login (RootNavigator) — nunca no meio do uso,
 * pra não arrancar o promotor de uma visita se ele desligar o GPS. O rastreamento exigente já tem
 * aviso próprio pra isso (docs/47).
 */

export type ItemPreparoId = 'gps' | 'localizacao' | 'sempre' | 'camera' | 'notificacoes' | 'bateria' | 'biometria';

/**
 * - `bloqueado`: o Android não pergunta mais (duas negativas) — só os ajustes do app resolvem.
 * - `adiado`: recomendado que o promotor deixou pra depois.
 */
export type EstadoItemPreparo = 'ok' | 'pendente' | 'negado' | 'bloqueado' | 'adiado';

export interface ItemPreparo {
  id: ItemPreparoId;
  obrigatorio: boolean;
  estado: EstadoItemPreparo;
}

export interface ContextoPreparo {
  /** Rastreamento só vale pra PROMOTOR (useRastreamento no MainTabs). */
  promotor: boolean;
  /** null = aparelho sem biometria cadastrada (o item nem aparece). */
  biometria: { ativa: boolean; perguntar: boolean } | null;
}

const CHAVE_ADIADOS = 'pdv_mobile_preparo_adiados';

async function lerAdiados(): Promise<ItemPreparoId[]> {
  try {
    return JSON.parse((await SecureStore.getItemAsync(CHAVE_ADIADOS)) ?? '[]') as ItemPreparoId[];
  } catch {
    return [];
  }
}

/** Recomendados que o promotor deixou pra depois — a lista não volta a cobrar esses. */
export async function adiarItens(ids: ItemPreparoId[]): Promise<void> {
  const atuais = await lerAdiados();
  await SecureStore.setItemAsync(CHAVE_ADIADOS, JSON.stringify([...new Set([...atuais, ...ids])]));
}

function estadoDaPermissao(p: { status: string; canAskAgain: boolean }): EstadoItemPreparo {
  if (p.status === 'granted') return 'ok';
  if (p.status === 'denied') return p.canAskAgain ? 'negado' : 'bloqueado';
  return 'pendente';
}

/** Lê a situação de cada item sem pedir nada. */
export async function avaliarPreparo(ctx: ContextoPreparo): Promise<ItemPreparo[]> {
  // Sem rede, a config vem do cache (buscarParametros); sem nem isso, trata como sem rastreamento.
  const rastreamento = ctx.promotor ? await buscarConfigRastreamento().catch(() => null) : null;
  const comRastreamento = Boolean(rastreamento && rastreamento.intervaloSegundos > 0);
  const adiados = await lerAdiados();
  const recomendado = (id: ItemPreparoId, estado: EstadoItemPreparo): EstadoItemPreparo =>
    estado !== 'ok' && adiados.includes(id) ? 'adiado' : estado;

  const [gpsLigado, primeiroPlano, camera] = await Promise.all([
    Location.hasServicesEnabledAsync().catch(() => true),
    Location.getForegroundPermissionsAsync(),
    ImagePicker.getCameraPermissionsAsync(),
  ]);

  const itens: ItemPreparo[] = [
    { id: 'gps', obrigatorio: true, estado: gpsLigado ? 'ok' : 'pendente' },
    { id: 'localizacao', obrigatorio: true, estado: estadoDaPermissao(primeiroPlano) },
  ];

  if (comRastreamento) {
    // Exigência AVISO/OBRIGATÓRIO cobra "o tempo todo"; na OPCIONAL o promotor pode pausar, então é recomendado.
    const obrigatorio = rastreamento!.exigencia !== 'OPCIONAL';
    const segundoPlano = await Location.getBackgroundPermissionsAsync();
    const estado = estadoDaPermissao(segundoPlano);
    itens.push({ id: 'sempre', obrigatorio, estado: obrigatorio ? estado : recomendado('sempre', estado) });
  }

  itens.push({ id: 'camera', obrigatorio: true, estado: estadoDaPermissao(camera) });

  // Push (docs/77): recomendado — o app funciona sem, o sino continua tendo tudo.
  const notificacoes = await permissaoNotificacoes().catch(() => ({ status: 'granted', canAskAgain: false }));
  itens.push({ id: 'notificacoes', obrigatorio: false, estado: recomendado('notificacoes', estadoDaPermissao(notificacoes)) });

  if (comRastreamento && Platform.OS === 'android') {
    const restrito = await Battery.isBatteryOptimizationEnabledAsync().catch(() => false);
    itens.push({ id: 'bateria', obrigatorio: false, estado: recomendado('bateria', restrito ? 'pendente' : 'ok') });
  }

  if (ctx.biometria) {
    const { ativa, perguntar } = ctx.biometria;
    // Já respondeu "agora não" (pela oferta antiga ou aqui): não cobra de novo.
    itens.push({ id: 'biometria', obrigatorio: false, estado: ativa ? 'ok' : perguntar ? 'pendente' : 'adiado' });
  }

  return itens;
}

/**
 * Os obrigatórios estão todos ok — é isso que decide se a tela aparece. Exceção: notificação
 * NUNCA perguntada também abre a tela, uma vez — senão quem já tinha tudo liberado antes do push
 * (docs/77) nunca veria o pedido. Respondeu (sim, não ou "agora não") → não cobra mais.
 */
export function preparoCompleto(itens: ItemPreparo[]): boolean {
  return itens.every((i) => (!i.obrigatorio || i.estado === 'ok') && !(i.id === 'notificacoes' && i.estado === 'pendente'));
}

/** Ajustes do Horus no Android (permissões, bateria) — saída quando o sistema não pergunta mais. */
export async function abrirAjustesDoApp(): Promise<void> {
  await Linking.openSettings().catch(() => {});
}

/**
 * Pede/ativa um item. A biometria não passa por aqui (é a AuthContext.definirBiometria). Volta
 * quando o sistema devolve o controle ao app — o chamador reavalia depois.
 */
export async function ativarItem(item: ItemPreparo): Promise<void> {
  if (item.estado === 'bloqueado') {
    await abrirAjustesDoApp();
    return;
  }

  switch (item.id) {
    case 'gps':
      // Android mostra o diálogo nativo "ativar localização"; se não der, a tela de localização.
      await Location.enableNetworkProviderAsync().catch(() =>
        IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.LOCATION_SOURCE_SETTINGS).catch(abrirAjustesDoApp),
      );
      return;
    case 'localizacao':
      await Location.requestForegroundPermissionsAsync();
      return;
    case 'sempre':
      // Android 11+ não tem diálogo pra "o tempo todo": o sistema leva aos ajustes de localização do app.
      await Location.requestBackgroundPermissionsAsync();
      return;
    case 'camera':
      await ImagePicker.requestCameraPermissionsAsync();
      return;
    case 'notificacoes':
      // Android 13+: diálogo do sistema. Liberado, já registra o token no servidor.
      await pedirPermissaoNotificacoes();
      return;
    case 'bateria':
      // A lista "Otimização de bateria" do sistema (não pede permissão especial ao Google Play).
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS).catch(abrirAjustesDoApp);
      return;
    case 'biometria':
      return;
  }
}
