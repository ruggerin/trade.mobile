import type { PaginatedMeta, PontoVenda } from '../../types/api';
import { ehErroDeRede } from '../db/database';
import { lerPontosVendaCache, salvarPontosVendaCache } from '../db/pontosVendaCache';
import { apiClient } from './client';

export interface PontosVendaListResponse {
  pontos_venda: PontoVenda[];
  meta: PaginatedMeta;
}

// Cache local (SQLite): sem rede, cai pra última lista sincronizada da carteira do promotor —
// filtra localmente por `busca` pra manter o mesmo comportamento da tela. A paginação da API
// não é usada aqui (o app sempre pede a lista inteira do promotor de uma vez), então o cache
// espelha isso: guarda tudo, sem página.
export async function listarPontosVenda(busca?: string): Promise<PontosVendaListResponse> {
  try {
    const { data } = await apiClient.get<PontosVendaListResponse>('/pontos-venda', {
      params: { ativo: 1, busca: busca || undefined },
    });
    void salvarPontosVendaCache(data.pontos_venda).catch(() => {});
    return data;
  } catch (err) {
    if (!ehErroDeRede(err)) throw err;

    const cache = await lerPontosVendaCache();
    const filtrados = busca ? filtrarLocalmente(cache, busca) : cache;
    return {
      pontos_venda: filtrados,
      meta: { current_page: 1, last_page: 1, per_page: filtrados.length, total: filtrados.length },
    };
  }
}

function filtrarLocalmente(pontosVenda: PontoVenda[], busca: string): PontoVenda[] {
  const termo = busca.toLowerCase();
  return pontosVenda.filter(
    (pdv) =>
      pdv.razao_social.toLowerCase().includes(termo) ||
      pdv.fantasia.toLowerCase().includes(termo) ||
      (pdv.bairro?.toLowerCase().includes(termo) ?? false),
  );
}
