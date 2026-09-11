import type { ProdutoDisponivel } from '../../types/api';
import { getDatabase } from './database';

export async function salvarProdutosDisponiveisCache(
  pontoVendaUuid: string,
  produtos: ProdutoDisponivel[],
): Promise<void> {
  const db = await getDatabase();
  const agora = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    // Substitui só o recorte daquele PDV — cada loja tem sua própria "última resposta boa"
    // independente das outras.
    await db.runAsync('DELETE FROM produtos_disponiveis WHERE ponto_venda_id = ?', [pontoVendaUuid]);
    for (const produto of produtos) {
      await db.runAsync(
        'INSERT INTO produtos_disponiveis (ponto_venda_id, produto_uuid, dados, atualizado_em) VALUES (?, ?, ?, ?)',
        [pontoVendaUuid, produto.produto_uuid, JSON.stringify(produto), agora],
      );
    }
  });
}

export async function lerProdutosDisponiveisCache(pontoVendaUuid: string): Promise<ProdutoDisponivel[]> {
  const db = await getDatabase();
  const linhas = await db.getAllAsync<{ dados: string }>(
    'SELECT dados FROM produtos_disponiveis WHERE ponto_venda_id = ?',
    [pontoVendaUuid],
  );
  return linhas.map((linha) => JSON.parse(linha.dados) as ProdutoDisponivel);
}
