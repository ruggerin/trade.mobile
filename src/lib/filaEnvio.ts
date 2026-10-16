import axios from 'axios';
import { criarRegistro, finalizarVisita, iniciarVisita, responderAcompanhamento } from './api/visitas';
import { listarRespostasDaVisita, marcarRespostaComErro, marcarRespostaEnviada } from './db/filaAcompanhamentos';
import { ehErroDeRede, ehErroTransitorio } from './db/database';
import { descartarRegistrosDaVisita, listarRegistrosLocais, marcarRegistroComErro, marcarRegistroEnviado, type RegistroLocal } from './db/filaRegistros';
import { reportarRecusaFila } from './sentry';
import {
  atualizarErroVisita,
  excluirVisitaLocalCompleta,
  lerVisitaLocal,
  listarVisitasLocaisPendentesOuRejeitadas,
  marcarCheckinEnviado,
  marcarVisitaRejeitada,
  type VisitaLocal,
} from './db/filaVisitas';
import { estaOnline } from './network';

// Mesmo padrão de lib/api/client.ts (authEvents) — telas assinam isso pra saber quando reler
// suas queries locais (visita, registros, banner de "visita em andamento") sem precisar de
// polling. Disparado ao fim de toda passada, mesmo quando nada mudou (reler SQLite local é
// barato, mais simples que rastrear se algo de fato mudou).
export const filaEnvioEvents = new EventTarget();
export const FILA_ENVIO_ATUALIZADA_EVENT = 'fila-envio:atualizada';
// Diferente do de cima (que dispara em toda passada): este só dispara quando a passada MUDOU algo no
// servidor (check-in, registro ou checkout confirmado) — é o gatilho pra recarregar Agenda/Histórico,
// que mostram dado do servidor e ficavam com "Em andamento" depois da visita já finalizada.
export const FILA_ENVIO_SERVIDOR_MUDOU_EVENT = 'fila-envio:servidor-mudou';

/**
 * Motor da fila de envio (offline-first de verdade — ver docs/04-APP-MOBILE.md "Fila offline de
 * envio"). Processa TODAS as visitas pendentes do usuário logado, mais antiga primeiro, cada
 * uma até onde der: check-in → registros (foto/ruptura/observação) → checkout, nessa ordem —
 * nunca manda um registro antes do check-in ter sido aceito pelo servidor (não existe visita
 * pra anexar) nem o checkout antes dos registros pendentes serem tentados.
 *
 * Cada passo que falha de forma TRANSITÓRIA (`ehErroTransitorio` — sem rede, ou 5xx passageiro
 * do servidor) para o processamento *daquela visita* na hora — não é culpa do que foi enviado,
 * tentar de novo agora ia falhar do mesmo jeito — mas segue tentando as outras visitas da fila
 * (podem ter passos diferentes pendentes) só pra não desperdiçar a verificação de rede já feita
 * no início; na prática, se a primeira chamada cair por rede, as seguintes tendem a cair também,
 * então o resultado prático costuma ser "tenta tudo, nada vai". O check-in manda
 * `idempotency_key` (uuid local da visita) em toda tentativa — se o servidor já tiver processado
 * uma tentativa anterior (app fechou entre a resposta e a gravação local), a próxima retentativa
 * automática recebe a MESMA visita de volta em vez de duplicar, ver
 * VisitaController::store.
 *
 * Falha PERMANENTE do servidor (validação de negócio, 4xx — não tem erro de rede nem 5xx nisso)
 * é tratada por camada, porque tentar de novo com o mesmo payload dá o mesmo resultado:
 *   - check-in rejeitado (ex.: fora do raio) → visita inteira vira REJEITADA, registros dela
 *     viram DESCARTADO (nunca vão ter pra onde ir) — ver docs/02-API-BACKEND.md regra 1.
 *   - registro individual rejeitado → só aquele registro vira ERRO (fica esperando o promotor
 *     notar/corrigir/reenviar na mão), os demais (e o checkout) seguem normalmente. Um registro
 *     rejeitado por falha TRANSITÓRIA (5xx/rede), ao contrário, nem chega a virar ERRO — continua
 *     PENDENTE e a própria fila tenta de novo sozinha na próxima passada, sem o promotor precisar
 *     notar nada.
 *   - checkout rejeitado → não deveria acontecer (raio só vale no check-in), mas se acontecer
 *     fica em FINALIZADA_LOCAL e tenta de novo depois, sem estado terminal pra isso.
 */

