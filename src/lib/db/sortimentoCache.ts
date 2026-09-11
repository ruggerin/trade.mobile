import type { SortimentoPontoVenda } from '../../types/api';
import { getDatabase } from './database';

export async function salvarSortimentoCache(pontoVendaUuid: string, itens: SortimentoPontoVenda[]): Promise<void> {
  const db = await getDatabase();
  const agora = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM sortimento_ponto_venda WHERE ponto_venda_id = ?', [pontoVendaUuid]);
    for (const item of itens) {
      await db.runAsync(
        'INSERT INTO sortimento_ponto_venda (ponto_venda_id, item_uuid, dados, atualizado_em) VALUES (?, ?, ?, ?)',
        [pontoVendaUuid, item.id, JSON.stringify(item), agora],
      );
    }
  });
}

export async function lerSortimentoCache(pontoVendaUuid: string): Promise<SortimentoPontoVenda[]> {
  const db = await getDatabase();
  const linhas = await db.getAllAsync<{ dados: string }>(
    'SELECT dados FROM sortimento_ponto_venda WHERE ponto_venda_id = ?',
    [pontoVendaUuid],
  );
  return linhas.map((linha) => JSON.parse(linha.dados) as SortimentoPontoVenda);
}
