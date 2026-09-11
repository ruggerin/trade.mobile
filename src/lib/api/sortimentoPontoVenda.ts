import type { SortimentoPontoVenda, TipoVinculoRegistro } from '../../types/api';
import { ehErroDeRede } from '../db/database';
import { lerSortimentoCache, salvarSortimentoCache } from '../db/sortimentoCache';
import { apiClient } from './client';

// Sortimento cadastrado pra este PDV (docs/14-SORTIMENTO-PONTO-VENDA.md) — vem junto do
// detalhe do PDV (GET /pontos-venda/{uuid}), não é endpoint próprio. Cache local por PDV, mesmo
// padrão de campanhas.ts/buscarProdutosDisponiveis.
export async function buscarSortimento(pontoVendaUuid: string): Promise<SortimentoPontoVenda[]> {
  try {
    const { data } = await apiClient.get<{ ponto_venda: { sortimento?: SortimentoPontoVenda[] } }>(
      `/pontos-venda/${pontoVendaUuid}`,
    );
    const itens = data.ponto_venda.sortimento ?? [];
    void salvarSortimentoCache(pontoVendaUuid, itens).catch(() => {});
    return itens;
  } catch (err) {
    if (!ehErroDeRede(err)) throw err;
    return lerSortimentoCache(pontoVendaUuid);
  }
}

export interface AdicionarSortimentoPayload {
  tipo_item: TipoVinculoRegistro;
  produto_uuid?: string;
  secao_uuid?: string;
  departamento_uuid?: string;
  marca_uuid?: string;
}

// Self-service (mobile): o próprio promotor vincula um produto já existente no catálogo ao
// sortimento deste PDV, durante a visita — nasce válido ou pendente dependendo do parâmetro
// SORTIMENTO_AUTONOMIA_PROMOTOR da empresa. Ação online (não passa pela fila offline de envio,
// mesmo raciocínio de criarCompromissoProprio em lib/api/ordensServico.ts). Ver
// docs/14-SORTIMENTO-PONTO-VENDA.md §9.
export async function adicionarSortimentoProprio(
  pontoVendaUuid: string,
  payload: AdicionarSortimentoPayload,
): Promise<SortimentoPontoVenda> {
  const { data } = await apiClient.post<{ item: SortimentoPontoVenda }>(
    `/pontos-venda/${pontoVendaUuid}/sortimento/proprio`,
    payload,
  );
  return data.item;
}
