// Cadência de envio do rastreamento (docs/109).

import { deveDescarregar, POSICOES_PARA_DESCARREGAR_ANTES } from './cadenciaEnvio';

const MIN = 60_000;
const agora = 1_700_000_000_000;

it('0 minutos = manda a cada leitura (comportamento de antes)', () => {
  expect(deveDescarregar({ envioMinutos: 0, ultimaDescargaMs: agora, agoraMs: agora, pendentes: 1 })).toBe(true);
  expect(deveDescarregar({ envioMinutos: Number.NaN, ultimaDescargaMs: agora, agoraMs: agora, pendentes: 1 })).toBe(true);
});

it('com cadência: só depois de N minutos da última descarga que chegou no servidor', () => {
  expect(deveDescarregar({ envioMinutos: 5, ultimaDescargaMs: agora - 4 * MIN, agoraMs: agora, pendentes: 8 })).toBe(false);
  expect(deveDescarregar({ envioMinutos: 5, ultimaDescargaMs: agora - 5 * MIN, agoraMs: agora, pendentes: 8 })).toBe(true);
});

it('primeira leitura (nunca descarregou) e fila grande sobem na hora', () => {
  expect(deveDescarregar({ envioMinutos: 10, ultimaDescargaMs: null, agoraMs: agora, pendentes: 1 })).toBe(true);
  expect(deveDescarregar({ envioMinutos: 10, ultimaDescargaMs: agora, agoraMs: agora, pendentes: POSICOES_PARA_DESCARREGAR_ANTES })).toBe(true);
});
