import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import axios from 'axios';
import { Linking } from 'react-native';
import { apiClient } from './api/client';
import { buscarConfigRastreamento, type ExigenciaRastreamento } from './api/parametros';

/**
 * Rastreamento em tempo real do promotor — docs/11-RASTREAMENTO-TEMPO-REAL.md. Uma tarefa em
 * segundo plano (expo-location + expo-task-manager) manda a posição pro backend
 * (`PATCH /localizacao`) enquanto o expediente estiver rolando, mesmo com o app fechado/tela
 * apagada. Sem fila offline: posição de 10 minutos atrás não serve pra um mapa "ao vivo" — se o
 * envio falha, a próxima leitura tenta de novo e o promotor só aparece como "visto há X min".
 *
 * docs/47-RASTREAMENTO-EXIGENCIA.md: o app também descobre POR QUE não está rastreando (permissão
 * só durante o uso, GPS desligado, Expo Go, falha ao iniciar...), avisa o servidor
 * (`PATCH /localizacao/situacao`) e, conforme a exigência da empresa, a tela avisa ou bloqueia.
 */

export const NOME_TAREFA_RASTREAMENTO = 'pdv-rastreamento-localizacao';

// Piso do próprio app — a empresa pode pedir um intervalo mais longo, nunca um mais curto que
// isso (bateria).
const INTERVALO_MINIMO_SEGUNDOS = 30;
// Rede de segurança (decisão 6 da doc 11): sem atividade nenhuma do app por tanto tempo, a
// tarefa se desliga sozinha — evita drenar bateria a noite/fim de semana inteiro se o promotor
// esquecer o rastreamento ligado. Abrir o app no dia seguinte religa sozinho.
const LIMITE_SEM_ATIVIDADE_MS = 12 * 60 * 60 * 1000;

const CHAVE_DESLIGADO_PELO_PROMOTOR = 'pdv_rastreamento_desligado';
const CHAVE_ULTIMA_ATIVIDADE = 'pdv_rastreamento_ultima_atividade';
const CHAVE_RECUSOU_PERMISSAO = 'pdv_rastreamento_recusou_permissao';
const CHAVE_SITUACAO_INFORMADA = 'pdv_rastreamento_situacao_informada';
// Intervalo (já com o piso) com que a tarefa em execução foi ligada — o expo-location não diz
// com que opções ela está rodando, e sem isso mudar o parâmetro no admin nunca chegava na tarefa.
const CHAVE_INTERVALO_TAREFA = 'pdv_rastreamento_intervalo_tarefa';

export type SituacaoRastreamento =
  /** Empresa não habilitou o parâmetro — o app nem oferece a opção. */
  | 'INDISPONIVEL'
  /** Exigência da empresa só vale na jornada e agora está fora dela — rastreamento desligado. */
  | 'FORA_DA_JORNADA'
  /**
   * Intervalo (almoço) que a empresa desconsidera (docs/95): o que estiver errado com a localização
   * não é cobrado agora. Se o rastreamento estiver ligado, continua coletando.
   */
  | 'NO_INTERVALO'
  /** Promotor desligou o switch do Perfil — só existe na exigência OPCIONAL. */
  | 'DESLIGADO_PELO_PROMOTOR'
  /** Nunca pediu a permissão — a UI explica o motivo antes de pedir. */
  | 'PRECISA_PERMISSAO'
  /** Recusou/adiou a permissão de localização. */
  | 'PERMISSAO_RECUSADA'
  /** Deu permissão só "durante o uso" — precisa de "o tempo todo". */
  | 'SO_DURANTE_USO'
  /** Localização (GPS) do aparelho desligada. */
  | 'GPS_DESLIGADO'
  /** Rodando no Expo Go, que não suporta localização em segundo plano (doc 11 §8). */
  | 'NAO_SUPORTADO'
  /** A tarefa não conseguiu iniciar (erro guardado em `detalhe`). */
  | 'FALHA_AO_INICIAR'
  | 'ATIVO';

export interface EstadoRastreamento {
  situacao: SituacaoRastreamento;
  exigencia: ExigenciaRastreamento;
  /** Mensagem técnica do erro, quando FALHA_AO_INICIAR. */
  detalhe: string | null;
}