export interface ResultadoFilaEnvio {
  visitasEnviadas: number;
  visitasRejeitadas: number;
  registrosEnviados: number;
  registrosComErro: number;
  checkoutsConfirmados: number;
}

const RESULTADO_VAZIO: ResultadoFilaEnvio = {
  visitasEnviadas: 0,
  visitasRejeitadas: 0,
  registrosEnviados: 0,
  registrosComErro: 0,
  checkoutsConfirmados: 0,
};

// Uma passada por vez (ex.: reconexão e volta de background quase juntas) — evita duplicar upload
// em voo. Mas a chamada que chega no meio NÃO é mais perdida (docs/51 §3.1): ela liga
// `pedidoPendente` e a passada em curso roda outra na sequência — antes, o checkout tocado
// enquanto o check-in ainda subia ficava parado no celular até o próximo gatilho.
let emAndamento = false;
let pedidoPendente = false;
// Quando a passada em curso começou. Uma passada que nunca termina (chamada de rede pendurada, app
// voltando de background com socket morto) deixava `emAndamento` verdadeiro pra sempre e TODA
// tentativa seguinte era descartada em silêncio — a fila inteira parava até fechar o app. Passou
// do limite, a passada nova assume.
let inicioDaPassada = 0;
const LIMITE_PASSADA_MS = 3 * 60_000;

export async function processarFilaEnvio(usuarioId: string): Promise<ResultadoFilaEnvio> {
  if (emAndamento && Date.now() - inicioDaPassada < LIMITE_PASSADA_MS) {
    pedidoPendente = true;
    return { ...RESULTADO_VAZIO };
  }
  emAndamento = true;
  pedidoPendente = false;
  inicioDaPassada = Date.now();

  const resultado: ResultadoFilaEnvio = { ...RESULTADO_VAZIO };

  try {
    if (!(await estaOnline())) return resultado;

    const visitas = await listarVisitasLocaisPendentesOuRejeitadas(usuarioId);
    const ordenadas = [...visitas].sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));

    for (const visita of ordenadas) {
      await processarVisita(visita, resultado);
    }
  } catch (err) {
    // Rede/API já são tratadas passo a passo dentro de processarVisita (enviarCheckin/
    // enviarRegistro/enviarCheckout, cada um com seu próprio try/catch) — isso aqui é o piso de
    // segurança pra qualquer coisa INESPERADA que escape delas (ex.: leitura do SQLite local
    // falhando no meio da passada). Esta função roda solta, sem ninguém no chamador esperando
    // (`void processarFilaEnvio(...)` em MainTabs.tsx) — sem este catch, uma rejeição aqui vira
    // promise rejeitada sem handler, e é exatamente esse tipo de erro não tratado que fecha o
    // app sozinho num build de produção (Hermes não tem red box pra amortecer, só derruba).
    if (__DEV__) console.warn('[filaEnvio] falha inesperada processando a fila', err);
  } finally {
    emAndamento = false;
    ultimaPassadaEm = new Date().toISOString();
    filaEnvioEvents.dispatchEvent(new Event(FILA_ENVIO_ATUALIZADA_EVENT));
    if (houveProgresso(resultado)) {
      filaEnvioEvents.dispatchEvent(new Event(FILA_ENVIO_SERVIDOR_MUDOU_EVENT));
    }
  }

  // Alguém pediu envio enquanto esta passada rodava: roda de novo já (pega o que foi gravado depois
  // que a lista foi lida). Aguardado aqui pra quem chamou ver o resultado somado.
  if (pedidoPendente) {
    pedidoPendente = false;
    const extra = await processarFilaEnvio(usuarioId);
    for (const chave of Object.keys(resultado) as (keyof ResultadoFilaEnvio)[]) resultado[chave] += extra[chave];
    return resultado;
  }

  void agendarRetentativa(usuarioId, houveProgresso(resultado));
  return resultado;
}

