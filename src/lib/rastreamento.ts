import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import axios from 'axios';
import { apiClient } from './api/client';
import { buscarIntervaloRastreamentoSegundos } from './api/parametros';

/**
 * Rastreamento em tempo real do promotor — docs/11-RASTREAMENTO-TEMPO-REAL.md. Uma tarefa em
 * segundo plano (expo-location + expo-task-manager) manda a posição pro backend
 * (`PATCH /localizacao`) enquanto o expediente estiver rolando, mesmo com o app fechado/tela
 * apagada. Sem fila offline: posição de 10 minutos atrás não serve pra um mapa "ao vivo" — se o
 * envio falha, a próxima leitura tenta de novo e o promotor só aparece como "visto há X min".
 */

export const NOME_TAREFA_RASTREAMENTO = 'pdv-rastreamento-localizacao';

// Piso do próprio app — a empresa pode pedir um intervalo mais longo, nunca um mais curto que
// isso (bateria).
const INTERVALO_MINIMO_SEGUNDOS = 30;
// Rede de segurança (decisão 6 da doc): sem atividade nenhuma do app (abrir o app, check-in) por
// tanto tempo, a tarefa se desliga sozinha — evita drenar bateria a noite/fim de semana inteiro se
// o promotor esquecer o rastreamento ligado. Abrir o app no dia seguinte religa sozinho.
const LIMITE_SEM_ATIVIDADE_MS = 12 * 60 * 60 * 1000;

const CHAVE_DESLIGADO_PELO_PROMOTOR = 'pdv_rastreamento_desligado';
const CHAVE_ULTIMA_ATIVIDADE = 'pdv_rastreamento_ultima_atividade';
const CHAVE_RECUSOU_PERMISSAO = 'pdv_rastreamento_recusou_permissao';

export type SituacaoRastreamento =
  /** Empresa não habilitou o parâmetro — o app nem oferece a opção. */
  | 'INDISPONIVEL'
  /** Promotor desligou o switch do Perfil — respeitado até ele ligar de novo. */
  | 'DESLIGADO_PELO_PROMOTOR'
  /** Precisa da permissão "Sempre permitir" — a UI explica o motivo antes de pedir. */
  | 'PRECISA_PERMISSAO'
  /** Promotor recusou a permissão — não insiste sozinho, só volta a pedir se ele ligar o switch. */
  | 'PERMISSAO_RECUSADA'
  | 'ATIVO';

async function lerFlag(chave: string): Promise<boolean> {
  return (await SecureStore.getItemAsync(chave)) === '1';
}

async function gravarFlag(chave: string, valor: boolean): Promise<void> {
  if (valor) await SecureStore.setItemAsync(chave, '1');
  else await SecureStore.deleteItemAsync(chave);
}

/** Marca "o promotor está usando o app agora" — adia o auto-desligar de 12h. */
export async function registrarAtividadeRastreamento(): Promise<void> {
  await SecureStore.setItemAsync(CHAVE_ULTIMA_ATIVIDADE, String(Date.now()));
}

// Definida no nível do módulo de propósito: o sistema operacional pode acordar o app só pra
// rodar a tarefa (processo novo, sem nenhuma tela montada), e o expo-task-manager exige que
// `defineTask` já tenha rodado nesse momento — por isso este arquivo é importado no topo de
// App.tsx (efeito colateral do import).
TaskManager.defineTask(NOME_TAREFA_RASTREAMENTO, async ({ data, error }) => {
  if (error || !data) return;

  const ultimaAtividade = Number((await SecureStore.getItemAsync(CHAVE_ULTIMA_ATIVIDADE)) ?? 0);
  if (Date.now() - ultimaAtividade > LIMITE_SEM_ATIVIDADE_MS) {
    await pararRastreamento();
    return;
  }

  const { locations } = data as { locations: Location.LocationObject[] };
  const maisRecente = locations[locations.length - 1];
  if (!maisRecente) return;

  try {
    await apiClient.patch('/localizacao', {
      latitude: maisRecente.coords.latitude,
      longitude: maisRecente.coords.longitude,
      capturado_em: new Date(maisRecente.timestamp).toISOString(),
    });
  } catch (err) {
    // 403 = empresa desligou o rastreamento (ou perfil mudou): para de vez em vez de martelar a
    // API a cada leitura. Qualquer outra falha (sem sinal, 5xx) é transitória — a próxima
    // leitura tenta de novo, sem fila.
    if (axios.isAxiosError(err) && err.response?.status === 403) {
      await pararRastreamento();
    }
  }
});

