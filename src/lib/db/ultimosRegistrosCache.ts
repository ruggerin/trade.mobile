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
