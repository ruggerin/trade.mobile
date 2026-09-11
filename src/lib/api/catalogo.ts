import type { CatalogoItem } from '../../types/api';
import { lerCatalogoCache, salvarCatalogoCache } from '../db/catalogoCache';
import { ehErroDeRede } from '../db/database';
import { apiClient } from './client';

// Usado pelo seletor opcional de vínculo (produto/seção/departamento/marca) do formulário de
// registro, quando o TipoRegistro escolhido tem permite_vincular_catalogo. Antes não era
// cacheado — a decisão original assumia que o fluxo "já exigia rede pra enviar o registro", mas
// isso não é mais verdade: registro nasce na fila local (ver lib/filaEnvio.ts) e só precisa de
// rede quando o motor de sincronização decide enviar, não na hora que o promotor preenche o
// formulário. Mesmo padrão "rede primeiro, cache como fallback" de lib/api/pontosVenda.ts.
export async function listarSecoes(): Promise<CatalogoItem[]> {
  return buscarComCache('SECAO', '/secoes-auditoria', 'secoes');
}

export async function listarDepartamentos(): Promise<CatalogoItem[]> {
  return buscarComCache('DEPARTAMENTO', '/departamentos-auditoria', 'departamentos');
}

export async function listarMarcas(): Promise<CatalogoItem[]> {
  return buscarComCache('MARCA', '/marcas-auditoria', 'marcas');
}

async function buscarComCache(
  tipo: 'SECAO' | 'DEPARTAMENTO' | 'MARCA',
  endpoint: string,
  chaveResposta: string,
): Promise<CatalogoItem[]> {
  try {
    const { data } = await apiClient.get<Record<string, CatalogoItem[]>>(endpoint, { params: { ativo: 1 } });
    const itens = data[chaveResposta] ?? [];
    void salvarCatalogoCache(tipo, itens).catch(() => {});
    return itens;
  } catch (err) {
    if (!ehErroDeRede(err)) throw err;
    return lerCatalogoCache(tipo);
  }
}
