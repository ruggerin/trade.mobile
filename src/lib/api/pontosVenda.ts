import type { PaginatedMeta, PontoVenda } from '../../types/api';
import { ehErroDeRede } from '../db/database';
import { lerPontosVendaCache, salvarPontosVendaCache } from '../db/pontosVendaCache';
import { apiClient } from './client';

export interface PontosVendaListResponse {
  pontos_venda: PontoVenda[];
  meta: PaginatedMeta;
}

// A API pagina (15 por página se ninguém pedir outro tamanho) e o app precisa da carteira
// INTEIRA — a Agenda monta o mapa de PDVs a partir daqui, e só com a 1ª página qualquer loja
// depois da 15ª (em ordem alfabética) dava "PDV não encontrado". Pede no tamanho máximo que a
// API aceita (`por_pagina` até 200, ver PontoVendaController::index) e segue as páginas até o
// fim.
const POR_PAGINA = 200;

async function buscarTodasAsPaginas(busca?: string): Promise<PontosVendaListResponse> {
  const pontosVenda: PontoVenda[] = [];
  let pagina = 1;
  let meta: PaginatedMeta;
  do {
    const { data } = await apiClient.get<PontosVendaListResponse>('/pontos-venda', {
      params: { ativo: 1, busca: busca || undefined, por_pagina: POR_PAGINA, page: pagina },
    });
    pontosVenda.push(...data.pontos_venda);
    meta = data.meta;
    pagina++;
  } while (pagina <= meta.last_page);

  return {
    pontos_venda: pontosVenda,
    meta: { current_page: 1, last_page: 1, per_page: pontosVenda.length, total: pontosVenda.length },
  };
}

// Cache local (SQLite): sem rede, cai pra última lista sincronizada da carteira do promotor —
// filtra localmente por `busca` pra manter o mesmo comportamento da tela. Guarda tudo, sem página.
export async function listarPontosVenda(busca?: string): Promise<PontosVendaListResponse> {
  try {
    const data = await buscarTodasAsPaginas(busca);
    // Só a lista sem filtro é a carteira inteira — salvar o resultado de uma busca sobrescreveria
    // o cache offline com um recorte dele.
    if (!busca) void salvarPontosVendaCache(data.pontos_venda).catch(() => {});
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
