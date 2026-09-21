import type { CatalogoItem } from '../../types/api';
import { getDatabase, comTransacao } from './database';

export type TipoCatalogo = 'SECAO' | 'DEPARTAMENTO' | 'MARCA';

export async function salvarCatalogoCache(tipo: TipoCatalogo, itens: CatalogoItem[]): Promise<void> {
  const db = await getDatabase();
  const agora = new Date().toISOString();

  await comTransacao(db, async () => {
    await db.runAsync('DELETE FROM catalogo_auditoria WHERE tipo = ?', [tipo]);
    for (const item of itens) {
      await db.runAsync('INSERT INTO catalogo_auditoria (tipo, id, dados, atualizado_em) VALUES (?, ?, ?, ?)', [
        tipo,
        item.id,
        JSON.stringify(item),
        agora,
      ]);
    }
  });
}

export async function lerCatalogoCache(tipo: TipoCatalogo): Promise<CatalogoItem[]> {
  const db = await getDatabase();
  const linhas = await db.getAllAsync<{ dados: string }>('SELECT dados FROM catalogo_auditoria WHERE tipo = ?', [tipo]);
  return linhas.map((linha) => JSON.parse(linha.dados) as CatalogoItem);
}
