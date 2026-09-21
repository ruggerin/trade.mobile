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

// Detalhe de uma loja (traz `contratos_ativos` e a fachada mais recente) — online, sem cache próprio:
// a aba Dados cadastrais parte do que a lista já tinha e só complementa quando há rede.
export async function buscarPontoVenda(uuid: string): Promise<PontoVenda> {
  const { data } = await apiClient.get<{ ponto_venda: PontoVenda }>(`/pontos-venda/${uuid}`);
  return data.ponto_venda;
}

// O promotor manda a foto da fachada quando a loja ainda não tem uma — o backend recusa (422) se já
// existir, então nunca sobrescreve a foto do admin.
export async function enviarFachadaPromotor(uuid: string, imagemUri: string): Promise<PontoVenda> {
  const nome = imagemUri.split('/').pop() ?? 'fachada.jpg';
  const extensao = /\.(\w+)$/.exec(nome)?.[1]?.toLowerCase();
  const form = new FormData();
  form.append('imagem', {
    uri: imagemUri,
    name: nome,
    type: `image/${extensao === 'jpg' || !extensao ? 'jpeg' : extensao}`,
  } as unknown as Blob);

  const { data } = await apiClient.post<{ ponto_venda: PontoVenda }>(`/pontos-venda/${uuid}/fachada-promotor`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 90_000,
  });
  return data.ponto_venda;
}
