import * as FileSystem from 'expo-file-system/legacy';
import type { PontoVenda } from '../../types/api';
import { gerarUuidLocal } from '../uuid';
import { getDatabase, escrever } from './database';
import { excluirRegistrosDaVisita, listarRegistrosLocais } from './filaRegistros';

/**
 * Ver docs/04-APP-MOBILE.md "Fila offline de envio" e o comentário no topo de `database.ts`.
 *
 * RASCUNHO         check-in ainda não foi tentado, ou tentou e caiu por falta de rede.
 * CHECKIN_ENVIADO  servidor aceitou o check-in.
 * FINALIZADA_LOCAL promotor tocou "finalizar" localmente; falta confirmar o checkout.
 * REJEITADA        servidor recusou o check-in (ex.: fora do raio) — terminal, promotor
 *                   precisa ver e descartar.
 *
 * Não existe status "SINCRONIZADA" visível: assim que o checkout é confirmado, a linha (e seus
 * registros) é apagada — o dado definitivo já mora no servidor, HistoricoScreen/VisitaDetalhe
 * mostram a visita de lá normalmente.
 */
export type StatusVisitaLocal = 'RASCUNHO' | 'CHECKIN_ENVIADO' | 'FINALIZADA_LOCAL' | 'REJEITADA';

export interface VisitaLocal {
  id: string;
  usuarioId: string;
  servidorId: string | null;
  status: StatusVisitaLocal;
  pontoVenda: PontoVenda;
  ordemServicoId: string | null;
  latitudeInicio: number;
  longitudeInicio: number;
  inicioEm: string;
  latitudeFim: number | null;
  longitudeFim: number | null;
  fimEm: string | null;
  erro: string | null;
  criadoEm: string;
  atualizadoEm: string;
}

interface LinhaFilaVisita {
  id: string;
  usuario_id: string;
  servidor_id: string | null;
  status: string;
  ponto_venda_id: string;
  ponto_venda_json: string;
  ordem_servico_id: string | null;
  latitude_inicio: number;
  longitude_inicio: number;
  inicio_em: string;
  latitude_fim: number | null;
  longitude_fim: number | null;
  fim_em: string | null;
  erro: string | null;
  criado_em: string;
  atualizado_em: string;
}

function paraVisitaLocal(linha: LinhaFilaVisita): VisitaLocal {
  return {
    id: linha.id,
    usuarioId: linha.usuario_id,
    servidorId: linha.servidor_id,
    status: linha.status as StatusVisitaLocal,
    pontoVenda: JSON.parse(linha.ponto_venda_json) as PontoVenda,
    ordemServicoId: linha.ordem_servico_id,
    latitudeInicio: linha.latitude_inicio,
    longitudeInicio: linha.longitude_inicio,
    inicioEm: linha.inicio_em,
    latitudeFim: linha.latitude_fim,
    longitudeFim: linha.longitude_fim,
    fimEm: linha.fim_em,
    erro: linha.erro,
    criadoEm: linha.criado_em,
    atualizadoEm: linha.atualizado_em,
  };
}

export interface NovaVisitaLocal {
  usuarioId: string;
  pontoVenda: PontoVenda;
  ordemServicoId?: string | null;
  latitude: number;
  longitude: number;
}

