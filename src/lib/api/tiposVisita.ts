import type { TipoVisita } from '../../types/api';
import { apiClient } from './client';

// Sem cache offline de propósito — só usado pra montar o formulário de "+ Compromisso"
// (docs/13-AGENDA-MOBILE-E-AUTONOMIA.md), que já depende de rede (criação é sempre online, sem
// fila offline pra isso). Sem sinal, o campo simplesmente fica sem opções.
export async function listarTiposVisita(): Promise<TipoVisita[]> {
  const { data } = await apiClient.get<{ tipos_visita: TipoVisita[] }>('/tipos-visita', {
    params: { ativo: 1 },
  });
  return data.tipos_visita;
}
