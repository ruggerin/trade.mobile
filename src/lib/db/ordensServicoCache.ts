import type { OrdemServico } from '../../types/api';
import { getDatabase, comTransacao } from './database';

export async function salvarOrdensServicoCache(ordensServico: OrdemServico[]): Promise<void> {
  const db = await getDatabase();
  const agora = new Date().toISOString();

  await comTransacao(db, async () => {
    await db.runAsync('DELETE FROM ordens_servico');
    for (const os of ordensServico) {
      await db.runAsync('INSERT INTO ordens_servico (id, dados, atualizado_em) VALUES (?, ?, ?)', [
        os.id,
        JSON.stringify(os),
        agora,
      ]);
    }
  });
}

export async function lerOrdensServicoCache(): Promise<OrdemServico[]> {
  const db = await getDatabase();
  const linhas = await db.getAllAsync<{ dados: string }>('SELECT dados FROM ordens_servico');
  return linhas.map((linha) => JSON.parse(linha.dados) as OrdemServico);
}
