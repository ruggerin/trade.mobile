import type { ProdutoDisponivel } from '../../types/api';
import { ehErroDeRede } from '../db/database';
import { lerProdutosDisponiveisCache, salvarProdutosDisponiveisCache } from '../db/produtosDisponiveisCache';
import { apiClient } from './client';

// docs/02-API-BACKEND.md#consulta-para-o-app-mobile — resolve os produtos a auditar naquele
// PDV a partir das campanhas ativas/vigentes (algoritmo já roda no backend, ver regra de
// negócio 2). O app só lista o que vier aqui, nunca decide "o que auditar" sozinho.
//
// Cache local por PDV (SQLite, ver lib/db/database.ts): é o mais perto que existe hoje de
// "produtos vinculados à loja" — não é um cadastro de sortimento por PDV (isso não existe no
// backend ainda), é o resultado já resolvido de quais produtos essa loja precisa auditar agora.
// Sem rede, o promotor continua vendo a última lista boa em vez de tela em branco — só não
// reflete campanha nova nem alteração de vigência criada depois da última sincronização.
export async function buscarProdutosDisponiveis(pontoVendaUuid: string): Promise<ProdutoDisponivel[]> {
  try {
    const { data } = await apiClient.get<{ produtos: ProdutoDisponivel[] }>(
      '/campanhas-auditoria/disponiveis',
      { params: { ponto_venda_uuid: pontoVendaUuid } },
    );
    void salvarProdutosDisponiveisCache(pontoVendaUuid, data.produtos).catch(() => {});
    return data.produtos;
  } catch (err) {
    if (!ehErroDeRede(err)) throw err;
    return lerProdutosDisponiveisCache(pontoVendaUuid);
  }
}
