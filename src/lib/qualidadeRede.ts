import { useEffect, useState } from 'react';

/**
 * Disjuntor de rede lenta (docs/108 §5.3). O NetInfo só diz se o aparelho TEM sinal; com sinal
 * fraco ("lie-fi") toda chamada demora até o timeout e o app parecia online enquanto nada
 * respondia. Aqui o próprio tráfego do `apiClient` decide: depois de N falhas seguidas sem resposta
 * (timeout, DNS, conexão recusada) a rede é marcada como RUIM por um tempo, e nesse período:
 *   - `redeComPrazo` responde pelo cache na hora (a chamada segue em segundo plano);
 *   - o login vai direto pro offline quando há acesso guardado;
 *   - `useEstaOnline` mostra o estado real pro promotor.
 * Qualquer resposta rápida do servidor (mesmo 4xx) fecha o disjuntor. Mesma ideia do circuit breaker
 * e do `networkTimeoutSeconds` do Workbox.
 */
export const FALHAS_PARA_MARCAR_RUIM = 3;
export const DURACAO_RUIM_MS = 60_000;
/** Resposta abaixo disso prova que a rede voltou a funcionar. */
export const RESPOSTA_RAPIDA_MS = 3_000;

type Ouvinte = (ruim: boolean) => void;

let falhasSeguidas = 0;
let ruimAte = 0;
const ouvintes = new Set<Ouvinte>();

function avisar(ruim: boolean): void {
  ouvintes.forEach((ouvinte) => {
    try {
      ouvinte(ruim);
    } catch {
      // Um ouvinte com erro não pode derrubar os outros.
    }
  });
}

export function redeEstaRuim(agora: number = Date.now()): boolean {
  return agora < ruimAte;
}

/** Chamada que não recebeu resposta nenhuma do servidor. */
export function registrarFalhaDeRede(agora: number = Date.now()): void {
  falhasSeguidas += 1;
  if (falhasSeguidas < FALHAS_PARA_MARCAR_RUIM) return;
  const jaEstavaRuim = redeEstaRuim(agora);
  ruimAte = agora + DURACAO_RUIM_MS;
  if (!jaEstavaRuim) avisar(true);
}

/** Resposta do servidor (qualquer status) em `duracaoMs`. */
export function registrarResposta(duracaoMs: number, agora: number = Date.now()): void {
  falhasSeguidas = 0;
  if (duracaoMs > RESPOSTA_RAPIDA_MS) return;
  const estavaRuim = redeEstaRuim(agora);
  ruimAte = 0;
  if (estavaRuim) avisar(false);
}

/** Avisa quando a rede passa a ruim (`true`) ou volta a boa (`false`). */
export function aoMudarQualidadeRede(ouvinte: Ouvinte): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

export function useRedeRuim(): boolean {
  const [ruim, setRuim] = useState(() => redeEstaRuim());

  useEffect(() => {
    const parar = aoMudarQualidadeRede(setRuim);
    // O estado "ruim" vence sozinho sem nenhuma chamada nova: relê quando o prazo passar.
    const restante = ruimAte - Date.now();
    const timer = restante > 0 ? setTimeout(() => setRuim(redeEstaRuim()), restante + 50) : undefined;
    return () => {
      parar();
      clearTimeout(timer);
    };
  }, [ruim]);

  return ruim;
}

/** Só pra testes. */
export function zerarQualidadeRede(): void {
  falhasSeguidas = 0;
  ruimAte = 0;
}
