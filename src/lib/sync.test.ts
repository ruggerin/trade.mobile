// Sincronizar em partes independentes (docs/122 §2.4): antes era tudo ou nada — uma chamada que
// falhava derrubava as outras e nada era gravado.

const mockGet = jest.fn();
jest.mock('./api/client', () => ({ apiClient: { get: (...args: unknown[]) => mockGet(...args) } }));
jest.mock('./db/database', () => ({ ehErroDeRede: () => true, obterUltimaSincronizacao: jest.fn() }));

const mockSalvarPontosVendaCache = jest.fn();
const mockSalvarConsultaCache = jest.fn();
jest.mock('./db/pontosVendaCache', () => ({ salvarPontosVendaCache: (...a: unknown[]) => mockSalvarPontosVendaCache(...a) }));
jest.mock('./db/parametrosCache', () => ({ salvarParametrosCache: jest.fn(), lerParametrosCache: jest.fn() }));
jest.mock('./db/tiposRegistroCache', () => ({ salvarTiposRegistroCache: jest.fn() }));
jest.mock('./db/ordensServicoCache', () => ({ salvarOrdensServicoCache: jest.fn() }));
jest.mock('./db/consultasCache', () => ({
  salvarConsultaCache: (...a: unknown[]) => mockSalvarConsultaCache(...a),
  consultaComCache: jest.fn(),
}));

import { sincronizarAgora } from './sync';

const semRede = Object.assign(new Error('Network Error'), { isAxiosError: true });

function respostas(falhar: (url: string, params?: Record<string, unknown>) => boolean) {
  mockGet.mockImplementation((url: string, config?: { params?: Record<string, unknown> }) => {
    if (falhar(url, config?.params)) return Promise.reject(semRede);
    if (url === '/parametros') return Promise.resolve({ data: { parametros: [] } });
    if (url === '/pontos-venda') return Promise.resolve({ data: { pontos_venda: [{ id: 'l1' }, { id: 'l2' }] } });
    if (url === '/tipos-registro') return Promise.resolve({ data: { tipos_registro: [] } });
    if (url === '/ordens-servico') return Promise.resolve({ data: { ordens_servico: [{ id: 'os1' }] } });
    return Promise.resolve({ data: { motivos_nao_execucao: [] } });
  });
}

beforeEach(() => jest.clearAllMocks());

it('grava o que veio e diz o que faltou', async () => {
  respostas((url) => url === '/tipos-registro');

  const resultado = await sincronizarAgora();

  expect(resultado.falhas).toEqual(['formulários']);
  expect(resultado.pontosVenda).toBe(2);
  expect(mockSalvarPontosVendaCache).toHaveBeenCalledTimes(1);
  // A agenda de hoje e a da semana ficam no aparelho, com a chave que a tela lê.
  const chaves = mockSalvarConsultaCache.mock.calls.map((c) => c[0] as string);
  expect(chaves.filter((c) => c.startsWith('agenda:'))).toHaveLength(2);
  expect(chaves).toContain('motivos_nao_execucao');
});

it('sem nada de rede, falha para o botão mostrar "Sem conexão"', async () => {
  respostas(() => true);

  await expect(sincronizarAgora()).rejects.toBe(semRede);
  expect(mockSalvarPontosVendaCache).not.toHaveBeenCalled();
});
