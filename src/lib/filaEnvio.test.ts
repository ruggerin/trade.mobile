import { criarRegistro, finalizarVisita, iniciarVisita } from './api/visitas';
import { ehErroDeRede, ehErroTransitorio } from './db/database';
import {
  descartarRegistrosDaVisita,
  listarRegistrosLocais,
  marcarRegistroComErro,
  marcarRegistroEnviado,
  type RegistroLocal,
} from './db/filaRegistros';
import {
  atualizarErroVisita,
  excluirVisitaLocalCompleta,
  lerVisitaLocal,
  listarVisitasLocaisPendentesOuRejeitadas,
  marcarCheckinEnviado,
  marcarVisitaRejeitada,
  type VisitaLocal,
} from './db/filaVisitas';
import { FILA_ENVIO_ATUALIZADA_EVENT, FILA_ENVIO_SERVIDOR_MUDOU_EVENT, filaEnvioEvents, processarFilaEnvio } from './filaEnvio';
import { estaOnline } from './network';
import type { PontoVenda } from '../types/api';

// Motor da fila offline de envio (docs/04-APP-MOBILE.md) — sem SQLite/rede real, cada dependência
// é mockada; o que se testa é a orquestração (ordem, quando parar, quando seguir) descrita nos
// comentários de filaEnvio.ts, que já funcionam como especificação.

// Mocks com factory explícita (em vez de jest.mock(path) simples): o automock do Jest carrega o
// módulo real pra descobrir seu formato, e a cadeia real passa por expo-sqlite → expo-asset, que
// não está instalado neste projeto (dependência transitiva ausente) — sem a factory, a suíte
// inteira falha em "Cannot find module 'expo-asset'" antes mesmo de rodar um teste.
jest.mock('./api/visitas', () => ({
  iniciarVisita: jest.fn(),
  finalizarVisita: jest.fn(),
  criarRegistro: jest.fn(),
}));
jest.mock('./db/database', () => ({
  ehErroDeRede: jest.fn(),
  ehErroTransitorio: jest.fn(),
}));
jest.mock('./db/filaRegistros', () => ({
  descartarRegistrosDaVisita: jest.fn(),
  listarRegistrosLocais: jest.fn(),
  marcarRegistroComErro: jest.fn(),
  marcarRegistroEnviado: jest.fn(),
}));
jest.mock('./db/filaVisitas', () => ({
  atualizarErroVisita: jest.fn(),
  excluirVisitaLocalCompleta: jest.fn(),
  lerVisitaLocal: jest.fn(),
  listarVisitasLocaisPendentesOuRejeitadas: jest.fn(),
  marcarCheckinEnviado: jest.fn(),
  marcarVisitaRejeitada: jest.fn(),
}));
jest.mock('./network', () => ({
  estaOnline: jest.fn(),
}));

const mockIniciarVisita = iniciarVisita as jest.MockedFunction<typeof iniciarVisita>;
const mockCriarRegistro = criarRegistro as jest.MockedFunction<typeof criarRegistro>;
const mockFinalizarVisita = finalizarVisita as jest.MockedFunction<typeof finalizarVisita>;
const mockEhErroDeRede = ehErroDeRede as jest.MockedFunction<typeof ehErroDeRede>;
const mockEhErroTransitorio = ehErroTransitorio as jest.MockedFunction<typeof ehErroTransitorio>;
const mockDescartarRegistrosDaVisita = descartarRegistrosDaVisita as jest.MockedFunction<typeof descartarRegistrosDaVisita>;
const mockListarRegistrosLocais = listarRegistrosLocais as jest.MockedFunction<typeof listarRegistrosLocais>;
const mockMarcarRegistroComErro = marcarRegistroComErro as jest.MockedFunction<typeof marcarRegistroComErro>;
const mockMarcarRegistroEnviado = marcarRegistroEnviado as jest.MockedFunction<typeof marcarRegistroEnviado>;
const mockAtualizarErroVisita = atualizarErroVisita as jest.MockedFunction<typeof atualizarErroVisita>;
const mockExcluirVisitaLocalCompleta = excluirVisitaLocalCompleta as jest.MockedFunction<typeof excluirVisitaLocalCompleta>;
const mockLerVisitaLocal = lerVisitaLocal as jest.MockedFunction<typeof lerVisitaLocal>;
const mockListarVisitasLocaisPendentesOuRejeitadas = listarVisitasLocaisPendentesOuRejeitadas as jest.MockedFunction<
  typeof listarVisitasLocaisPendentesOuRejeitadas
>;
const mockMarcarCheckinEnviado = marcarCheckinEnviado as jest.MockedFunction<typeof marcarCheckinEnviado>;
const mockMarcarVisitaRejeitada = marcarVisitaRejeitada as jest.MockedFunction<typeof marcarVisitaRejeitada>;
const mockEstaOnline = estaOnline as jest.MockedFunction<typeof estaOnline>;

