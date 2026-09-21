import type { TipoRegistro } from '../../types/api';
import { getDatabase, comTransacao } from './database';

export async function salvarTiposRegistroCache(tiposRegistro: TipoRegistro[]): Promise<void> {
  const db = await getDatabase();
  const agora = new Date().toISOString();

  await comTransacao(db, async () => {
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
  const tipos = linhas.map((linha) => JSON.parse(linha.dados) as TipoRegistro);
  // SQLite sem ORDER BY não garante devolver na ordem de inserção — sem isso, a sequência de
  // exibição escolhida no admin (TipoRegistro.ordem) só valeria com sinal, sumindo assim que o
  // promotor abrisse o formulário offline. A rede (lib/api/tiposRegistro.ts, caminho feliz) já
  // vem ordenada pela própria API, isso aqui é só o fallback do cache.
  return tipos.sort((a, b) => a.ordem - b.ordem);
}
