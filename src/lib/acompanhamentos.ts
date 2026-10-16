import type { AcompanhamentoAberto, RespostaAcompanhamento } from '../types/api';

// "Ainda está lá?" (docs/83 §3.2): quais cartões aparecem nesta visita. Funções puras pra teste.

export interface CartaoAcompanhamento {
  acompanhamento: AcompanhamentoAberto;
  /** Resposta já dada nesta visita (o cartão aparece como feito). */
  respostaNestaVisita: RespostaAcompanhamento | null;
}

/** "AAAA-MM-DD" no fuso do aparelho (mesmo critério de dias de calendário do doc 80). */
export function dataLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Aparece quando a verificação já chegou (`proxima_verificacao_em` <= hoje), não venceu o prazo e
 * o registro original é de antes desta visita (registrar e conferir na mesma visita não faz
 * sentido). Respondido em outra visita ainda na fila: some. Respondido nesta: aparece feito.
 */
export function cartoesDaVisita(
  abertos: AcompanhamentoAberto[],
  {
    inicioVisita,
    hoje = new Date(),
    respondidosEmOutrasVisitas = new Set<string>(),
    respostasDestaVisita = new Map<string, RespostaAcompanhamento>(),
  }: {
    inicioVisita?: string;
    hoje?: Date;
    respondidosEmOutrasVisitas?: Set<string>;
    respostasDestaVisita?: Map<string, RespostaAcompanhamento>;
  },
): CartaoAcompanhamento[] {
  const dia = dataLocal(hoje);
  const inicio = inicioVisita ? new Date(inicioVisita) : null;

  return abertos
    .filter((a) => {
      if (respostasDestaVisita.has(a.id)) return true;
      if (respondidosEmOutrasVisitas.has(a.id)) return false;
      if (a.expira_em && a.expira_em < dia) return false;
      if (a.proxima_verificacao_em && a.proxima_verificacao_em > dia) return false;
      if (inicio && a.origem.criado_em && new Date(a.origem.criado_em) >= inicio) return false;
      return true;
    })
    .map((a) => ({ acompanhamento: a, respostaNestaVisita: respostasDestaVisita.get(a.id) ?? null }));
}

/** "08/10" a partir do ISO. */
export function diaMes(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
