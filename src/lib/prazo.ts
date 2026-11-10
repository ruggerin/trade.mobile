/** Erro lançado por `comPrazo` quando a promessa não resolve a tempo. */
export class PrazoEstouradoError extends Error {
  constructor(readonly prazoMs: number) {
    super(`prazo de ${prazoMs} ms estourado`);
    this.name = 'PrazoEstouradoError';
  }
}

/**
 * Corrida contra o relógio: resolve com a promessa se ela chegar no prazo; senão rejeita com
 * `PrazoEstouradoError`. A promessa original segue rodando (não dá pra cancelar um módulo nativo),
 * mas quem chamou já pode seguir — ex.: Play Integrity pendurado em rede lenta (docs/108 §5.2).
 */
export function comPrazo<T>(promessa: Promise<T>, prazoMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PrazoEstouradoError(prazoMs)), prazoMs);
  });
  // Quem perdeu a corrida não pode virar rejeição sem handler.
  promessa.catch(() => {});
  return Promise.race([promessa, prazo]).finally(() => clearTimeout(timer));
}
