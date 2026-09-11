import type { OrdemServico, StatusOrdemServico } from '../../types/api';
import { ehErroDeRede } from '../db/database';
import { lerOrdensServicoCache, salvarOrdensServicoCache } from '../db/ordensServicoCache';
import { apiClient } from './client';

// Cache local (SQLite): o promotor precisa ver as próprias pendências (+ fila aberta) mesmo sem
// sinal — mesmo padrão de lib/api/pontosVenda.ts. Só busca PENDENTE: EM_ANDAMENTO já vira uma
// visita aberta (visível pelo fluxo normal), CONCLUIDA/CANCELADA não são mais acionáveis. Usado
// só pro badge "Pendência" da lista de PDV — a aba Agenda usa listarOrdensServicoAgenda abaixo.
export async function listarOrdensServicoPendentes(): Promise<OrdemServico[]> {
  try {
    const { data } = await apiClient.get<{ ordens_servico: OrdemServico[] }>('/ordens-servico', {
      params: { status: 'PENDENTE' },
    });
    void salvarOrdensServicoCache(data.ordens_servico).catch(() => {});
    return data.ordens_servico;
  } catch (err) {
    if (!ehErroDeRede(err)) throw err;
    return lerOrdensServicoCache();
  }
}

const STATUS_AGENDA: StatusOrdemServico[] = [
  'PENDENTE',
  'EM_ANDAMENTO',
  'CONCLUIDA',
  'AGUARDANDO_APROVACAO',
  'REAGENDAMENTO_SOLICITADO',
  'CANCELAMENTO_SOLICITADO',
];

// Aba Agenda (docs/13-AGENDA-MOBILE-E-AUTONOMIA.md §5/§6.1) — janela de data (Hoje ou Semana),
// vários status de uma vez (inclusive Realizada e os três de solicitação). Sem cache offline
// (diferente de listarOrdensServicoPendentes): é uma visão de navegação, não o fluxo crítico de
// check-in — sem sinal, mostra erro com "tentar novamente", mesmo padrão de Pontos de Venda.
export async function listarOrdensServicoAgenda(params: { prazoDe: string; prazoAte: string }): Promise<OrdemServico[]> {
  const { data } = await apiClient.get<{ ordens_servico: OrdemServico[] }>('/ordens-servico', {
    // Serialização padrão do axios já manda como status[]=A&status[]=B, formato que o Laravel
    // espera pra montar um array a partir da query string — confirmado, não mexer.
    params: { status: STATUS_AGENDA, prazo_de: params.prazoDe, prazo_ate: params.prazoAte },
  });
  return data.ordens_servico;
}

export interface NovoCompromissoPayload {
  ponto_venda_uuid: string;
  tipo_visita_uuid?: string | null;
  objetivo_visita_uuid?: string | null;
  prioridade?: string | null;
  horario_previsto?: string | null;
  prazo_inicio: string;
  prazo_fim: string;
  observacao?: string | null;
}

// "+ Compromisso" — o próprio promotor cria uma OS pra si. Nasce PENDENTE (modo autônomo) ou
// AGUARDANDO_APROVACAO (empresa exige aprovação) — a resposta já diz qual foi.
export async function criarCompromissoProprio(payload: NovoCompromissoPayload): Promise<OrdemServico> {
  const { data } = await apiClient.post<{ ordem_servico: OrdemServico }>('/ordens-servico/minhas', payload);
  return data.ordem_servico;
}

export async function reagendarOrdemServico(
  ordemServicoUuid: string,
  payload: { prazo_inicio: string; prazo_fim: string },
): Promise<OrdemServico> {
  const { data } = await apiClient.post<{ ordem_servico: OrdemServico }>(
    `/ordens-servico/${ordemServicoUuid}/reagendar`,
    payload,
  );
  return data.ordem_servico;
}

export async function cancelarOrdemServico(ordemServicoUuid: string): Promise<OrdemServico> {
  const { data } = await apiClient.post<{ ordem_servico: OrdemServico }>(`/ordens-servico/${ordemServicoUuid}/cancelar`);
  return data.ordem_servico;
}
