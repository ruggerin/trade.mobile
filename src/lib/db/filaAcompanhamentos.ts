import type { AcompanhamentoAberto, RespostaAcompanhamento } from '../../types/api';
import { escrever, getDatabase } from './database';

// "Ainda está lá?" (docs/83 §5.4): os acompanhamentos abertos de cada loja (cache da carga do
// detalhe do PDV, offline) e a fila das respostas dadas no celular.

export async function salvarAcompanhamentosCache(pontoVendaUuid: string, abertos: AcompanhamentoAberto[]): Promise<void> {
  await escrever('INSERT OR REPLACE INTO acompanhamentos_pdv (ponto_venda_id, dados, atualizado_em) VALUES (?, ?, ?)', [
    pontoVendaUuid,
    JSON.stringify(abertos),
    new Date().toISOString(),
  ]);
}

export async function lerAcompanhamentosCache(pontoVendaUuid: string): Promise<AcompanhamentoAberto[]> {
  const db = await getDatabase();
  const linha = await db.getFirstAsync<{ dados: string }>('SELECT dados FROM acompanhamentos_pdv WHERE ponto_venda_id = ?', [pontoVendaUuid]);
  return linha ? (JSON.parse(linha.dados) as AcompanhamentoAberto[]) : [];
}

export interface RespostaLocal {
  /** Também é a idempotency_key do envio. */
  id: string;
  visitaLocalId: string;
  acompanhamentoUuid: string;
  resposta: RespostaAcompanhamento;
  /** Registro do formulário de "Continua" ou da justificativa — vai antes, no mesmo envio. */
  registroLocalId: string | null;
  status: 'PENDENTE' | 'ENVIADO';
  erro: string | null;
  criadoEm: string;
}

interface Linha {
  id: string;
  visita_local_id: string;
  acompanhamento_uuid: string;
  resposta: string;
  registro_local_id: string | null;
  status: string;
  erro: string | null;
  criado_em: string;
}

const paraResposta = (l: Linha): RespostaLocal => ({
  id: l.id,
  visitaLocalId: l.visita_local_id,
  acompanhamentoUuid: l.acompanhamento_uuid,
  resposta: l.resposta as RespostaAcompanhamento,
  registroLocalId: l.registro_local_id,
  status: l.status as RespostaLocal['status'],
  erro: l.erro,
  criadoEm: l.criado_em,
});

export async function criarRespostaLocal(dados: {
  id: string;
  visitaLocalId: string;
  acompanhamentoUuid: string;
  resposta: RespostaAcompanhamento;
  registroLocalId?: string | null;
}): Promise<void> {
  const agora = new Date().toISOString();
  await escrever(
    `INSERT INTO fila_acompanhamentos (id, visita_local_id, acompanhamento_uuid, resposta, registro_local_id, status, erro, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, 'PENDENTE', NULL, ?, ?)`,
    [dados.id, dados.visitaLocalId, dados.acompanhamentoUuid, dados.resposta, dados.registroLocalId ?? null, agora, agora],
  );
}

export async function listarRespostasDaVisita(visitaLocalId: string): Promise<RespostaLocal[]> {
  const db = await getDatabase();
  const linhas = await db.getAllAsync<Linha>('SELECT * FROM fila_acompanhamentos WHERE visita_local_id = ? ORDER BY criado_em', [visitaLocalId]);
  return linhas.map(paraResposta);
}

/**
 * Acompanhamentos já respondidos em OUTRAS visitas deste aparelho — ainda na fila, ou enviados
 * hoje — o cartão some enquanto isso, pra ninguém responder duas vezes no mesmo celular.
 */
export async function acompanhamentosRespondidosEmOutrasVisitas(visitaAtualId: string): Promise<Set<string>> {
  const db = await getDatabase();
  // Já enviado só esconde no mesmo dia: o cache da loja pode não ter atualizado ainda, mas no dia
  // seguinte "Não consegui ver" (ou intervalo 0) tem que voltar.
  const inicioDoDia = new Date();
  inicioDoDia.setHours(0, 0, 0, 0);
  const linhas = await db.getAllAsync<{ acompanhamento_uuid: string }>(
    `SELECT DISTINCT acompanhamento_uuid FROM fila_acompanhamentos
      WHERE visita_local_id <> ? AND (status = 'PENDENTE' OR criado_em >= ?)`,
    [visitaAtualId, inicioDoDia.toISOString()],
  );
  return new Set(linhas.map((l) => l.acompanhamento_uuid));
}

export async function marcarRespostaEnviada(id: string): Promise<void> {
  await escrever("UPDATE fila_acompanhamentos SET status = 'ENVIADO', erro = NULL, atualizado_em = ? WHERE id = ?", [new Date().toISOString(), id]);
}

export async function marcarRespostaComErro(id: string, erro: string): Promise<void> {
  await escrever('UPDATE fila_acompanhamentos SET erro = ?, atualizado_em = ? WHERE id = ?', [erro, new Date().toISOString(), id]);
}

export async function excluirRespostasDaVisita(visitaLocalId: string): Promise<void> {
  await escrever('DELETE FROM fila_acompanhamentos WHERE visita_local_id = ?', [visitaLocalId]);
}
