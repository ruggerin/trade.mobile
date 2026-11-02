// Jornada do rastreamento pela escala do promotor (docs/102): o app usa a jornada do dia que o
// servidor manda junto de /parametros e só cai nos parâmetros antigos sem ela.

const mockGet = jest.fn();
jest.mock('./client', () => ({ apiClient: { get: (...args: unknown[]) => mockGet(...args) } }));
jest.mock('../db/parametrosCache', () => ({ salvarParametrosCache: jest.fn(), lerParametrosCache: jest.fn() }));
jest.mock('../redeComPrazo', () => ({ redeComPrazo: ({ rede }: { rede: () => Promise<unknown> }) => rede() }));

import { buscarConfigRastreamento, parametrosParaCache } from './parametros';

const parametros = [
  { chave: 'RASTREAMENTO_INTERVALO_SEGUNDOS', valor: '60', ativo: true },
  { chave: 'JORNADA_INICIO', valor: '07:00', ativo: true },
  { chave: 'JORNADA_FIM', valor: '17:00', ativo: true },
];

function dia(data: string, trabalha: boolean, inicio: string | null = null, fim: string | null = null) {
  return { data, trabalha, inicio, fim, intervalo: null, escala: 'Seg–sáb', feriado: null };
}

beforeEach(() => {
  jest.useFakeTimers();
  // Sábado 31/10/2026, 10h no horário do aparelho.
  jest.setSystemTime(new Date(2026, 9, 31, 10, 0));
});

afterEach(() => jest.useRealTimers());

it('usa o horário da escala do promotor no dia (sábado 08–12)', async () => {
  mockGet.mockResolvedValue({ data: { parametros, jornada_semana: [dia('2026-10-31', true, '08:00', '12:00'), dia('2026-11-01', false)] } });

  const config = await buscarConfigRastreamento();

  expect(config.jornada).toEqual({ inicio: '08:00', fim: '12:00' });
  expect(config.folga).toBe(false);
});

it('folga da escala: nada é cobrado', async () => {
  mockGet.mockResolvedValue({ data: { parametros, jornada_semana: [dia('2026-10-31', false)] } });

  const config = await buscarConfigRastreamento();

  expect(config.folga).toBe(true);
  expect(config.jornada).toBeNull();
});

it('servidor antigo (sem jornada_semana): cai nos parâmetros de antes', async () => {
  mockGet.mockResolvedValue({ data: { parametros } });

  const config = await buscarConfigRastreamento();

  expect(config.jornada).toEqual({ inicio: '07:00', fim: '17:00' });
  expect(config.folga).toBe(false);
});

it('a jornada da semana vai pro cache numa linha à parte', () => {
  const linhas = parametrosParaCache({ parametros, jornada_semana: [dia('2026-10-31', false)] });

  expect(linhas).toHaveLength(parametros.length + 1);
  expect(parametrosParaCache({ parametros, jornada_semana: null })).toBe(parametros);
});
