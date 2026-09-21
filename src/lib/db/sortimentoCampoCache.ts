import type { ProdutoSortimento } from '../api/campoSortimento';
import { getDatabase } from './database';

export async function salvarSortimentoCampoCache(
  campoUuid: string,
  pontoVendaUuid: string,
  produtos: ProdutoSortimento[],
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'INSERT OR REPLACE INTO sortimento_campo_cache (campo_uuid, ponto_venda_id, dados, atualizado_em) VALUES (?, ?, ?, ?)',
    [campoUuid, pontoVendaUuid, JSON.stringify(produtos), new Date().toISOString()],
  );
}

export async function lerSortimentoCampoCache(
  campoUuid: string,
  pontoVendaUuid: string,
): Promise<ProdutoSortimento[] | null> {
  const db = await getDatabase();
  const linha = await db.getFirstAsync<{ dados: string }>(
    'SELECT dados FROM sortimento_campo_cache WHERE campo_uuid = ? AND ponto_venda_id = ?',
    [campoUuid, pontoVendaUuid],
  );
  // `null` (não `[]`) quando nunca sincronizou pra esse PDV — permite ao chamador distinguir
  // "sem cache ainda" de "cache confirma que a lista está vazia mesmo".
  return linha ? (JSON.parse(linha.dados) as ProdutoSortimento[]) : null;
}
