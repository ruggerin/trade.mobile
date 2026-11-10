/**
 * Cadência de envio do rastreamento (docs/109). Cada acordada da tarefa em segundo plano liga o
 * Hermes, grava no SQLite e — até aqui — fazia uma requisição assinada por posição. Em celular
 * fraco isso é ~120 ciclos por hora, e apareceu como ANR em segundo plano (Sentry 7831570190).
 * Com RASTREAMENTO_ENVIO_MINUTOS > 0 a leitura só vai pro SQLite e a descarga acontece a cada N
 * minutos (ou quando a fila cresce demais). 0 = comportamento de antes, manda a cada leitura.
 */

/** Mesmo com cadência, uma fila grande sobe antes — não deixa acumular além disso. */
export const POSICOES_PARA_DESCARREGAR_ANTES = 50;

export function deveDescarregar(opcoes: {
  envioMinutos: number;
  ultimaDescargaMs: number | null;
  agoraMs: number;
  pendentes: number;
}): boolean {
  const { envioMinutos, ultimaDescargaMs, agoraMs, pendentes } = opcoes;
  if (!(envioMinutos > 0)) return true;
  if (pendentes >= POSICOES_PARA_DESCARREGAR_ANTES) return true;
  if (ultimaDescargaMs === null) return true;
  return agoraMs - ultimaDescargaMs >= envioMinutos * 60_000;
}