const PDV = { id: 'pdv-1' } as unknown as PontoVenda;

function visitaLocal(overrides: Partial<VisitaLocal> = {}): VisitaLocal {
  return {
    id: 'visita-1',
    usuarioId: 'usuario-1',
    servidorId: null,
    status: 'RASCUNHO',
    pontoVenda: PDV,
    ordemServicoId: null,
    latitudeInicio: -3.1,
    longitudeInicio: -60.0,
    inicioEm: '2026-09-24T10:00:00.000Z',
    latitudeFim: null,
    longitudeFim: null,
    fimEm: null,
    erro: null,
    criadoEm: '2026-09-24T10:00:00.000Z',
    atualizadoEm: '2026-09-24T10:00:00.000Z',
    ...overrides,
  };
}

function registroLocal(overrides: Partial<RegistroLocal> = {}): RegistroLocal {
  return {
    id: 'registro-1',
    visitaLocalId: 'visita-1',
    servidorId: null,
    status: 'PENDENTE',
    tipoRegistroUuid: 'tipo-1',
    produtoAuditoriaUuid: null,
    produtoDescricao: null,
    tipoVinculo: null,
    secaoUuid: null,
    departamentoUuid: null,
    marcaUuid: null,
    vinculoDescricao: null,
    valoresCampos: null,
    ruptura: null,
    observacao: null,
    imagensLocais: [],
    erro: null,
    criadoEm: '2026-09-24T10:00:00.000Z',
    atualizadoEm: '2026-09-24T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEstaOnline.mockResolvedValue(true);
  mockListarRegistrosLocais.mockResolvedValue([]);
  mockEhErroTransitorio.mockReturnValue(false);
  mockEhErroDeRede.mockReturnValue(false);
});

