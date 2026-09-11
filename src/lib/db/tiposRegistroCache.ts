import type { TipoRegistro } from '../../types/api';
import { getDatabase } from './database';

export async function salvarTiposRegistroCache(tiposRegistro: TipoRegistro[]): Promise<void> {
  const db = await getDatabase();
  const agora = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    // Substitui o cache inteiro — mesmo raciocínio de pontosVendaCache.ts: a busca não é
    // paginada (o app sempre pede a lista ativa inteira da empresa), então "o que veio agora"
    // já é a verdade inteira.
    await db.runAsync('DELETE FROM tipos_registro');
    for (const tipo of tiposRegistro) {
      await db.runAsync('INSERT INTO tipos_registro (id, dados, atualizado_em) VALUES (?, ?, ?)', [
        tipo.id,
        JSON.stringify(tipo),
        agora,
      ]);
    }
  });
}

export async function lerTiposRegistroCache(): Promise<TipoRegistro[]> {
  const db = await getDatabase();
  const linhas = await db.getAllAsync<{ dados: string }>('SELECT dados FROM tipos_registro');
  return linhas.map((linha) => JSON.parse(linha.dados) as TipoRegistro);
}
