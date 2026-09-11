import * as Crypto from 'expo-crypto';

// Único ponto de geração de id local (visita/registro na fila de envio) — sempre um uuid v4
// de verdade (expo-crypto usa o gerador nativo do SO), nunca colide com um uuid vindo do
// servidor, então dá pra guardar os dois tipos na mesma coluna sem ambiguidade.
export function gerarUuidLocal(): string {
  return Crypto.randomUUID();
}
