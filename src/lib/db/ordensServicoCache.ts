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

export async function salvarOrdemServicoDetalheCache(os: OrdemServico): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('INSERT OR REPLACE INTO ordem_servico_detalhe (id, dados, atualizado_em) VALUES (?, ?, ?)', [
    os.id,
    JSON.stringify(os),
    new Date().toISOString(),
  ]);
}

// Detalhe salvo da OS; sem ele, a mesma OS na lista de pendentes (que já traz os formulários) —
// cobre o check-in feito sem sinal, antes de o detalhe ter sido buscado alguma vez.
export async function lerOrdemServicoDetalheCache(id: string): Promise<OrdemServico | null> {
  const db = await getDatabase();
  const linha = await db.getFirstAsync<{ dados: string }>('SELECT dados FROM ordem_servico_detalhe WHERE id = ?', [id]);
  if (linha) return JSON.parse(linha.dados) as OrdemServico;
  return (await lerOrdensServicoCache()).find((os) => os.id === id) ?? null;
}
