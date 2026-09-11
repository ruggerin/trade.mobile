import type { RegistroFormResultado } from '../components/RegistroFormModal';
import { cancelarRegistro } from './api/visitas';
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

export async function iniciarVisitaLocal(params: IniciarVisitaLocalParams): Promise<VisitaLocal> {
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
  // `resultado.imagemUri` já é um caminho persistente (copiado na hora da captura, ver
  // RegistroFormModal.capturarFoto) — não copia de novo aqui. Copiar de novo criaria uma SEGUNDA
  // cópia nunca referenciada por nenhuma linha (a foto que o modal já copiou continua sendo a
  // única referenciada), um vazamento de arquivo em vez de zero.
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
      momento: params.resultado.momento,
      imagemLocalPath: params.resultado.imagemUri ?? null,
    });

    sincronizarEmSegundoPlano(params.usuarioId);
    return registro;
  } catch (err) {
    // O INSERT no SQLite falhou depois da foto já ter sido copiada pro armazenamento
    // persistente (na captura, não aqui) — sem essa limpeza, o arquivo ficava no disco sem
    // nenhuma linha de fila_registros apontando pra ele (o modal não limpa mais nesse caso,
    // porque já marcou como "submetido" antes de chamar esta função).
    if (params.resultado.imagemUri) {
      void apagarImagemPersistente(params.resultado.imagemUri);
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
  await finalizarVisitaLocalDb(params.visitaLocalId, params.latitude, params.longitude);
  sincronizarEmSegundoPlano(params.usuarioId);
}

/** Promotor decide descartar uma visita REJEITADA (ex.: check-in fora do raio) — apaga tudo, inclusive fotos já tiradas. Ação irreversível, ver confirmação na tela. */
export async function descartarVisitaRejeitada(visitaLocalId: string): Promise<void> {
  await excluirVisitaLocalCompleta(visitaLocalId);
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

  if (registro.imagemLocalPath) {
    void apagarImagemPersistente(registro.imagemLocalPath);
  }
  await excluirRegistroLocal(registro.id);
}