describe('processarFilaEnvio', () => {
  it('não faz nada quando está offline', async () => {
    mockEstaOnline.mockResolvedValue(false);

    const resultado = await processarFilaEnvio('usuario-1');

    expect(resultado).toEqual({
      visitasEnviadas: 0,
      visitasRejeitadas: 0,
      registrosEnviados: 0,
      registrosComErro: 0,
      checkoutsConfirmados: 0,
    });
    expect(mockListarVisitasLocaisPendentesOuRejeitadas).not.toHaveBeenCalled();
  });

  it('processa as visitas da mais antiga pra mais nova, não na ordem que vieram', async () => {
    const ordemProcessada: string[] = [];
    mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([
      visitaLocal({ id: 'nova', criadoEm: '2026-09-24T12:00:00.000Z' }),
      visitaLocal({ id: 'antiga', criadoEm: '2026-09-24T09:00:00.000Z' }),
      visitaLocal({ id: 'meio', criadoEm: '2026-09-24T10:30:00.000Z' }),
    ]);
    mockIniciarVisita.mockImplementation(async (payload) => {
      ordemProcessada.push(payload.idempotency_key!);
      throw { response: undefined }; // falha transitória (ehErroTransitorio mockado true abaixo)
    });
    mockEhErroTransitorio.mockReturnValue(true);

    await processarFilaEnvio('usuario-1');

    expect(ordemProcessada).toEqual(['antiga', 'meio', 'nova']);
  });

  it('pula visita REJEITADA sem tentar check-in/registro/checkout', async () => {
    mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([visitaLocal({ status: 'REJEITADA' })]);

    await processarFilaEnvio('usuario-1');

    expect(mockIniciarVisita).not.toHaveBeenCalled();
    expect(mockListarRegistrosLocais).not.toHaveBeenCalled();
  });

  describe('check-in', () => {
    it('sucesso: marca enviado, conta e segue pros registros com a visita atualizada', async () => {
      mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([visitaLocal({ servidorId: null })]);
      mockIniciarVisita.mockResolvedValue({ id: 'servidor-123' } as any);
      mockLerVisitaLocal.mockResolvedValue(visitaLocal({ servidorId: 'servidor-123' }));

      const resultado = await processarFilaEnvio('usuario-1');

      expect(mockMarcarCheckinEnviado).toHaveBeenCalledWith('visita-1', 'servidor-123');
      expect(resultado.visitasEnviadas).toBe(1);
      // Buscou a visita de novo do banco local (agora com servidorId) antes de olhar os registros.
      expect(mockLerVisitaLocal).toHaveBeenCalledWith('visita-1');
      expect(mockListarRegistrosLocais).toHaveBeenCalledWith('visita-1');
    });

    it('já vem com servidorId: não tenta check-in de novo', async () => {
      mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([visitaLocal({ servidorId: 'servidor-ja-existe' })]);

      await processarFilaEnvio('usuario-1');

      expect(mockIniciarVisita).not.toHaveBeenCalled();
      expect(mockListarRegistrosLocais).toHaveBeenCalledWith('visita-1');
    });

    it('falha transitória: registra o erro, NÃO rejeita a visita, não tenta os registros', async () => {
      mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([visitaLocal()]);
      mockIniciarVisita.mockRejectedValue(new Error('network'));
      mockEhErroTransitorio.mockReturnValue(true);
      mockEhErroDeRede.mockReturnValue(true);

      const resultado = await processarFilaEnvio('usuario-1');

      expect(mockAtualizarErroVisita).toHaveBeenCalledWith('visita-1', expect.stringContaining('Sem conexão'));
      expect(mockMarcarVisitaRejeitada).not.toHaveBeenCalled();
      expect(resultado.visitasRejeitadas).toBe(0);
      expect(mockListarRegistrosLocais).not.toHaveBeenCalled();
    });

    it('falha permanente (4xx): rejeita a visita e descarta os registros dela', async () => {
      mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([visitaLocal()]);
      mockIniciarVisita.mockRejectedValue({
        isAxiosError: true,
        response: { data: { message: 'Fora do raio permitido.' } },
      });
      mockEhErroTransitorio.mockReturnValue(false);

      const resultado = await processarFilaEnvio('usuario-1');

      expect(mockMarcarVisitaRejeitada).toHaveBeenCalledWith('visita-1', 'Fora do raio permitido.');
      expect(mockDescartarRegistrosDaVisita).toHaveBeenCalledWith('visita-1');
      expect(resultado.visitasRejeitadas).toBe(1);
      expect(mockListarRegistrosLocais).not.toHaveBeenCalled();
    });
  });

  describe('registros', () => {
    it('sucesso: marca enviado e continua pro próximo', async () => {
      mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([visitaLocal({ servidorId: 'servidor-1' })]);
      mockListarRegistrosLocais.mockResolvedValue([
        registroLocal({ id: 'r1' }),
        registroLocal({ id: 'r2' }),
      ]);
      mockCriarRegistro.mockResolvedValue({ id: 'registro-servidor' } as any);

      const resultado = await processarFilaEnvio('usuario-1');

      expect(mockMarcarRegistroEnviado).toHaveBeenCalledWith('r1', 'registro-servidor');
      expect(mockMarcarRegistroEnviado).toHaveBeenCalledWith('r2', 'registro-servidor');
      expect(resultado.registrosEnviados).toBe(2);
    });

    it('falha transitória: PARA nos registros seguintes desta visita (não marca erro)', async () => {
      mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([visitaLocal({ servidorId: 'servidor-1' })]);
      mockListarRegistrosLocais.mockResolvedValue([
        registroLocal({ id: 'r1' }),
        registroLocal({ id: 'r2' }),
      ]);
      mockCriarRegistro.mockRejectedValue(new Error('network'));
      mockEhErroTransitorio.mockReturnValue(true);

      const resultado = await processarFilaEnvio('usuario-1');

      expect(mockCriarRegistro).toHaveBeenCalledTimes(1); // não tentou r2
      expect(mockMarcarRegistroComErro).not.toHaveBeenCalled();
      expect(resultado.registrosEnviados).toBe(0);
      expect(resultado.registrosComErro).toBe(0);
    });

    it('falha permanente: marca ERRO nesse registro mas segue pros outros e pro checkout', async () => {
      mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([
        visitaLocal({ servidorId: 'servidor-1', status: 'FINALIZADA_LOCAL', latitudeFim: -3.1, longitudeFim: -60.0 }),
      ]);
      mockListarRegistrosLocais.mockResolvedValue([registroLocal({ id: 'r1' }), registroLocal({ id: 'r2' })]);
      mockCriarRegistro
        .mockRejectedValueOnce({ isAxiosError: true, response: { data: { message: 'Produto inválido.' } } })
        .mockResolvedValueOnce({ id: 'registro-servidor-2' } as any);
      mockEhErroTransitorio.mockReturnValue(false);
      mockFinalizarVisita.mockResolvedValue({} as any);

      const resultado = await processarFilaEnvio('usuario-1');

      expect(mockMarcarRegistroComErro).toHaveBeenCalledWith('r1', 'Produto inválido.');
      expect(mockMarcarRegistroEnviado).toHaveBeenCalledWith('r2', 'registro-servidor-2');
      expect(resultado.registrosComErro).toBe(1);
      expect(resultado.registrosEnviados).toBe(1);
      // não travou o checkout por causa do erro de UM registro
      expect(mockFinalizarVisita).toHaveBeenCalled();
    });

    it('só envia os registros PENDENTE — ignora ENVIADO/ERRO/DESCARTADO', async () => {
      mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([visitaLocal({ servidorId: 'servidor-1' })]);
      mockListarRegistrosLocais.mockResolvedValue([
        registroLocal({ id: 'r1', status: 'ENVIADO' }),
        registroLocal({ id: 'r2', status: 'ERRO' }),
        registroLocal({ id: 'r3', status: 'PENDENTE' }),
      ]);
      mockCriarRegistro.mockResolvedValue({ id: 'x' } as any);

      await processarFilaEnvio('usuario-1');

      expect(mockCriarRegistro).toHaveBeenCalledTimes(1);
      expect(mockMarcarRegistroEnviado).toHaveBeenCalledWith('r3', 'x');
    });
  });

  describe('checkout', () => {
    it('só tenta quando a visita local está FINALIZADA_LOCAL', async () => {
      mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([
        visitaLocal({ servidorId: 'servidor-1', status: 'CHECKIN_ENVIADO' }),
      ]);

      await processarFilaEnvio('usuario-1');

      expect(mockFinalizarVisita).not.toHaveBeenCalled();
    });

    it('sucesso: exclui a cópia local e conta', async () => {
      mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([
        visitaLocal({ servidorId: 'servidor-1', status: 'FINALIZADA_LOCAL', latitudeFim: -3.2, longitudeFim: -60.1 }),
      ]);
      mockFinalizarVisita.mockResolvedValue({} as any);

      const resultado = await processarFilaEnvio('usuario-1');

      expect(mockFinalizarVisita).toHaveBeenCalledWith('servidor-1', -3.2, -60.1);
      expect(mockExcluirVisitaLocalCompleta).toHaveBeenCalledWith('visita-1', 'checkout-confirmado');
      expect(resultado.checkoutsConfirmados).toBe(1);
    });

    it('falha: registra o erro e NÃO exclui a cópia local (tenta de novo depois)', async () => {
      mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([
        visitaLocal({ servidorId: 'servidor-1', status: 'FINALIZADA_LOCAL', latitudeFim: -3.2, longitudeFim: -60.1 }),
      ]);
      mockFinalizarVisita.mockRejectedValue(new Error('offline'));
      mockEhErroDeRede.mockReturnValue(true);

      const resultado = await processarFilaEnvio('usuario-1');

      expect(mockAtualizarErroVisita).toHaveBeenCalledWith('visita-1', expect.stringContaining('Sem conexão'));
      expect(mockExcluirVisitaLocalCompleta).not.toHaveBeenCalled();
      expect(resultado.checkoutsConfirmados).toBe(0);
    });
  });

  describe('proteção contra passada concorrente', () => {
    it('uma segunda chamada enquanto a primeira ainda está em andamento não faz nada', async () => {
      let liberarPrimeira!: () => void;
      const travaPrimeira = new Promise<boolean>((resolve) => {
        liberarPrimeira = () => resolve(true);
      });
      mockEstaOnline.mockReturnValueOnce(travaPrimeira);
      mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([]);

      const primeira = processarFilaEnvio('usuario-1');
      const segunda = await processarFilaEnvio('usuario-1'); // não deve nem chegar a checar estaOnline

      expect(segunda).toEqual({
        visitasEnviadas: 0,
        visitasRejeitadas: 0,
        registrosEnviados: 0,
        registrosComErro: 0,
        checkoutsConfirmados: 0,
      });
      expect(mockEstaOnline).toHaveBeenCalledTimes(1);

      liberarPrimeira();
      await primeira;
    });
  });

  describe('eventos', () => {
    it('sempre dispara ATUALIZADA; só dispara SERVIDOR_MUDOU quando algo foi confirmado', async () => {
      const atualizada = jest.fn();
      const servidorMudou = jest.fn();
      filaEnvioEvents.addEventListener(FILA_ENVIO_ATUALIZADA_EVENT, atualizada);
      filaEnvioEvents.addEventListener(FILA_ENVIO_SERVIDOR_MUDOU_EVENT, servidorMudou);

      mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([]);
      await processarFilaEnvio('usuario-1');

      expect(atualizada).toHaveBeenCalledTimes(1);
      expect(servidorMudou).not.toHaveBeenCalled();

      mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([visitaLocal({ servidorId: 'servidor-1' })]);
      mockListarRegistrosLocais.mockResolvedValue([registroLocal()]);
      mockCriarRegistro.mockResolvedValue({ id: 'x' } as any);
      await processarFilaEnvio('usuario-1');

      expect(servidorMudou).toHaveBeenCalledTimes(1);

      filaEnvioEvents.removeEventListener(FILA_ENVIO_ATUALIZADA_EVENT, atualizada);
      filaEnvioEvents.removeEventListener(FILA_ENVIO_SERVIDOR_MUDOU_EVENT, servidorMudou);
    });
  });
});
