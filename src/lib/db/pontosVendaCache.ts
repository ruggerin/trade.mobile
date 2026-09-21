import type { PontoVenda } from '../../types/api';
import { getDatabase, comTransacao } from './database';

export async function salvarPontosVendaCache(pontosVenda: PontoVenda[]): Promise<void> {
  const db = await getDatabase();
  const agora = new Date().toISOString();

  await comTransacao(db, async () => {
    // Substitui o cache inteiro (não faz merge incremental) — o app só busca a lista completa
    // do promotor de uma vez (sem paginação hoje), então "o que veio agora" já é a verdade
    // inteira; manter uma loja antiga que saiu da resposta seria mostrar algo desatualizado.
    await db.runAsync('DELETE FROM pontos_venda');
    for (const pontoVenda of pontosVenda) {
      await db.runAsync('INSERT INTO pontos_venda (id, dados, atualizado_em) VALUES (?, ?, ?)', [
        pontoVenda.id,
        JSON.stringify(pontoVenda),
        agora,
      ]);
    }
  });
}

export async function lerPontosVendaCache(): Promise<PontoVenda[]> {
  const db = await getDatabase();
  const linhas = await db.getAllAsync<{ dados: string }>('SELECT dados FROM pontos_venda');
  return linhas.map((linha) => JSON.parse(linha.dados) as PontoVenda);
}
