// docs/112: nenhum caminho finaliza visita com formulário em rascunho — o checkout confirmado
// apagava o rascunho e as fotos (o "antes") junto com a visita.

const mockRascunhos = jest.fn();
const mockFinalizarDb = jest.fn(async () => {});
jest.mock('./db/rascunhosRegistro', () => ({ listarRascunhosRegistro: (...a: unknown[]) => mockRascunhos(...a) }));
jest.mock('./diario', () => ({ registrarEvento: jest.fn() }));
jest.mock('./db/filaAcompanhamentos', () => ({ criarRespostaLocal: jest.fn() }));
jest.mock('./api/visitas', () => ({ cancelarRegistro: jest.fn(), cancelarVisita: jest.fn() }));
jest.mock('./db/filaRegistros', () => ({}));
jest.mock('./db/filaVisitas', () => ({ finalizarVisitaLocal: (...a: unknown[]) => mockFinalizarDb(...(a as [])) }));
jest.mock('./filaEnvio', () => ({ processarFilaEnvio: jest.fn(async () => ({})) }));

import { finalizarVisitaLocal, RascunhosPendentesError } from './visitaLocal';

const params = { usuarioId: 'u1', visitaLocalId: 'v1', latitude: 1, longitude: 2, usarSaidaDetectada: true };

beforeEach(() => {
  mockRascunhos.mockReset();
  mockFinalizarDb.mockClear();
});

it('com formulário em rascunho: recusa, diz quantos e quantas fotos, e não finaliza', async () => {
  mockRascunhos.mockResolvedValue([{ dados: { imagensUri: ['a.jpg'] } }, { dados: { imagensUri: [] } }]);
  const erro = await finalizarVisitaLocal(params).catch((e) => e);
  expect(erro).toBeInstanceOf(RascunhosPendentesError);
  expect(erro).toMatchObject({ quantidade: 2, fotos: 1 });
  expect(mockFinalizarDb).not.toHaveBeenCalled();
});

it('sem rascunho: finaliza normalmente', async () => {
  mockRascunhos.mockResolvedValue([]);
  await finalizarVisitaLocal(params);
  expect(mockFinalizarDb).toHaveBeenCalledWith('v1', 1, 2, undefined, true);
});
