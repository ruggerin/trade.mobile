import { lerSortimentoCampoCache, salvarSortimentoCampoCache } from '../db/sortimentoCampoCache';
import { apiClient } from './client';
import { redeComPrazo } from '../redeComPrazo';

export interface ProdutoSortimento {
  produto_uuid: string;
  descricao: string;
  imagem_url: string | null;
  codigo_barras: string | null;
  propriedade: string | null;
  produto_chave: boolean;
  // Pro checklist que segue a escolha do promotor filtrar e agrupar (docs/79 §4.2). Opcionais:
  // cache antigo não tem.
  secao_uuid?: string | null;
  secao_descricao?: string | null;
  departamento_uuid?: string | null;
  departamento_descricao?: string | null;
  // Marca do próprio produto (docs/82 §5.3). Ausente em cache antigo.
  marca_uuid?: string | null;
  marca_descricao?: string | null;
}

// O que dá pra escolher em "Onde é?" — só o que existe no mix desta loja (docs/79 §4.2). Só vem
// quando o campo segue a escolha do promotor.
export interface RecortesDoMix {
  // `secoes_uuids`: onde a marca aparece nesta loja (docs/82 §5.2). Ausente em cache antigo.
  marcas: { uuid: string; descricao: string; departamentos_uuids: string[]; secoes_uuids?: string[] }[];
  departamentos: { uuid: string; descricao: string }[];
  secoes: { uuid: string; descricao: string; departamento_uuid: string | null }[];
}

export interface SortimentoCampo {
  produtos: ProdutoSortimento[];
  recortes?: RecortesDoMix;
}

// Checklist resolvido de um campo SORTIMENTO pra um PDV — o backend decide a origem (dinâmica no
// sortimento real do PDV, ou lista fixa curada no cadastro do campo), o app só consulta e
// renderiza. Ver App\Support\ResolverSortimentoCampo e docs/20-FORMULARIO-DINAMICO-CAMPANHA.md
// decisão 3.
//
// Cache local (mesmo padrão "rede primeiro, cache como fallback" de lib/api/tiposRegistro.ts) —
// docs/26-MELHORIAS-PRODUTIVIDADE-PROMOTOR.md §6 item 12: sem isso, um campo SORTIMENTO
// simplesmente falhava se o promotor estivesse sem sinal dentro da loja, quebrando a promessa de
// offline-first bem no meio do formulário. Só cai pro cache se ele já tiver dado pra esse PDV
// específico — sem cache nenhum, relança o erro original pra tela mostrar "não foi possível
// carregar" em vez de deixar o promotor pensar que o mix está vazio de verdade.
export async function buscarSortimentoCampo(campoUuid: string, pontoVendaUuid: string): Promise<SortimentoCampo> {
  return redeComPrazo({
    rede: async () =>
      (
        await apiClient.get<SortimentoCampo>(`/tipos-registro/campos/${campoUuid}/sortimento`, {
          params: { ponto_venda_uuid: pontoVendaUuid },
        })
      ).data,
    salvar: (dados) => salvarSortimentoCampoCache(campoUuid, pontoVendaUuid, dados),
    lerCache: () => lerSortimentoCampoCache(campoUuid, pontoVendaUuid),
  });
}