/** Chamado no instante em que o promotor toca "Iniciar visita" — sempre síncrono/local, nunca depende de rede. */
export async function criarVisitaLocal(dados: NovaVisitaLocal): Promise<VisitaLocal> {
  const db = await getDatabase();
  const agora = new Date().toISOString();
  const id = gerarUuidLocal();

  await escrever(
    `INSERT INTO fila_visitas (
      id, usuario_id, servidor_id, status, ponto_venda_id, ponto_venda_json, ordem_servico_id,
      latitude_inicio, longitude_inicio, inicio_em, latitude_fim, longitude_fim, fim_em, erro,
      criado_em, atualizado_em
    ) VALUES (?, ?, NULL, 'RASCUNHO', ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
    [
      id,
      dados.usuarioId,
      dados.pontoVenda.id,
      JSON.stringify(dados.pontoVenda),
      dados.ordemServicoId ?? null,
      dados.latitude,
      dados.longitude,
      agora,
      agora,
      agora,
    ],
  );

  return {
    id,
    usuarioId: dados.usuarioId,
    servidorId: null,
    status: 'RASCUNHO',
    pontoVenda: dados.pontoVenda,
    ordemServicoId: dados.ordemServicoId ?? null,
    latitudeInicio: dados.latitude,
    longitudeInicio: dados.longitude,
    inicioEm: agora,
    latitudeFim: null,
    longitudeFim: null,
    fimEm: null,
    erro: null,
    criadoEm: agora,
    atualizadoEm: agora,
  };
}

export async function lerVisitaLocal(id: string): Promise<VisitaLocal | null> {
  const db = await getDatabase();
  const linha = await db.getFirstAsync<LinhaFilaVisita>('SELECT * FROM fila_visitas WHERE id = ?', [id]);
  return linha ? paraVisitaLocal(linha) : null;
}

/** Pro banner "visita em andamento" (PontosVendaListScreen) — só do promotor logado agora, nunca de quem usou o aparelho antes. */
export async function listarVisitasLocaisAbertas(usuarioId: string): Promise<VisitaLocal[]> {
  const db = await getDatabase();
  const linhas = await db.getAllAsync<LinhaFilaVisita>(
    `SELECT * FROM fila_visitas
     WHERE usuario_id = ? AND status IN ('RASCUNHO', 'CHECKIN_ENVIADO', 'FINALIZADA_LOCAL')
     ORDER BY criado_em DESC`,
    [usuarioId],
  );
  return linhas.map(paraVisitaLocal);
}

/** Pro card de "aguardando envio"/"rejeitada" no topo do Histórico. */
export async function listarVisitasLocaisPendentesOuRejeitadas(usuarioId: string): Promise<VisitaLocal[]> {
  const db = await getDatabase();
  const linhas = await db.getAllAsync<LinhaFilaVisita>(
    'SELECT * FROM fila_visitas WHERE usuario_id = ? ORDER BY criado_em DESC',
    [usuarioId],
  );
  return linhas.map(paraVisitaLocal);
}

/**
 * `servidor_id` é sempre gravado — precisa existir independente de qualquer coisa, é ele que
 * permite mandar registros/checkout depois. Já o `status` só avança de RASCUNHO pra
 * CHECKIN_ENVIADO — nunca sobrescreve um status mais adiantado. Sem essa guarda, uma corrida
 * real acontece: o promotor toca "Finalizar visita" (grava FINALIZADA_LOCAL + coordenadas)
 * enquanto a resposta do check-in ainda está voltando da rede; quando ela chega, um UPDATE
 * incondicional aqui reescrevia o status de volta pra CHECKIN_ENVIADO — o checkout já gravado
 * ficava com os dados prontos mas o status nunca mais batia com `FINALIZADA_LOCAL` (nem nesta
 * passada da fila, nem em nenhuma futura), então o checkout nunca era enviado e a visita ficava
 * "aberta" pro sempre no servidor.
 */
export async function marcarCheckinEnviado(id: string, servidorId: string): Promise<void> {
  const db = await getDatabase();
  await escrever(
    `UPDATE fila_visitas
     SET status = CASE WHEN status = 'RASCUNHO' THEN 'CHECKIN_ENVIADO' ELSE status END,
         servidor_id = ?, erro = NULL, atualizado_em = ?
     WHERE id = ?`,
    [servidorId, new Date().toISOString(), id],
  );
}

export async function marcarVisitaRejeitada(id: string, erro: string): Promise<void> {
  const db = await getDatabase();
  await escrever(`UPDATE fila_visitas SET status = 'REJEITADA', erro = ?, atualizado_em = ? WHERE id = ?`, [
    erro,
    new Date().toISOString(),
    id,
  ]);
}

/**
 * Guarda a última mensagem de erro sem mudar o status — usado tanto pro check-in que caiu por
 * falta de rede (continua RASCUNHO, tenta de novo sozinho) quanto pro checkout que falhou
 * (continua FINALIZADA_LOCAL — não existe "checkout rejeitado" terminal, a regra de raio só
 * vale no check-in, ver docs/02-API-BACKEND.md regra de negócio 1). Só pra exibição na UI.
 */
export async function atualizarErroVisita(id: string, erro: string): Promise<void> {
  const db = await getDatabase();
  await escrever(`UPDATE fila_visitas SET erro = ?, atualizado_em = ? WHERE id = ?`, [
    erro,
    new Date().toISOString(),
    id,
  ]);
}

/**
 * Desfaz o "finalizar" local: FINALIZADA_LOCAL volta a CHECKIN_ENVIADO (ou RASCUNHO, se o check-in
 * nunca chegou no servidor) e limpa o checkout gravado. É a saída quando o servidor recusa o
 * checkout de forma permanente (ex.: formulário obrigatório de Direcionamento pendente) — sem
 * isso a visita ficava presa em FINALIZADA_LOCAL reenviando o mesmo checkout recusado pra sempre.
 */
export async function reabrirVisitaLocal(id: string): Promise<void> {
  const db = await getDatabase();
  await escrever(
    `UPDATE fila_visitas
     SET status = CASE WHEN servidor_id IS NULL THEN 'RASCUNHO' ELSE 'CHECKIN_ENVIADO' END,
         latitude_fim = NULL, longitude_fim = NULL, fim_em = NULL, erro = NULL, atualizado_em = ?
     WHERE id = ? AND status = 'FINALIZADA_LOCAL'`,
    [new Date().toISOString(), id],
  );
}

export async function finalizarVisitaLocal(id: string, latitude: number, longitude: number): Promise<void> {
  const db = await getDatabase();
  const agora = new Date().toISOString();
  await escrever(
    `UPDATE fila_visitas SET status = 'FINALIZADA_LOCAL', latitude_fim = ?, longitude_fim = ?, fim_em = ?, atualizado_em = ? WHERE id = ?`,
    [latitude, longitude, agora, agora, id],
  );
}

/**
 * Chamado em dois momentos: (1) checkout confirmado pelo servidor — a visita já existe lá,
 * essa cópia local perdeu utilidade; (2) promotor descarta uma visita REJEITADA de propósito.
 * Remove a linha, os registros filhos e qualquer imagem copiada pro disco (ver
 * `lib/db/filaRegistros.ts`) — nunca deixa arquivo órfão ocupando espaço no aparelho.
 */
export type MotivoExclusaoVisita =
  | 'checkout-confirmado'
  | 'descarte-rejeitada'
  | 'descarte-forcado'
  | 'cancelamento-pelo-promotor';

export async function excluirVisitaLocalCompleta(id: string, motivo: MotivoExclusaoVisita): Promise<void> {
  // Log pra rastrear "a visita sumiu": sempre diz QUEM apagou a visita do aparelho.
  console.log(`[fila] visita ${id} removida do aparelho — motivo: ${motivo}`);
  const registros = await listarRegistrosLocais(id);
  for (const registro of registros) {
    for (const uri of registro.imagensLocais) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  }
  await excluirRegistrosDaVisita(id);

  const db = await getDatabase();
  await escrever('DELETE FROM fila_visitas WHERE id = ?', [id]);
}