/** Situações em que o rastreamento está como deveria (nada a cobrar do promotor). */
export function situacaoRegular(situacao: SituacaoRastreamento): boolean {
  return situacao === 'ATIVO' || situacao === 'INDISPONIVEL' || situacao === 'FORA_DA_JORNADA' || situacao === 'NO_INTERVALO';
}

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

async function enviarPosicao(latitude: number, longitude: number, timestamp: number, simulada = false): Promise<void> {
  try {
    await apiClient.patch('/localizacao', {
      latitude,
      longitude,
      capturado_em: new Date(timestamp).toISOString(),
      // Android marcou a leitura como de app de GPS falso — vira alerta pro ADMIN (docs/67).
      simulada,
    });
  } catch (err) {
    // 403 = empresa desligou o rastreamento (ou perfil mudou): para de vez em vez de martelar a
    // API a cada leitura. Qualquer outra falha (sem sinal, 5xx) é transitória — a próxima
    // leitura tenta de novo, sem fila.
    if (axios.isAxiosError(err) && err.response?.status === 403) {
      await pararRastreamento();
    }
  }
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

  await enviarPosicao(maisRecente.coords.latitude, maisRecente.coords.longitude, maisRecente.timestamp, Boolean(maisRecente.mocked));
});

export async function rastreamentoRodando(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(NOME_TAREFA_RASTREAMENTO).catch(() => false);
}

export async function pararRastreamento(): Promise<void> {
  if (await rastreamentoRodando()) {
    await Location.stopLocationUpdatesAsync(NOME_TAREFA_RASTREAMENTO);
  }
}

function intervaloEfetivo(intervaloEmpresaSegundos: number): number {
  return Math.max(INTERVALO_MINIMO_SEGUNDOS, intervaloEmpresaSegundos);
}

/**
 * A tarefa já roda com o intervalo que a empresa pede agora? Sem registro (tarefa ligada por uma
 * versão do app anterior a este controle) conta como diferente — reinicia uma vez e passa a saber.
 */
async function tarefaComIntervalo(intervaloEmpresaSegundos: number): Promise<boolean> {
  return (await SecureStore.getItemAsync(CHAVE_INTERVALO_TAREFA)) === String(intervaloEfetivo(intervaloEmpresaSegundos));
}

async function iniciarTarefa(intervaloEmpresaSegundos: number): Promise<void> {
  const intervalo = intervaloEfetivo(intervaloEmpresaSegundos);
  // Reiniciar quando já roda (ex.: a empresa mudou o intervalo) — updates antigos ficariam com o
  // intervalo velho.
  await pararRastreamento();
  await Location.startLocationUpdatesAsync(NOME_TAREFA_RASTREAMENTO, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: intervalo * 1000,
    // 0 = manda a cada intervalo MESMO PARADO (docs/48-ROTA-DO-DIA.md §4.2). Com distância mínima
    // (era 25 m), parado o Android não mandava nada e "parado em casa" ficava igual a "sem sinal"
    // na Rota do dia. Custo: um pouco mais de bateria; o intervalo segue sendo o da empresa.
    distanceInterval: 0,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    // Android exige uma notificação fixa enquanto a tarefa roda em segundo plano — além de
    // obrigatório, é transparência pro promotor de que está sendo acompanhado.
    foregroundService: {
      notificationTitle: 'Rastreamento de rota ativo',
      notificationBody: 'Sua localização está sendo compartilhada com seu gestor durante o expediente.',
    },
  });
  await SecureStore.setItemAsync(CHAVE_INTERVALO_TAREFA, String(intervalo));

  // Manda a posição já, sem esperar o primeiro intervalo (docs/47 §5.5) — o gestor vê o promotor
  // no mapa na hora e o teste fica imediato. Best-effort: se falhar, a tarefa manda na sequência.
  void Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    .then((p) => enviarPosicao(p.coords.latitude, p.coords.longitude, p.timestamp, Boolean(p.mocked)))
    .catch(() => {});
}

function dentroDaJornada(jornada: { inicio: string; fim: string } | null): boolean {
  if (!jornada) return true;
  const agora = new Date();
  const hora = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
  return hora >= jornada.inicio && hora <= jornada.fim;
}

