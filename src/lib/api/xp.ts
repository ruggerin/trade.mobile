import type { PontuacaoHoje, PontuacaoSemana, PontuacaoVisita, RankingEquipe } from '../../types/api';
import { apiClient } from './client';

// Régua de XP do promotor (docs/88 §12). Só online: o número é calculado no servidor e o app
// só mostra; sem sinal, as telas dizem que confirmam quando enviar.

export async function buscarPontuacaoHoje(): Promise<PontuacaoHoje> {
  const { data } = await apiClient.get<{ pontuacao: PontuacaoHoje }>('/xp/eu', { params: { periodo: 'hoje' } });
  return data.pontuacao;
}

export async function buscarPontuacaoSemana(): Promise<PontuacaoSemana> {
  const { data } = await apiClient.get<{ pontuacao: PontuacaoSemana }>('/xp/eu', { params: { periodo: 'semana' } });
  return data.pontuacao;
}

export async function buscarPontuacaoVisita(visitaServidorId: string): Promise<PontuacaoVisita> {
  const { data } = await apiClient.get<{ pontuacao: PontuacaoVisita }>(`/xp/visitas/${visitaServidorId}`);
  return data.pontuacao;
}

// `atual`/`passada` = semana; `mes`/`mes_passado` = mês.
export type PeriodoRanking = 'atual' | 'passada' | 'mes' | 'mes_passado';

export async function buscarRankingEquipe(semana: PeriodoRanking): Promise<RankingEquipe> {
  const { data } = await apiClient.get<{ ranking: RankingEquipe }>('/xp/ranking', { params: { semana } });
  return data.ranking;
}
