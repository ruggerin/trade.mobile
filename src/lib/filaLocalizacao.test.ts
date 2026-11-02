import { descarregarPosicoes, TAMANHO_LOTE } from './filaLocalizacao';
import { apiClient } from './api/client';

// Fila em memória no lugar do SQLite.
let mockFila: {
  id: number;
  latitude: number;
  longitude: number;
  capturadoEm: string;
  simulada: boolean;
  bateria: { nivel: number | null; carregando: boolean | null; economia: boolean | null } | null;
}[] = [];
let mockSituacoes: { id: number; situacao: string; detalhe: string | null; ocorridoEm: string }[] = [];
let mockPodadaAntesDe: string | null = null;

jest.mock('./api/client', () => ({ apiClient: { post: jest.fn(), patch: jest.fn() } }));
jest.mock('./db/filaLocalizacoes', () => ({
  enfileirarPosicoes: jest.fn(),
  lerLotePosicoes: jest.fn(async (limite: number) => mockFila.slice(0, limite)),
  apagarPosicoes: jest.fn(async (ids: number[]) => {
    mockFila = mockFila.filter((p) => !ids.includes(p.id));
  }),
  podarPosicoesAntesDe: jest.fn(async (iso: string) => {
    mockPodadaAntesDe = iso;
  }),
  limparFilaPosicoes: jest.fn(async () => {
    mockFila = [];
    mockSituacoes = [];
  }),
  enfileirarSituacao: jest.fn(),
  lerSituacoes: jest.fn(async () => [...mockSituacoes]),
  apagarSituacao: jest.fn(async (id: number) => {
    mockSituacoes = mockSituacoes.filter((s) => s.id !== id);
  }),
}));

const post = apiClient.post as jest.Mock;
const patch = apiClient.patch as jest.Mock;
const erroHttp = (status?: number) => Object.assign(new Error('x'), { isAxiosError: true, response: status ? { status } : undefined });

function encher(n: number) {
  mockFila = Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    latitude: -3.1,
    longitude: -60,
    capturadoEm: new Date(2026, 9, 29, 8, i).toISOString(),
    simulada: false,
    bateria: null,
  }));
}

beforeEach(() => {
  post.mockReset();
  patch.mockReset();
  mockSituacoes = [];
  mockPodadaAntesDe = null;
});

describe('descarregarPosicoes', () => {
  it('fila vazia não chama a API', async () => {
    encher(0);
    expect(await descarregarPosicoes()).toBe('VAZIA');
    expect(post).not.toHaveBeenCalled();
  });

  it('manda em lotes, da mais antiga pra mais recente, e esvazia a fila', async () => {
    encher(TAMANHO_LOTE + 30);
    const maisAntiga = mockFila[0].capturadoEm;
    post.mockResolvedValue({ data: {} });

    expect(await descarregarPosicoes()).toBe('ENVIADA');

    expect(post).toHaveBeenCalledTimes(2);
    const primeiro = post.mock.calls[0][1].posicoes;
    expect(post.mock.calls[0][0]).toBe('/localizacao/lote');
    expect(primeiro).toHaveLength(TAMANHO_LOTE);
    expect(primeiro[0]).toEqual({ latitude: -3.1, longitude: -60, capturado_em: maisAntiga, simulada: false });
    expect(post.mock.calls[1][1].posicoes).toHaveLength(30);
    expect(mockFila).toHaveLength(0);
  });

  it('sem internet guarda tudo pra próxima tentativa', async () => {
    encher(5);
    post.mockRejectedValue(erroHttp());

    expect(await descarregarPosicoes()).toBe('SEM_REDE');
    expect(mockFila).toHaveLength(5);
  });

  it('erro do servidor (5xx) também espera', async () => {
    encher(5);
    post.mockRejectedValue(erroHttp(503));

    expect(await descarregarPosicoes()).toBe('SEM_REDE');
    expect(mockFila).toHaveLength(5);
  });

  it('403 (rastreamento desligado) limpa a fila', async () => {
    encher(5);
    post.mockRejectedValue(erroHttp(403));

    expect(await descarregarPosicoes()).toBe('RASTREAMENTO_DESLIGADO');
    expect(mockFila).toHaveLength(0);
  });

  it('422 descarta só o lote ruim e segue', async () => {
    encher(TAMANHO_LOTE + 1);
    post.mockRejectedValueOnce(erroHttp(422)).mockResolvedValue({ data: {} });

    expect(await descarregarPosicoes()).toBe('ENVIADA');
    expect(post).toHaveBeenCalledTimes(2);
    expect(mockFila).toHaveLength(0);
  });

  it('poda o que passou de 24h antes de enviar', async () => {
    encher(0);
    await descarregarPosicoes(new Date('2026-10-29T12:00:00.000Z'));
    expect(mockPodadaAntesDe).toBe('2026-10-28T12:00:00.000Z');
  });

  it('chamadas simultâneas viram uma descarga só', async () => {
    encher(3);
    post.mockResolvedValue({ data: {} });

    const [a, b] = await Promise.all([descarregarPosicoes(), descarregarPosicoes()]);
    expect(a).toBe('ENVIADA');
    expect(b).toBe('ENVIADA');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('manda a bateria só na posição que tem', async () => {
    encher(2);
    mockFila[1].bateria = { nivel: 43, carregando: false, economia: true };
    post.mockResolvedValue({ data: {} });

    await descarregarPosicoes();

    const [semBateria, comBateria] = post.mock.calls[0][1].posicoes;
    expect(semBateria).not.toHaveProperty('bateria_nivel');
    expect(comBateria).toMatchObject({ bateria_nivel: 43, bateria_carregando: false, bateria_economia: true });
  });

  it('manda as mudanças de situação primeiro, com o horário em que o app viu', async () => {
    encher(1);
    mockSituacoes = [
      { id: 1, situacao: 'GPS_DESLIGADO', detalhe: null, ocorridoEm: '2026-10-29T11:19:00.000Z' },
      { id: 2, situacao: 'ATIVO', detalhe: null, ocorridoEm: '2026-10-29T14:35:00.000Z' },
    ];
    const ordem: string[] = [];
    patch.mockImplementation(async (_url: string, corpo: { situacao: string }) => ordem.push(corpo.situacao));
    post.mockImplementation(async () => ordem.push('POSICOES'));

    expect(await descarregarPosicoes()).toBe('ENVIADA');

    expect(ordem).toEqual(['GPS_DESLIGADO', 'ATIVO', 'POSICOES']);
    expect(patch.mock.calls[0]).toEqual([
      '/localizacao/situacao',
      { situacao: 'GPS_DESLIGADO', detalhe: null, ocorrido_em: '2026-10-29T11:19:00.000Z' },
    ]);
    expect(mockSituacoes).toHaveLength(0);
  });

  it('sem internet a situação espera, e as posições também', async () => {
    encher(3);
    mockSituacoes = [{ id: 1, situacao: 'GPS_DESLIGADO', detalhe: null, ocorridoEm: '2026-10-29T11:19:00.000Z' }];
    patch.mockRejectedValue(erroHttp());

    expect(await descarregarPosicoes()).toBe('SEM_REDE');
    expect(mockSituacoes).toHaveLength(1);
    expect(mockFila).toHaveLength(3);
    expect(post).not.toHaveBeenCalled();
  });
});
