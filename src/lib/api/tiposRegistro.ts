import type { TipoRegistro } from '../../types/api';
import { ehErroDeRede } from '../db/database';
import { lerTiposRegistroCache, salvarTiposRegistroCache } from '../db/tiposRegistroCache';
import { apiClient } from './client';

// Cache local (SQLite, ver lib/db/database.ts): o promotor precisa dessa lista pra abrir o
// formulário de registro mesmo sem sinal no meio da loja — mesmo padrão de
// lib/api/pontosVenda.ts. Busca só os ativos (o promotor nunca deveria escolher um tipo
// desativado pra um registro novo).
export async function listarTiposRegistro(): Promise<TipoRegistro[]> {
  try {
    const { data } = await apiClient.get<{ tipos_registro: TipoRegistro[] }>('/tipos-registro', {
      params: { ativo: 1 },
    });
    void salvarTiposRegistroCache(data.tipos_registro).catch(() => {});
    return data.tipos_registro;
  } catch (err) {
    if (!ehErroDeRede(err)) throw err;
    return lerTiposRegistroCache();
  }
}
