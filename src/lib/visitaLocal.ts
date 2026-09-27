import type { RegistroFormResultado } from '../components/RegistroFormModal';
import { cancelarRegistro, cancelarVisita } from './api/visitas';
import type { PontoVenda } from '../types/api';
import {
  apagarImagemPersistente,
  criarRegistroLocal,
  excluirRegistroLocal,
  listarRegistrosLocais,
  type RegistroLocal,
} from './db/filaRegistros';
import {
  criarVisitaLocal,
  excluirVisitaLocalCompleta,
  finalizarVisitaLocal as finalizarVisitaLocalDb,
  lerVisitaLocal,
  listarVisitasLocaisAbertas,
  listarVisitasLocaisPendentesOuRejeitadas,
  reabrirVisitaLocal as reabrirVisitaLocalDb,
  type VisitaLocal,
} from './db/filaVisitas';
import { processarFilaEnvio } from './filaEnvio';

export type { VisitaLocal } from './db/filaVisitas';
export type { RegistroLocal } from './db/filaRegistros';
export { lerVisitaLocal, listarRegistrosLocais, listarVisitasLocaisAbertas, listarVisitasLocaisPendentesOuRejeitadas };

/**
 * API local-first que as telas usam pra check-in/registro/checkout — nunca chama
 * `lib/api/visitas.ts` diretamente (isso é trabalho do motor de sincronização, `filaEnvio.ts`).
 * Toda escrita aqui é local primeiro (sempre rápida, nunca depende de rede) e dispara uma
 * tentativa de sincronização em segundo plano — se a rede já estiver disponível, o efeito na
 * prática é quase idêntico ao fluxo antigo (visita aparece "enviada" segundos depois); se não
 * estiver, o promotor segue trabalhando normalmente e a fila cuida do resto sozinha quando o
 * sinal voltar (reconexão, volta de background — ver navigation/MainTabs.tsx).
 */

function sincronizarEmSegundoPlano(usuarioId: string): void {
  void processarFilaEnvio(usuarioId).catch(() => {});
}

export interface IniciarVisitaLocalParams {
  usuarioId: string;
  pontoVenda: PontoVenda;
  ordemServicoId?: string | null;
  latitude: number;
  longitude: number;
}

/**
 * Visita que o promotor ainda está fazendo (check-in feito, não finalizada) — FINALIZADA_LOCAL não
 * conta: pro promotor ela já acabou, só falta o checkout subir, e segurar a próxima loja por
 * causa de falta de sinal quebraria o offline-first.
 */
export async function buscarVisitaEmAndamento(usuarioId: string): Promise<VisitaLocal | null> {
  const abertas = await listarVisitasLocaisAbertas(usuarioId);
  return abertas.find((v) => v.status === 'RASCUNHO' || v.status === 'CHECKIN_ENVIADO') ?? null;
}

/** Promotor tentou iniciar uma visita tendo outra em andamento em OUTRA loja — premissa: uma visita por vez. */
export class VisitaEmAndamentoError extends Error {
  constructor(public readonly visita: VisitaLocal) {
    super(`Você já está em uma visita em ${visita.pontoVenda.fantasia}. Finalize-a antes de iniciar outra.`);
    this.name = 'VisitaEmAndamentoError';
  }
}

export async function iniciarVisitaLocal(params: IniciarVisitaLocalParams): Promise<VisitaLocal> {
  // Premissa: o promotor só tem UMA visita em andamento por vez. Se for nesta mesma loja, retoma
  // ela em vez de abrir outra (duas visitas abertas na mesma loja era o que fazia o formulário do
  // Direcionamento "não aparecer": a ordem de serviço fica presa à PRIMEIRA visita, e a segunda
  // nascia sem vínculo nenhum). Se for em outra loja, recusa — as telas já bloqueiam antes, isso
  // aqui é a última trava.
  const emAndamento = await buscarVisitaEmAndamento(params.usuarioId);
  if (emAndamento) {
    if (emAndamento.pontoVenda.id === params.pontoVenda.id) return emAndamento;
    throw new VisitaEmAndamentoError(emAndamento);
  }

  const visita = await criarVisitaLocal({
    usuarioId: params.usuarioId,
    pontoVenda: params.pontoVenda,
    ordemServicoId: params.ordemServicoId,
    latitude: params.latitude,
    longitude: params.longitude,
  });
  sincronizarEmSegundoPlano(params.usuarioId);
  return visita;
}

export interface CriarRegistroLocalParams {
  usuarioId: string;
  visitaLocalId: string;
  produtoDescricao?: string | null;
  resultado: RegistroFormResultado;
}

export async function criarRegistroVisitaLocal(params: CriarRegistroLocalParams): Promise<RegistroLocal> {
  // `resultado.imagensUri` já são caminhos persistentes (copiados na hora da captura, ver
  // RegistroFormModal.capturarFoto) — não copia de novo aqui. Copiar de novo criaria uma SEGUNDA
  // cópia nunca referenciada por nenhuma linha (as fotos que o modal já copiou continuam sendo
  // as únicas referenciadas), um vazamento de arquivo em vez de zero.
  try {
    const registro = await criarRegistroLocal({
      visitaLocalId: params.visitaLocalId,
      tipoRegistroUuid: params.resultado.tipoRegistroUuid,
      produtoAuditoriaUuid: params.resultado.produtoAuditoriaUuid,
      produtoDescricao: params.produtoDescricao,
      tipoVinculo: params.resultado.tipoVinculo,
      secaoUuid: params.resultado.secaoUuid,
      departamentoUuid: params.resultado.departamentoUuid,
      marcaUuid: params.resultado.marcaUuid,
      vinculoDescricao: params.resultado.vinculoLabel,
      valoresCampos: params.resultado.valoresCampos,
      ruptura: params.resultado.ruptura,
      imagensLocais: params.resultado.imagensUri ?? [],
    });

    sincronizarEmSegundoPlano(params.usuarioId);
    return registro;
  } catch (err) {
    // O INSERT no SQLite falhou depois das fotos já terem sido copiadas pro armazenamento
    // persistente (na captura, não aqui) — sem essa limpeza, os arquivos ficavam no disco sem
    // nenhuma linha de fila_registros apontando pra eles (o modal não limpa mais nesse caso,
    // porque já marcou como "submetido" antes de chamar esta função).
    for (const uri of params.resultado.imagensUri ?? []) {
      void apagarImagemPersistente(uri);
    }
    throw err;
  }
}