export async function rastreamentoRodando(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(NOME_TAREFA_RASTREAMENTO).catch(() => false);
}

export async function pararRastreamento(): Promise<void> {
  if (await rastreamentoRodando()) {
    await Location.stopLocationUpdatesAsync(NOME_TAREFA_RASTREAMENTO);
  }
}

async function temPermissaoSempre(): Promise<boolean> {
  const primeiroPlano = await Location.getForegroundPermissionsAsync();
  if (primeiroPlano.status !== 'granted') return false;
  const segundoPlano = await Location.getBackgroundPermissionsAsync();
  return segundoPlano.status === 'granted';
}

async function iniciarTarefa(intervaloEmpresaSegundos: number): Promise<void> {
  const intervalo = Math.max(INTERVALO_MINIMO_SEGUNDOS, intervaloEmpresaSegundos);
  // Reiniciar quando já roda (ex.: a empresa mudou o intervalo) — updates antigos ficariam com o
  // intervalo velho.
  await pararRastreamento();
  await Location.startLocationUpdatesAsync(NOME_TAREFA_RASTREAMENTO, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: intervalo * 1000,
    // iOS não tem timeInterval — usa distância mínima; no Android vale o que vier primeiro.
    distanceInterval: 25,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    // Android exige uma notificação fixa enquanto a tarefa roda em segundo plano — além de
    // obrigatório, é transparência pro promotor de que está sendo acompanhado.
    foregroundService: {
      notificationTitle: 'Rastreamento de rota ativo',
      notificationBody: 'Sua localização está sendo compartilhada com seu gestor durante o expediente.',
    },
  });
}

/**
 * Chamada ao entrar no app (tabs), ao voltar de background e quando o promotor mexe no switch:
 * decide o que fazer e devolve a situação pra UI. Nunca pede permissão sozinha — quando falta,
 * devolve PRECISA_PERMISSAO e a tela mostra a explicação (Android/iOS penalizam pedir
 * "Sempre permitir" sem contexto) antes de chamar `solicitarPermissaoEIniciar`.
 */
export async function sincronizarRastreamento(): Promise<SituacaoRastreamento> {
  const intervalo = await buscarIntervaloRastreamentoSegundos().catch(() => 0);
  if (intervalo <= 0) {
    await pararRastreamento();
    return 'INDISPONIVEL';
  }

  await registrarAtividadeRastreamento();

  if (await lerFlag(CHAVE_DESLIGADO_PELO_PROMOTOR)) {
    await pararRastreamento();
    return 'DESLIGADO_PELO_PROMOTOR';
  }

  if (!(await temPermissaoSempre())) {
    return (await lerFlag(CHAVE_RECUSOU_PERMISSAO)) ? 'PERMISSAO_RECUSADA' : 'PRECISA_PERMISSAO';
  }

  if (!(await rastreamentoRodando())) {
    await iniciarTarefa(intervalo);
  }
  return 'ATIVO';
}

/** Depois da tela de explicação: pede primeiro plano, depois "Sempre" (Android leva pras configurações). */
export async function solicitarPermissaoEIniciar(): Promise<SituacaoRastreamento> {
  const primeiroPlano = await Location.requestForegroundPermissionsAsync();
  if (primeiroPlano.status !== 'granted') {
    await gravarFlag(CHAVE_RECUSOU_PERMISSAO, true);
    return 'PERMISSAO_RECUSADA';
  }

  const segundoPlano = await Location.requestBackgroundPermissionsAsync();
  if (segundoPlano.status !== 'granted') {
    await gravarFlag(CHAVE_RECUSOU_PERMISSAO, true);
    return 'PERMISSAO_RECUSADA';
  }

  await gravarFlag(CHAVE_RECUSOU_PERMISSAO, false);
  return sincronizarRastreamento();
}

/** "Agora não" na tela de explicação — não pergunta de novo sozinho (o Perfil continua oferecendo). */
export async function adiarPermissaoRastreamento(): Promise<void> {
  await gravarFlag(CHAVE_RECUSOU_PERMISSAO, true);
}

/** Switch "Compartilhar minha localização" do Perfil. */
export async function definirRastreamentoLigado(ligado: boolean): Promise<SituacaoRastreamento> {
  await gravarFlag(CHAVE_DESLIGADO_PELO_PROMOTOR, !ligado);
  if (ligado) await gravarFlag(CHAVE_RECUSOU_PERMISSAO, false);
  return sincronizarRastreamento();
}

/** Logout: não deixa a posição de um promotor continuar sendo enviada em nome do próximo login. */
export async function encerrarRastreamentoNoLogout(): Promise<void> {
  await pararRastreamento();
}
