import type { OrdemServico, StatusOrdemServico } from '../../types/api';
import { ehErroDeRede } from '../db/database';
import { lerOrdensServicoCache, salvarOrdensServicoCache } from '../db/ordensServicoCache';
import { apiClient } from './client';

// Cache local (SQLite): o promotor precisa ver as próprias pendências (+ fila aberta) mesmo sem
// sinal — mesmo padrão de lib/api/pontosVenda.ts. Só busca PENDENTE: EM_ANDAMENTO já vira uma
// visita aberta (visível pelo fluxo normal), CONCLUIDA/CANCELADA não são mais acionáveis. Usado
// só pro badge "Pendência" da lista de PDV — a aba Agenda usa listarOrdensServicoAgenda abaixo.
// `por_pagina` pega tudo de uma vez (capado em 200 no backend) — sem data de corte (diferente da
// Agenda), então um Direcionamento gerando muitas OS de uma vez facilmente passa dos 15 padrão;
// sem isso, PDV fora da 1ª página nunca ganhava o badge nem a OS anexada no check-in.
/** Data local do aparelho (YYYY-MM-DD) de um instante ISO. */
function diaLocal(data: Date): string {
  const d2 = (n: number) => String(n).padStart(2, '0');
  return `${data.getFullYear()}-${d2(data.getMonth() + 1)}-${d2(data.getDate())}`;
}

/**
 * Uma visita só se vincula a UMA ordem de serviço. Quando a loja tem mais de uma pendente, vale,
 * olhando o dia da visita (hoje):
 *   1. a vigente hoje (prazo cobre o dia) — entre elas, formulário por responder primeiro (senão a
 *      OS da Agenda, sem formulário, "roubava" a visita do Direcionamento), depois o prazo mais curto;
 *   2. sem nenhuma de hoje, a vencida mais recente (visita atrasada de verdade);
 *   3. por último, a futura mais próxima.
 * Antes valia "prazo mais curto" sem olhar o dia: uma OS vencida de dias atrás ganhava da de hoje,
 * virava concluída e a de hoje ficava pendente (produção, 13/10/2026). A API aplica a mesma regra
 * (App\Support\OrdemDoCheckin) e corrige versões antigas do app.
 */
export function escolherOrdemDaLoja(ordens: OrdemServico[], agora: Date = new Date()): OrdemServico | undefined {
  const hoje = diaLocal(agora);
  const grupo = (os: OrdemServico) => {
    if (diaLocal(new Date(os.prazo_fim)) < hoje) return 1; // vencida
    if (diaLocal(new Date(os.prazo_inicio)) > hoje) return 2; // futura
    return 0; // vigente hoje
  };
  const comFormularioPendente = (os: OrdemServico) => (os.formularios ?? []).some((f) => !f.respondido_em);

  return [...ordens].sort((a, b) => {
    const porGrupo = grupo(a) - grupo(b);
    if (porGrupo !== 0) return porGrupo;
    const porFormulario = Number(comFormularioPendente(b)) - Number(comFormularioPendente(a));
    if (porFormulario !== 0) return porFormulario;
    const porPrazo = new Date(a.prazo_fim).getTime() - new Date(b.prazo_fim).getTime();
    return grupo(a) === 1 ? -porPrazo : porPrazo;
  })[0];
}

export async function listarOrdensServicoPendentes(): Promise<OrdemServico[]> {
  try {
    const { data } = await apiClient.get<{ ordens_servico: OrdemServico[] }>('/ordens-servico', {
      params: { status: 'PENDENTE', por_pagina: 200 },
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

// Busca individual, com os formulários exigidos (obrigatorio/calcula_percentual_compliance/
// respondido_em) — a aba Ações da visita usa isso pra saber o que ainda falta responder. Sem
// fallback offline: só faz sentido pedir isso com sinal (é dado que pode ter mudado desde o
// check-in — outro promotor pode ter respondido o mesmo formulário nesse meio tempo, se a OS
// for de fila aberta), e a visita não fica bloqueada por essa consulta falhar.
export async function buscarOrdemServico(ordemServicoUuid: string): Promise<OrdemServico> {
  const { data } = await apiClient.get<{ ordem_servico: OrdemServico }>(`/ordens-servico/${ordemServicoUuid}`);
  return data.ordem_servico;
}