export interface FinalizarVisitaLocalParams {
  usuarioId: string;
  visitaLocalId: string;
  latitude: number;
  longitude: number;
}

export async function finalizarVisitaLocal(params: FinalizarVisitaLocalParams): Promise<void> {
  console.log(`[fila] promotor tocou em Finalizar (visita ${params.visitaLocalId})`);
  await finalizarVisitaLocalDb(params.visitaLocalId, params.latitude, params.longitude);
  sincronizarEmSegundoPlano(params.usuarioId);
}

/** Promotor decide descartar uma visita REJEITADA (ex.: check-in fora do raio) — apaga tudo, inclusive fotos já tiradas. Ação irreversível, ver confirmação na tela. */
export async function descartarVisitaRejeitada(visitaLocalId: string): Promise<void> {
  await excluirVisitaLocalCompleta(visitaLocalId, 'descarte-rejeitada');
}

/**
 * Saída de emergência pra visita TRAVADA na fila (check-in que nunca passa, registro que não sobe,
 * checkout recusado): apaga tudo daqui — linha, registros e fotos — SEM depender de rede nem do
 * parâmetro de cancelamento da empresa. Se o check-in já tinha chegado no servidor, tenta avisar
 * que a visita foi cancelada (melhor esforço: rede caída, parâmetro desligado ou visita já
 * fechada são ignorados — quem trava não pode ficar refém disso). Nesse caso, sem resposta do
 * servidor, a visita pode continuar "aberta" lá até o gestor encerrar pelo admin
 * (docs/15-INTERVENCAO-ADMINISTRATIVA-VISITA.md) — a tela avisa isso na confirmação.
 */
export async function descartarVisitaLocalForcado(visita: VisitaLocal): Promise<{ servidorAvisado: boolean }> {
  let servidorAvisado = !visita.servidorId;
  if (visita.servidorId) {
    try {
      await cancelarVisita(visita.servidorId);
      servidorAvisado = true;
    } catch {
      servidorAvisado = false;
    }
  }
  await excluirVisitaLocalCompleta(visita.id, 'descarte-forcado');
  return { servidorAvisado };
}

/** Desfaz o "finalizar" local pra o promotor completar o que falta (ex.: formulário obrigatório) e finalizar de novo. */
export async function reabrirVisitaLocal(visitaLocalId: string): Promise<void> {
  await reabrirVisitaLocalDb(visitaLocalId);
}

/** Toque manual em "Tentar enviar agora" — mesma passada da fila, só disparada pelo promotor. */
export async function tentarEnviarAgora(usuarioId: string): Promise<void> {
  await processarFilaEnvio(usuarioId);
}

/**
 * Promotor cancela (anula) a própria visita em andamento — o promotor já confirmou na tela
 * (Alert.alert), aqui só executa. Ação online quando o check-in já sincronizou (o servidor
 * precisa saber que a visita foi cancelada, ver VisitaController::cancelarPropria); se ainda não
 * sincronizou (`servidorId` null — status RASCUNHO), o servidor nunca chegou a saber dessa
 * visita, então é só apagar local, sem chamada de rede nenhuma — mesmo raciocínio de
 * `descartarVisitaRejeitada`. Lança erro se a chamada ao servidor falhar (rede caída, parâmetro
 * desligado) — a tela mostra o erro e o promotor tenta de novo.
 */
export async function cancelarVisitaLocal(visita: VisitaLocal): Promise<void> {
  if (visita.servidorId) {
    await cancelarVisita(visita.servidorId);
  }
  await excluirVisitaLocalCompleta(visita.id, 'cancelamento-pelo-promotor');
}

/**
 * Cancela um registro específico da visita em andamento — o promotor já confirmou na tela
 * (Alert.alert), aqui só executa. Ação online quando o registro já sincronizou (o servidor
 * precisa saber que foi cancelado, ver VisitaRegistroController::cancelar); se ainda não
 * sincronizou (`servidorId` null — PENDENTE ou ERRO), o servidor nunca chegou a saber desse
 * registro, então é só apagar local, sem chamada de rede nenhuma. Lança erro se a chamada ao
 * servidor falhar (rede caída, parâmetro desligado) — diferente do resto da fila, não tem fila
 * offline pra "cancelamento", é uma ação pontual, a tela mostra o erro e o promotor tenta de novo.
 */
export async function cancelarRegistroVisitaLocal(visitaServidorId: string | null, registro: RegistroLocal): Promise<void> {
  if (registro.servidorId) {
    if (!visitaServidorId) {
      throw new Error('Visita ainda não sincronizou com o servidor.');
    }
    await cancelarRegistro(visitaServidorId, registro.servidorId);
  }

  for (const uri of registro.imagensLocais) {
    void apagarImagemPersistente(uri);
  }
  await excluirRegistroLocal(registro.id);
}
