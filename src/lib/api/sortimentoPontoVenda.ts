import type { AcompanhamentoAberto, SortimentoPontoVenda, TipoVinculoRegistro } from '../../types/api';
import { salvarAcompanhamentosCache } from '../db/filaAcompanhamentos';
import { lerSortimentoCache, salvarSortimentoCache } from '../db/sortimentoCache';
import { salvarUltimosRegistrosCache, type UltimosRegistros } from '../db/ultimosRegistrosCache';
import { apiClient } from './client';
import { redeComPrazo } from '../redeComPrazo';

// Sortimento cadastrado pra este PDV (docs/14-SORTIMENTO-PONTO-VENDA.md) — vem junto do
// detalhe do PDV (GET /pontos-venda/{uuid}), não é endpoint próprio. Cache local por PDV, mesmo
// padrão de campanhas.ts/buscarProdutosDisponiveis.
export async function buscarSortimento(pontoVendaUuid: string): Promise<SortimentoPontoVenda[]> {
  return redeComPrazo({
    rede: async () => {
      const { data } = await apiClient.get<{
        ponto_venda: { sortimento?: SortimentoPontoVenda[] };
        ultimos_registros_formulario?: UltimosRegistros | [];
        acompanhamentos_abertos?: AcompanhamentoAberto[];
      }>(`/pontos-venda/${pontoVendaUuid}`);
      // Mesmo endpoint traz o último registro por formulário com intervalo (docs/80 §5.2). PHP manda
      // `[]` quando vazio.
      const ultimos = data.ultimos_registros_formulario;
      void salvarUltimosRegistrosCache(pontoVendaUuid, Array.isArray(ultimos) ? {} : (ultimos ?? {})).catch(() => {});
      // "Ainda está lá?" (docs/83 §5.4): o que conferir nas próximas visitas, guardado offline.
      void salvarAcompanhamentosCache(pontoVendaUuid, data.acompanhamentos_abertos ?? []).catch(() => {});
      return data.ponto_venda.sortimento ?? [];
    },
    salvar: (itens) => salvarSortimentoCache(pontoVendaUuid, itens),
    lerCache: () => lerSortimentoCache(pontoVendaUuid),
  });
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
