import { getDatabase, comTransacao } from './database';

interface ParametroCache {
  chave: string;
  valor: string;
  ativo: boolean;
}

export async function salvarParametrosCache(parametros: ParametroCache[]): Promise<void> {
  const db = await getDatabase();
  const agora = new Date().toISOString();

  await comTransacao(db, async () => {
    // Substitui o cache inteiro (mesmo padrão de pontosVendaCache.ts) — sem isso, uma chave
    // removida da resposta da API ficava presa no cache do aparelho pra sempre, porque um
    // simples upsert nunca remove o que não veio na lista nova.
    await db.runAsync('DELETE FROM parametros');
    for (const parametro of parametros) {
      await db.runAsync('INSERT INTO parametros (chave, valor, ativo, atualizado_em) VALUES (?, ?, ?, ?)', [
        parametro.chave,
        parametro.valor,
        parametro.ativo ? 1 : 0,
        agora,
      ]);
    }
  });
}

export async function lerParametrosCache(): Promise<ParametroCache[]> {
  const db = await getDatabase();
  const linhas = await db.getAllAsync<{ chave: string; valor: string; ativo: number }>(
    'SELECT chave, valor, ativo FROM parametros',
  );
  return linhas.map((linha) => ({ chave: linha.chave, valor: linha.valor, ativo: linha.ativo === 1 }));
}