/** Agora está no intervalo desconsiderado pela empresa (docs/95)? */
export function noIntervalo(intervalo: { inicio: string; fim: string } | null, agora = new Date()): boolean {
  if (!intervalo) return false;
  const hora = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
  return hora >= intervalo.inicio && hora <= intervalo.fim;
}

/** Situação → o que o servidor entende (App\Support\Rastreamento::SITUACOES). */
function situacaoParaServidor(situacao: SituacaoRastreamento): string | null {
  switch (situacao) {
    case 'PRECISA_PERMISSAO':
    case 'PERMISSAO_RECUSADA':
      return 'SEM_PERMISSAO';
    case 'INDISPONIVEL':
    case 'FORA_DA_JORNADA':
    case 'NO_INTERVALO':
      return null; // nada a cobrar — não informa
    default:
      return situacao;
  }
}

// Avisa o servidor só quando a situação MUDA (evita um PATCH a cada volta do background). Falhou
// (sem rede) → não grava como informada, tenta de novo na próxima reavaliação.
async function informarSituacao(estado: EstadoRastreamento): Promise<void> {
  const situacao = situacaoParaServidor(estado.situacao);
  if (!situacao) return;
  const assinatura = `${situacao}|${estado.detalhe ?? ''}`;
  if ((await SecureStore.getItemAsync(CHAVE_SITUACAO_INFORMADA)) === assinatura) return;
  try {
    await apiClient.patch('/localizacao/situacao', { situacao, detalhe: estado.detalhe });
    await SecureStore.setItemAsync(CHAVE_SITUACAO_INFORMADA, assinatura);
  } catch {
    // Sem rede agora — próxima reavaliação tenta de novo.
  }
}

async function avaliar(): Promise<EstadoRastreamento> {
  const config = await buscarConfigRastreamento().catch(() => null);
  const exigencia = config?.exigencia ?? 'OPCIONAL';
  const estado = (situacao: SituacaoRastreamento, detalhe: string | null = null): EstadoRastreamento => ({
    situacao,
    exigencia,
    detalhe,
  });

  if (!config || config.intervaloSegundos <= 0) {
    await pararRastreamento();
    return estado('INDISPONIVEL');
  }

  const exigente = exigencia !== 'OPCIONAL';
  // Fora da jornada, nas exigências AVISO/OBRIGATÓRIO, não rastreia nem cobra (docs/47 §5.2).
  if (exigente && !dentroDaJornada(config.jornada)) {
    await pararRastreamento();
    return estado('FORA_DA_JORNADA');
  }

  await registrarAtividadeRastreamento();

  // O switch "pausar" só existe na exigência OPCIONAL — nas outras, a flag antiga é ignorada.
  if (!exigente && (await lerFlag(CHAVE_DESLIGADO_PELO_PROMOTOR))) {
    await pararRastreamento();
    return estado('DESLIGADO_PELO_PROMOTOR');
  }

  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return estado('NAO_SUPORTADO', 'Expo Go não suporta localização em segundo plano — use o APK do app.');
  }

  const primeiroPlano = await Location.getForegroundPermissionsAsync();
  if (primeiroPlano.status !== 'granted') {
    return estado((await lerFlag(CHAVE_RECUSOU_PERMISSAO)) || primeiroPlano.status === 'denied' ? 'PERMISSAO_RECUSADA' : 'PRECISA_PERMISSAO');
  }
  const segundoPlano = await Location.getBackgroundPermissionsAsync();
  if (segundoPlano.status !== 'granted') {
    return estado('SO_DURANTE_USO');
  }

  if (!(await Location.hasServicesEnabledAsync().catch(() => true))) {
    return estado('GPS_DESLIGADO');
  }

  // Liga se estiver parada, e RELIGA se a empresa mudou o intervalo desde que ela foi ligada —
  // antes só ligava quando parada, e a mudança do parâmetro nunca chegava na tarefa em execução.
  if (!(await rastreamentoRodando()) || !(await tarefaComIntervalo(config.intervaloSegundos))) {
    try {
      await iniciarTarefa(config.intervaloSegundos);
    } catch (err) {
      return estado('FALHA_AO_INICIAR', err instanceof Error ? err.message.slice(0, 250) : String(err));
    }
  }
  return estado('ATIVO');
}

