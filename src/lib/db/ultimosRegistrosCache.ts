import { getDatabase } from './database';

// Último registro de cada formulário com intervalo nesta loja — `{uuid_do_formulario: data ISO}`
// (docs/80 §5.2). Gravado junto do detalhe do PDV; lido pela regra de Ação (lib/acaoObrigatoria.ts).
export type UltimosRegistros = Record<string, string>;

export async function salvarUltimosRegistrosCache(pontoVendaUuid: string, ultimos: UltimosRegistros): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'INSERT OR REPLACE INTO ultimos_registros_pdv (ponto_venda_id, dados, atualizado_em) VALUES (?, ?, ?)',
    [pontoVendaUuid, JSON.stringify(ultimos), new Date().toISOString()],
  );
}

export async function lerUltimosRegistrosCache(pontoVendaUuid: string): Promise<UltimosRegistros> {
  const db = await getDatabase();
  const linha = await db.getFirstAsync<{ dados: string }>('SELECT dados FROM ultimos_registros_pdv WHERE ponto_venda_id = ?', [
    pontoVendaUuid,
  ]);
  return linha ? (JSON.parse(linha.dados) as UltimosRegistros) : {};
}

/**
 * Registros de OUTRAS visitas desta loja que ainda estão no celular (fila de envio) — o cache do
 * servidor só os conhece depois de sincronizar (docs/80 §5.6). Sem isso, um levantamento feito
 * ontem sem sinal cobrava a Ação de novo hoje. A visita atual fica de fora: registro dela faz a Ação
 * aparecer feita, não sumir. Registro descartado (visita recusada) não conta.
 */
export async function lerUltimosRegistrosNaFila(pontoVendaUuid: string, visitaAtualId: string): Promise<UltimosRegistros> {
  const db = await getDatabase();
  const linhas = await db.getAllAsync<{ tipo_registro_uuid: string; ultimo: string }>(
    `SELECT r.tipo_registro_uuid, MAX(r.criado_em) AS ultimo
       FROM fila_registros r
       JOIN fila_visitas v ON v.id = r.visita_local_id
      WHERE v.ponto_venda_id = ? AND v.id <> ? AND r.status <> 'DESCARTADO'
      GROUP BY r.tipo_registro_uuid`,
    [pontoVendaUuid, visitaAtualId],
  );
  return Object.fromEntries(linhas.map((l) => [l.tipo_registro_uuid, l.ultimo]));
}
