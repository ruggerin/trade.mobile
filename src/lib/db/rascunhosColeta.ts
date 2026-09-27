import { apagarImagemPersistente } from './filaRegistros';
import { escrever, getDatabase } from './database';

// Rascunho da coleta guiada (formulário com lista predefinida de produtos): o promotor preenche
// produto por produto e só no "Salvar" final tudo vira registro na fila de envio. Até lá fica aqui
// — no SQLite, não em memória, pra sobreviver ao app fechar no meio de uma pesquisa de 15 produtos.
// Uma linha por (visita local × tipo de registro), com todos os produtos num JSON.

export interface RascunhoProduto {
  descricao: string;
  // Como estão no formulário (MOEDA ainda mascarado, "1.234,56") — normaliza só no envio.
  valoresCampos: Record<string, string>;
  // Cópias persistentes das fotos (mesmo esquema da fila de registros).
  imagensUri: string[];
  ruptura: boolean;
}

export type RascunhosColeta = Record<string, RascunhoProduto>; // produtoUuid → rascunho

export async function lerRascunhosColeta(visitaLocalId: string, tipoRegistroUuid: string): Promise<RascunhosColeta> {
  const db = await getDatabase();
  const linha = await db.getFirstAsync<{ dados_json: string }>(
    'SELECT dados_json FROM rascunhos_coleta WHERE visita_local_id = ? AND tipo_registro_uuid = ?',
    [visitaLocalId, tipoRegistroUuid],
  );
  if (!linha) return {};
  try {
    return JSON.parse(linha.dados_json) as RascunhosColeta;
  } catch {
    return {};
  }
}

export async function salvarRascunhosColeta(
  visitaLocalId: string,
  tipoRegistroUuid: string,
  rascunhos: RascunhosColeta,
): Promise<void> {
  if (Object.keys(rascunhos).length === 0) {
    await escrever('DELETE FROM rascunhos_coleta WHERE visita_local_id = ? AND tipo_registro_uuid = ?', [
      visitaLocalId,
      tipoRegistroUuid,
    ]);
    return;
  }
  await escrever(
    `INSERT INTO rascunhos_coleta (visita_local_id, tipo_registro_uuid, dados_json, atualizado_em)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (visita_local_id, tipo_registro_uuid) DO UPDATE SET dados_json = excluded.dados_json, atualizado_em = excluded.atualizado_em`,
    [visitaLocalId, tipoRegistroUuid, JSON.stringify(rascunhos), new Date().toISOString()],
  );
}

/** Visita descartada/excluída: some o rascunho e as fotos dele (ninguém mais aponta pra elas). */
export async function apagarRascunhosDaVisita(visitaLocalId: string): Promise<void> {
  const db = await getDatabase();
  const linhas = await db.getAllAsync<{ dados_json: string }>(
    'SELECT dados_json FROM rascunhos_coleta WHERE visita_local_id = ?',
    [visitaLocalId],
  );
  for (const linha of linhas) {
    try {
      const rascunhos = JSON.parse(linha.dados_json) as RascunhosColeta;
      for (const r of Object.values(rascunhos)) for (const uri of r.imagensUri) void apagarImagemPersistente(uri);
    } catch {
      // JSON corrompido — só apaga a linha.
    }
  }
  await escrever('DELETE FROM rascunhos_coleta WHERE visita_local_id = ?', [visitaLocalId]);
}