/**
 * Chamada ao entrar no app (tabs), ao voltar de background, periodicamente nas exigências AVISO/
 * OBRIGATÓRIO e quando o promotor mexe no switch: decide o que fazer, avisa o servidor se a
 * situação mudou e devolve o estado pra UI. Nunca pede permissão sozinha.
 */
export async function sincronizarRastreamento(): Promise<EstadoRastreamento> {
  let estado = await avaliar();
  // No intervalo desconsiderado (docs/95) nada é cobrado: o que estiver irregular vira NO_INTERVALO
  // (a tela não avisa nem bloqueia). Se estava ATIVO, continua ativo e coletando.
  if (estado.exigencia !== 'OPCIONAL' && !situacaoRegular(estado.situacao)) {
    const config = await buscarConfigRastreamento().catch(() => null);
    if (noIntervalo(config?.intervalo ?? null)) estado = { ...estado, situacao: 'NO_INTERVALO', detalhe: null };
  }
  void informarSituacao(estado);
  return estado;
}

/** Depois da tela de explicação: pede primeiro plano, depois "Sempre" (Android leva pras configurações). */
export async function solicitarPermissaoEIniciar(): Promise<EstadoRastreamento> {
  const primeiroPlano = await Location.requestForegroundPermissionsAsync();
  if (primeiroPlano.status !== 'granted') {
    await gravarFlag(CHAVE_RECUSOU_PERMISSAO, true);
    // Já recusou de vez antes: o sistema nem mostra mais o pedido — só as configurações resolvem.
    if (!primeiroPlano.canAskAgain) await Linking.openSettings().catch(() => {});
    return sincronizarRastreamento();
  }

  const segundoPlano = await Location.requestBackgroundPermissionsAsync();
  if (segundoPlano.status !== 'granted') {
    if (!segundoPlano.canAskAgain) await Linking.openSettings().catch(() => {});
    return sincronizarRastreamento();
  }

  await gravarFlag(CHAVE_RECUSOU_PERMISSAO, false);
  return sincronizarRastreamento();
}

/**
 * Botão "Resolver" da faixa de aviso / tela de bloqueio (docs/47 §5.2): faz o que dá pra fazer
 * pelo app pra cada motivo — pedir permissão, pedir pra ligar o GPS, abrir as configurações.
 */
export async function resolverRastreamento(situacao: SituacaoRastreamento): Promise<EstadoRastreamento> {
  if (situacao === 'GPS_DESLIGADO') {
    // Android mostra o diálogo nativo "ativar localização"; iOS/recusa → configurações.
    await Location.enableNetworkProviderAsync().catch(() => Linking.openSettings().catch(() => {}));
    return sincronizarRastreamento();
  }
  if (situacao === 'PRECISA_PERMISSAO' || situacao === 'PERMISSAO_RECUSADA' || situacao === 'SO_DURANTE_USO') {
    return solicitarPermissaoEIniciar();
  }
  return sincronizarRastreamento();
}

/** "Agora não" na tela de explicação — não pergunta de novo sozinho (o Perfil continua oferecendo). */
export async function adiarPermissaoRastreamento(): Promise<void> {
  await gravarFlag(CHAVE_RECUSOU_PERMISSAO, true);
}

/** Switch "Compartilhar minha localização" do Perfil (só na exigência OPCIONAL). */
export async function definirRastreamentoLigado(ligado: boolean): Promise<EstadoRastreamento> {
  await gravarFlag(CHAVE_DESLIGADO_PELO_PROMOTOR, !ligado);
  if (ligado) await gravarFlag(CHAVE_RECUSOU_PERMISSAO, false);
  return sincronizarRastreamento();
}

/** Logout: não deixa a posição de um promotor continuar sendo enviada em nome do próximo login. */
export async function encerrarRastreamentoNoLogout(): Promise<void> {
  await pararRastreamento();
  // O próximo login (talvez outro promotor) precisa informar a própria situação do zero.
  await SecureStore.deleteItemAsync(CHAVE_SITUACAO_INFORMADA).catch(() => {});
}