function houveProgresso(resultado: ResultadoFilaEnvio): boolean {
  return resultado.visitasEnviadas + resultado.registrosEnviados + resultado.checkoutsConfirmados > 0;
}

// ——— Retentativa periódica (docs/51 §3.2 / Fase 1) ———
//
// Sem isto, uma falha passageira (5xx, timeout, rede caindo no meio) deixava o item parado até o
// próximo gatilho (sair e voltar do app, reconectar) — com o app aberto e a rede estável, podia não
// vir nunca. Só existe com o app em primeiro plano (MainTabs liga/desliga) e algo pendente na
// fila; espera cresce sem progresso e volta pro começo quando algo passa. Fila vazia = sem timer.
export const ESPERAS_RETENTATIVA_MS = [15_000, 30_000, 60_000, 120_000];

let retentativa: { usuarioId: string; passo: number; timer: ReturnType<typeof setTimeout> | null } | null = null;
let ultimaPassadaEm: string | null = null;

/** Quando a última passada terminou (com ou sem sucesso) — a UI mostra "última tentativa". */
export function ultimaTentativaEnvioEm(): string | null {
  return ultimaPassadaEm;
}

/** App em primeiro plano: liga a retentativa e já faz uma passada. */
export function ligarRetentativaAutomatica(usuarioId: string): void {
  desligarRetentativaAutomatica();
  retentativa = { usuarioId, passo: 0, timer: null };
  void processarFilaEnvio(usuarioId).catch(() => {});
}

/** App em segundo plano / logout: nenhum timer fica vivo. */
export function desligarRetentativaAutomatica(): void {
  if (retentativa?.timer) clearTimeout(retentativa.timer);
  retentativa = null;
}

async function agendarRetentativa(usuarioId: string, progrediu: boolean): Promise<void> {
  if (!retentativa || retentativa.usuarioId !== usuarioId) return;
  if (retentativa.timer) clearTimeout(retentativa.timer);
  retentativa.timer = null;

  const pendente = await contarPendenciasEnvio(usuarioId).catch(() => 0);
  // Desligada (ou trocou de usuário) enquanto contava.
  if (!retentativa || retentativa.usuarioId !== usuarioId) return;
  if (pendente === 0) {
    retentativa.passo = 0;
    return;
  }

  if (progrediu) retentativa.passo = 0;
  const espera = ESPERAS_RETENTATIVA_MS[Math.min(retentativa.passo, ESPERAS_RETENTATIVA_MS.length - 1)];
  retentativa.passo += 1;
  retentativa.timer = setTimeout(() => {
    if (retentativa) retentativa.timer = null;
    void processarFilaEnvio(usuarioId).catch(() => {});
  }, espera);
}

/**
 * Quantas visitas ainda têm algo a mandar: check-in não aceito, registro pendente ou checkout não
 * confirmado. Visita aberta já com tudo enviado não conta (não há o que mandar até finalizar), nem
 * REJEITADA (espera o promotor descartar).
 */
export async function contarPendenciasEnvio(usuarioId: string): Promise<number> {
  const visitas = await listarVisitasLocaisPendentesOuRejeitadas(usuarioId);
  let total = 0;
  for (const visita of visitas) {
    if (visita.status === 'REJEITADA') continue;
    if (!visita.servidorId || visita.status === 'FINALIZADA_LOCAL') {
      total += 1;
      continue;
    }
    const registros = await listarRegistrosLocais(visita.id);
    if (registros.some((r) => r.status === 'PENDENTE')) total += 1;
  }
  return total;
}

