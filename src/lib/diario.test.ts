// Diário de eventos (docs/112): foto apagada deixa rastro, e perda vira evento no Sentry.

const mockEscritas: unknown[][] = [];
jest.mock('./db/database', () => ({
  escrever: jest.fn(async (_sql: string, params: unknown[]) => {
    mockEscritas.push(params);
  }),
  getDatabase: jest.fn(),
}));
const mockCapture = jest.fn();
jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: jest.fn(),
  captureMessage: (...a: unknown[]) => mockCapture(...a),
}));

import { avisarPerdaDeFoto, registrarEvento } from './diario';

beforeEach(() => {
  mockEscritas.length = 0;
  mockCapture.mockReset();
});

it('registra o evento com tipo, visita e dados', async () => {
  registrarEvento('foto_apagada', { motivo: 'formulario_fechado_sem_salvar' }, 'v1');
  await Promise.resolve();
  expect(mockEscritas[0]).toEqual([expect.any(String), 'foto_apagada', 'v1', JSON.stringify({ motivo: 'formulario_fechado_sem_salvar' })]);
});

it('perda de foto não enviada vira evento no Sentry com o motivo', () => {
  avisarPerdaDeFoto('rascunho_apagado_com_visita:checkout-confirmado', 2, 'v1');
  expect(mockCapture).toHaveBeenCalledWith(
    'Foto ainda não enviada foi apagada do aparelho',
    expect.objectContaining({ tags: expect.objectContaining({ motivo: 'rascunho_apagado_com_visita' }), extra: { fotos: 2, visitaLocalId: 'v1' } }),
  );
});

it('remoção pelo promotor, envio ou zero fotos não alarmam', () => {
  avisarPerdaDeFoto('promotor_removeu', 1);
  avisarPerdaDeFoto('enviada_ao_servidor', 3);
  avisarPerdaDeFoto('formulario_fechado_sem_salvar', 0);
  expect(mockCapture).not.toHaveBeenCalled();
});
