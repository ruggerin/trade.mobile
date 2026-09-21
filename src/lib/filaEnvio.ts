import axios from 'axios';
import { criarRegistro, finalizarVisita, iniciarVisita } from './api/visitas';
import { ehErroDeRede, ehErroTransitorio } from './db/database';
import { descartarRegistrosDaVisita, listarRegistrosLocais, marcarRegistroComErro, marcarRegistroEnviado, type RegistroLocal } from './db/filaRegistros';
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

// Guard simples contra duas passadas simultâneas (ex.: reconexão e volta de background quase
// juntas) — processarFilaEnvio é seguro de chamar de novo a qualquer momento, então perder uma
// chamada concorrente não perde trabalho, só evita duplicar upload em voo.
let emAndamento = false;
// Quando a passada em curso começou. Uma passada que nunca termina (chamada de rede pendurada, app
// voltando de background com socket morto) deixava `emAndamento` verdadeiro pra sempre e TODA
// tentativa seguinte era descartada em silêncio — a fila inteira parava até fechar o app. Passou
// do limite, a passada nova assume.
let inicioDaPassada = 0;
const LIMITE_PASSADA_MS = 3 * 60_000;

export async function processarFilaEnvio(usuarioId: string): Promise<ResultadoFilaEnvio> {
  if (emAndamento && Date.now() - inicioDaPassada < LIMITE_PASSADA_MS) return RESULTADO_VAZIO;
  emAndamento = true;
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
    filaEnvioEvents.dispatchEvent(new Event(FILA_ENVIO_ATUALIZADA_EVENT));
    if (resultado.visitasEnviadas + resultado.registrosEnviados + resultado.checkoutsConfirmados > 0) {
      filaEnvioEvents.dispatchEvent(new Event(FILA_ENVIO_SERVIDOR_MUDOU_EVENT));
    }
  }

  return resultado;
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

  if (visita.status === 'FINALIZADA_LOCAL') {
    if (await enviarCheckout(visita)) resultado.checkoutsConfirmados += 1;
  }
}

async function enviarCheckin(visita: VisitaLocal, resultado: ResultadoFilaEnvio): Promise<boolean> {
  try {
    const servidor = await iniciarVisita({
      ponto_venda_uuid: visita.pontoVenda.id,
      latitude: visita.latitudeInicio,
      longitude: visita.longitudeInicio,
      ordem_servico_uuid: visita.ordemServicoId ?? undefined,
      // Mesmo uuid local em toda tentativa desta visita — é o que torna seguro reter e tentar
      // de novo abaixo mesmo quando a falha foi transitória (o servidor pode até ter processado
      // a chamada anterior sem a resposta chegar até aqui).
      idempotency_key: visita.id,
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
    await marcarRegistroComErro(registro.id, mensagemDeErroServidor(err) ?? 'Registro recusado pelo servidor.');
    resultado.registrosComErro += 1;
    return true; // erro de validação de UM registro não trava os outros nem o checkout
  }
}

async function enviarCheckout(visita: VisitaLocal): Promise<boolean> {
  try {
    await finalizarVisita(visita.servidorId!, visita.latitudeFim!, visita.longitudeFim!);
    // Servidor já tem tudo (check-in, registros e checkout confirmados) — a cópia local perdeu
    // utilidade, HistoricoScreen/VisitaDetalhe passam a mostrar essa visita vinda de lá.
    console.log(`[fila] checkout confirmado pelo servidor (visita ${visita.id})`);
    await excluirVisitaLocalCompleta(visita.id, 'checkout-confirmado');
    return true;
  } catch (err) {
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
