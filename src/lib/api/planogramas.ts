import type { Planograma } from '../../types/api';
import { apiClient } from './client';

// Só leitura — o promotor consulta como referência, nunca cadastra/edita (isso é feito no
// admin web). Ver docs/22-PLANOGRAMA.md. Sem cache offline nesta v1: diferente do catálogo/tipos
// de registro (necessários pra operar em campo mesmo sem sinal), planograma é material de apoio
// consultivo — se não tiver rede, o promotor tenta de novo depois.
export async function listarPlanogramas(): Promise<Planograma[]> {
  const { data } = await apiClient.get<{ planogramas: Planograma[] }>('/planogramas', { params: { ativo: 1 } });
  return data.planogramas;
}

export async function buscarPlanograma(uuid: string): Promise<Planograma> {
  const { data } = await apiClient.get<{ planograma: Planograma }>(`/planogramas/${uuid}`);
  return data.planograma;
}
