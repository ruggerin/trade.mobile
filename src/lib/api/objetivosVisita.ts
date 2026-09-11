import type { ObjetivoVisita } from '../../types/api';
import { apiClient } from './client';

// Mesmo raciocínio de lib/api/tiposVisita.ts — sem cache offline, só alimenta o formulário de
// "+ Compromisso". Ver docs/13-AGENDA-MOBILE-E-AUTONOMIA.md.
export async function listarObjetivosVisita(): Promise<ObjetivoVisita[]> {
  const { data } = await apiClient.get<{ objetivos_visita: ObjetivoVisita[] }>('/objetivos-visita', {
    params: { ativo: 1 },
  });
  return data.objetivos_visita;
}
