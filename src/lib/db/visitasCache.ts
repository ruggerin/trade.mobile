import type { Visita } from '../../types/api';
import { getDatabase } from './database';

export async function salvarVisitasHistoricoCache(visitas: Visita[]): Promise<void> {
  const db = await getDatabase();
  const agora = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    // Mesma lógica de pontosVendaCache: a API não pagina esse endpoint pro promotor, então a
    // resposta inteira já é "a verdade toda" — substitui, não faz merge incremental.
    await db.runAsync('DELETE FROM visitas_historico');
    for (const visita of visitas) {
      await db.runAsync('INSERT INTO visitas_historico (id, dados, atualizado_em) VALUES (?, ?, ?)', [
        visita.id,
        JSON.stringify(visita),
        agora,
      ]);
    }
  });
}

export async function lerVisitasHistoricoCache(): Promise<Visita[]> {
  const db = await getDatabase();
  const linhas = await db.getAllAsync<{ dados: string }>('SELECT dados FROM visitas_historico');
  return linhas.map((linha) => JSON.parse(linha.dados) as Visita);
}