async function processarVisita(visitaInicial: VisitaLocal, resultado: ResultadoFilaEnvio): Promise<void> {
  if (visitaInicial.status === 'REJEITADA') {
    return; // aguarda o promotor descartar manualmente (ver descartarVisitaRejeitada em visitaLocal.ts)
  }

  let visita = visitaInicial;

  if (!visita.servidorId) {
    const enviou = await enviarCheckin(visita, resultado);
    if (!enviou) return;

    const atualizada = await lerVisitaLocal(visita.id);
    if (!atualizada) return; // foi excluída por outro processo entre uma chamada e outra — nada a fazer
    visita = atualizada;
  }

  const registros = await listarRegistrosLocais(visita.id);
  for (const registro of registros.filter((r) => r.status === 'PENDENTE')) {
    const continuar = await enviarRegistro(visita, registro, resultado);
    if (!continuar) return;
  }

  // "Ainda está lá?" (docs/83): depois dos registros (a resposta pode apontar pro do formulário) e
  // antes do checkout (que apaga a visita do aparelho).
  if (!(await enviarRespostasAcompanhamento(visita))) return;

  if (visita.status === 'FINALIZADA_LOCAL') {
    if (await enviarCheckout(visita)) resultado.checkoutsConfirmados += 1;
  }
}

/** @returns false só com falha transitória — para a visita agora e tenta na próxima passada. */
async function enviarRespostasAcompanhamento(visita: VisitaLocal): Promise<boolean> {
  const respostas = (await listarRespostasDaVisita(visita.id)).filter((r) => r.status === 'PENDENTE');
  if (respostas.length === 0) return true;
  const registros = await listarRegistrosLocais(visita.id);

  for (const r of respostas) {
    const registro = r.registroLocalId ? registros.find((x) => x.id === r.registroLocalId) : undefined;
    // Registro do formulário ainda não foi: espera ele (volta na próxima passada).
    if (registro && registro.status === 'PENDENTE') return false;
    try {
      await responderAcompanhamento(visita.servidorId!, r.acompanhamentoUuid, {
        resposta: r.resposta,
        idempotency_key: r.id,
        criado_em: r.criadoEm,
        // Registro recusado pelo servidor (ERRO): a resposta vai sem ele.
        registro_uuid: registro?.servidorId ?? undefined,
      });
      await marcarRespostaEnviada(r.id);
    } catch (err) {
      if (ehErroTransitorio(err)) return false;
      // Recusa permanente (acompanhamento sumiu, outra loja...): não trava a visita nem o checkout.
      reportarRecusaFila('registro', err);
      await marcarRespostaComErro(r.id, mensagemDeErroServidor(err) ?? 'Resposta recusada pelo servidor.');
      await marcarRespostaEnviada(r.id);
    }
  }
  return true;
}

async function enviarCheckin(visita: VisitaLocal, resultado: ResultadoFilaEnvio): Promise<boolean> {
  try {
    const servidor = await iniciarVisita({
      ponto_venda_uuid: visita.pontoVenda.id,
      latitude: visita.latitudeInicio,
      longitude: visita.longitudeInicio,
      ordem_servico_uuid: visita.ordemServicoId ?? undefined,
      ordem_servico_escolhida: visita.ordemServicoEscolhida || undefined,
      liberacao_uuid: visita.liberacaoId ?? undefined,
      // Mesmo uuid local em toda tentativa desta visita — é o que torna seguro reter e tentar
      // de novo abaixo mesmo quando a falha foi transitória (o servidor pode até ter processado
      // a chamada anterior sem a resposta chegar até aqui).
      idempotency_key: visita.id,
      // Hora em que o promotor fez o check-in no campo (docs/51 Fase 2) — o servidor grava esta,
      // não a hora em que o envio chegou.
      inicio_em: visita.inicioEm,
    });
    await marcarCheckinEnviado(visita.id, servidor.id);
    console.log(`[fila] check-in confirmado (visita ${visita.id} → servidor ${servidor.id})`);
    resultado.visitasEnviadas += 1;
    return true;
  } catch (err) {
    if (ehErroTransitorio(err)) {
      const mensagem = ehErroDeRede(err)
        ? 'Sem conexão no momento do envio — tentando de novo automaticamente.'
        : 'Servidor indisponível no momento — tentando de novo automaticamente.';
      await atualizarErroVisita(visita.id, mensagem);
      return false;
    }
    const mensagem = mensagemDeErroServidor(err) ?? 'Check-in recusado pelo servidor.';
    reportarRecusaFila('checkin', err);
    await marcarVisitaRejeitada(visita.id, mensagem);
    await descartarRegistrosDaVisita(visita.id);
    resultado.visitasRejeitadas += 1;
    return false;
  }
}

/** @returns false só quando o motivo foi transitório (`ehErroTransitorio`) — sinal pra `processarVisita` parar de tentar os próximos passos desta visita agora. */
async function enviarRegistro(visita: VisitaLocal, registro: RegistroLocal, resultado: ResultadoFilaEnvio): Promise<boolean> {
  try {
    const registroServidor = await criarRegistro({
      visitaId: visita.servidorId!,
      // Mesmo uuid local em toda tentativa deste registro (`registro.id`, estável entre
      // retentativas) — é o que torna seguro reenviar mesmo quando a falha anterior foi
      // transitória (o servidor pode ter processado a chamada sem a resposta chegar até aqui).
      idempotencyKey: registro.id,
      tipoRegistroUuid: registro.tipoRegistroUuid,
      imagensUri: registro.imagensLocais.length > 0 ? registro.imagensLocais : undefined,
      produtoAuditoriaUuid: registro.produtoAuditoriaUuid ?? undefined,
      tipoVinculo: registro.tipoVinculo ?? undefined,
      secaoUuid: registro.secaoUuid ?? undefined,
      departamentoUuid: registro.departamentoUuid ?? undefined,
      marcaUuid: registro.marcaUuid ?? undefined,
      valoresCampos: registro.valoresCampos ?? undefined,
      ruptura: registro.ruptura ?? undefined,
      observacao: registro.observacao ?? undefined,
      // Hora em que foi salvo no celular (docs/51 Fase 2).
      criadoEm: registro.criadoEm,
      acompanhamentoUuid: registro.acompanhamentoUuid ?? undefined,
      marcaNovaDescricao: registro.marcaNovaDescricao ?? undefined,
      embalagemQuantidade: registro.embalagemQuantidade ?? undefined,
      embalagemUnidade: registro.embalagemUnidade ?? undefined,
    });
    await marcarRegistroEnviado(registro.id, registroServidor.id);
    console.log(`[fila] registro enviado (visita ${visita.id})`);
    resultado.registrosEnviados += 1;
    return true;
  } catch (err) {
    // Rede caída ou 5xx passageiro do servidor — fica PENDENTE (nunca vira ERRO), a própria
    // fila tenta de novo sozinha na próxima passada. Só uma falha PERMANENTE (4xx — validação
    // de negócio, tentar de novo com o mesmo payload dá o mesmo resultado) vira ERRO e espera o
    // promotor notar/corrigir/reenviar na mão.
    if (ehErroTransitorio(err)) return false;
    reportarRecusaFila('registro', err);
    await marcarRegistroComErro(registro.id, mensagemDeErroServidor(err) ?? 'Registro recusado pelo servidor.');
    resultado.registrosComErro += 1;
    return true; // erro de validação de UM registro não trava os outros nem o checkout
  }
}

async function enviarCheckout(visita: VisitaLocal): Promise<boolean> {
  try {
    await finalizarVisita(visita.servidorId!, visita.latitudeFim!, visita.longitudeFim!, visita.fimEm);
    // Servidor já tem tudo (check-in, registros e checkout confirmados) — a cópia local perdeu
    // utilidade, HistoricoScreen/VisitaDetalhe passam a mostrar essa visita vinda de lá.
    console.log(`[fila] checkout confirmado pelo servidor (visita ${visita.id})`);
    await excluirVisitaLocalCompleta(visita.id, 'checkout-confirmado');
    return true;
  } catch (err) {
    // Checkout não vira terminal (continua tentando), mas uma recusa 4xx merece rastro.
    if (!ehErroTransitorio(err)) reportarRecusaFila('checkout', err);
    const mensagem = ehErroDeRede(err)
      ? 'Sem conexão no momento do envio — tentando de novo automaticamente.'
      : (mensagemDeErroServidor(err) ?? 'Não foi possível confirmar o checkout — tentando de novo automaticamente.');
    await atualizarErroVisita(visita.id, mensagem);
    return false;
  }
}

function mensagemDeErroServidor(err: unknown): string | null {
  if (axios.isAxiosError<{ message?: string }>(err) && err.response) {
    return err.response.data?.message ?? null;
  }
  return null;
}
