import { criarRegistro, enviarImagemRegistro, finalizarVisita, iniciarVisita, responderAcompanhamento } from './api/visitas';
import { listarRespostasDaVisita, marcarRespostaEnviada } from './db/filaAcompanhamentos';
import { ehErroDeRede, ehErroTransitorio } from './db/database';
import {
  descartarRegistrosDaVisita,
  listarRegistrosLocais,
  marcarImagemEnviada,
  marcarRegistroComErro,
  marcarRegistroCriadoNoServidor,
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
import {
  contarPendenciasEnvio,
  desligarRetentativaAutomatica,
  ESPERAS_RETENTATIVA_MS,
  FILA_ENVIO_ATUALIZADA_EVENT,
  FILA_ENVIO_SERVIDOR_MUDOU_EVENT,
  filaEnvioEvents,
  ligarRetentativaAutomatica,
  processarFilaEnvio,
} from './filaEnvio';
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
  enviarImagemRegistro: jest.fn(),
  responderAcompanhamento: jest.fn(),
}));
jest.mock('./db/filaAcompanhamentos', () => ({
  listarRespostasDaVisita: jest.fn(),
  marcarRespostaComErro: jest.fn(),
  marcarRespostaEnviada: jest.fn(),
}));
jest.mock('./db/database', () => ({
  ehErroDeRede: jest.fn(),
  ehErroTransitorio: jest.fn(),
}));
jest.mock('./db/filaRegistros', () => ({
  descartarRegistrosDaVisita: jest.fn(),
  listarRegistrosLocais: jest.fn(),
  marcarImagemEnviada: jest.fn(),
  marcarRegistroComErro: jest.fn(),
  marcarRegistroCriadoNoServidor: jest.fn(),
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
const mockMarcarRegistroCriado = marcarRegistroCriadoNoServidor as jest.MockedFunction<typeof marcarRegistroCriadoNoServidor>;
const mockMarcarImagemEnviada = marcarImagemEnviada as jest.MockedFunction<typeof marcarImagemEnviada>;
const mockEnviarImagemRegistro = enviarImagemRegistro as jest.MockedFunction<typeof enviarImagemRegistro>;
const mockAtualizarErroVisita = atualizarErroVisita as jest.MockedFunction<typeof atualizarErroVisita>;
const mockExcluirVisitaLocalCompleta = excluirVisitaLocalCompleta as jest.MockedFunction<typeof excluirVisitaLocalCompleta>;
const mockLerVisitaLocal = lerVisitaLocal as jest.MockedFunction<typeof lerVisitaLocal>;
const mockListarVisitasLocaisPendentesOuRejeitadas = listarVisitasLocaisPendentesOuRejeitadas as jest.MockedFunction<
  typeof listarVisitasLocaisPendentesOuRejeitadas
>;
const mockMarcarCheckinEnviado = marcarCheckinEnviado as jest.MockedFunction<typeof marcarCheckinEnviado>;
const mockMarcarVisitaRejeitada = marcarVisitaRejeitada as jest.MockedFunction<typeof marcarVisitaRejeitada>;
const mockEstaOnline = estaOnline as jest.MockedFunction<typeof estaOnline>;
const mockListarRespostasDaVisita = listarRespostasDaVisita as jest.MockedFunction<typeof listarRespostasDaVisita>;
const mockResponderAcompanhamento = responderAcompanhamento as jest.MockedFunction<typeof responderAcompanhamento>;
const mockMarcarRespostaEnviada = marcarRespostaEnviada as jest.MockedFunction<typeof marcarRespostaEnviada>;

const PDV = { id: 'pdv-1' } as unknown as PontoVenda;

function visitaLocal(overrides: Partial<VisitaLocal> = {}): VisitaLocal {
  return {
    id: 'visita-1',
    usuarioId: 'usuario-1',
    servidorId: null,
    status: 'RASCUNHO',
    pontoVenda: PDV,
    ordemServicoId: null,
    ordemServicoEscolhida: false,
    liberacaoId: null,
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
    imagensEnviadas: [],
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
  mockListarRespostasDaVisita.mockResolvedValue([]);
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

      expect(mockMarcarRegistroCriado).toHaveBeenCalledWith('r1', 'registro-servidor', false);
      expect(mockMarcarRegistroCriado).toHaveBeenCalledWith('r2', 'registro-servidor', false);
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
      expect(mockMarcarRegistroCriado).toHaveBeenCalledWith('r2', 'registro-servidor-2', false);
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
      expect(mockMarcarRegistroCriado).toHaveBeenCalledWith('r3', 'x', false);
    });
  });

  describe('fotos separadas do registro (rede lenta)', () => {
    it('dados de TODOS os registros sobem antes da primeira foto', async () => {
      mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([visitaLocal({ servidorId: 'servidor-1' })]);
      const r1 = registroLocal({ id: 'r1', imagensLocais: ['a.jpg', 'b.jpg'] });
      const r2 = registroLocal({ id: 'r2' });
      mockListarRegistrosLocais
        .mockResolvedValueOnce([r1, r2])
        .mockResolvedValue([{ ...r1, servidorId: 'srv-r1' }, { ...r2, servidorId: 'srv-r2', status: 'ENVIADO' }]);
      const ordem: string[] = [];
      mockCriarRegistro.mockImplementation(async (p) => {
        ordem.push(`registro:${p.idempotencyKey}`);
        return { id: `srv-${p.idempotencyKey}` } as any;
      });
      mockEnviarImagemRegistro.mockImplementation(async (_v, _r, uri) => {
        ordem.push(`foto:${uri}`);
        return { bytes: 1000 };
      });

      await processarFilaEnvio('usuario-1');

      expect(ordem).toEqual(['registro:r1', 'registro:r2', 'foto:a.jpg', 'foto:b.jpg']);
      // O registro avisa quantas fotos vêm depois (contam pra foto obrigatória no servidor).
      expect(mockCriarRegistro.mock.calls[0][0]).toMatchObject({ imagensAEnviar: 2 });
      expect(mockCriarRegistro.mock.calls[0][0]).not.toHaveProperty('imagensUri');
      expect(mockMarcarRegistroCriado).toHaveBeenCalledWith('r1', 'srv-r1', true);
      // Chave estável por foto: id local do registro + posição.
      expect(mockEnviarImagemRegistro).toHaveBeenCalledWith('servidor-1', 'srv-r1', 'b.jpg', 'r1:1');
    });

    it('não reenvia foto já confirmada e para na falha passageira, sem check-out', async () => {
      mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([
        visitaLocal({ servidorId: 'servidor-1', status: 'FINALIZADA_LOCAL', latitudeFim: -3.1, longitudeFim: -60.0 }),
      ]);
      mockListarRegistrosLocais.mockResolvedValue([
        registroLocal({ id: 'r1', servidorId: 'srv-r1', imagensLocais: ['a.jpg', 'b.jpg', 'c.jpg'], imagensEnviadas: ['a.jpg'] }),
      ]);
      mockEnviarImagemRegistro.mockRejectedValue(new Error('timeout'));
      mockEhErroTransitorio.mockReturnValue(true);

      await processarFilaEnvio('usuario-1');

      expect(mockCriarRegistro).not.toHaveBeenCalled();
      expect(mockEnviarImagemRegistro).toHaveBeenCalledTimes(1);
      expect(mockEnviarImagemRegistro).toHaveBeenCalledWith('servidor-1', 'srv-r1', 'b.jpg', 'r1:1');
      expect(mockMarcarImagemEnviada).not.toHaveBeenCalled();
      expect(mockFinalizarVisita).not.toHaveBeenCalled();
    });

    it('foto recusada de vez não trava as outras nem o check-out', async () => {
      mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([
        visitaLocal({ servidorId: 'servidor-1', status: 'FINALIZADA_LOCAL', latitudeFim: -3.1, longitudeFim: -60.0 }),
      ]);
      mockListarRegistrosLocais.mockResolvedValue([
        registroLocal({ id: 'r1', servidorId: 'srv-r1', imagensLocais: ['a.jpg', 'b.jpg'] }),
      ]);
      mockEnviarImagemRegistro
        .mockRejectedValueOnce({ isAxiosError: true, response: { status: 422, data: { message: 'Arquivo inválido.' } } })
        .mockResolvedValueOnce({ bytes: 1000 });
      mockEhErroTransitorio.mockReturnValue(false);
      mockFinalizarVisita.mockResolvedValue({} as any);

      await processarFilaEnvio('usuario-1');

      expect(mockMarcarImagemEnviada).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }), 'a.jpg', 'Arquivo inválido.');
      expect(mockMarcarImagemEnviada).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }), 'b.jpg');
      expect(mockFinalizarVisita).toHaveBeenCalled();
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

      // 4º argumento = hora do campo (docs/51); visita sem fimEm local manda null e o servidor usa a chegada.
      expect(mockFinalizarVisita).toHaveBeenCalledWith('servidor-1', -3.2, -60.1, null);
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

  describe('proteção contra passada concorrente (docs/51 §3.1)', () => {
    it('uma segunda chamada no meio não roda junto, mas também não se perde: vira outra passada na sequência', async () => {
      let liberarPrimeira!: () => void;
      const travaPrimeira = new Promise<boolean>((resolve) => {
        liberarPrimeira = () => resolve(true);
      });
      mockEstaOnline.mockReturnValueOnce(travaPrimeira);
      mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([]);

      const primeira = processarFilaEnvio('usuario-1');
      const segunda = await processarFilaEnvio('usuario-1'); // não roda junto: nem checa a rede

      expect(segunda.checkoutsConfirmados).toBe(0);
      expect(mockEstaOnline).toHaveBeenCalledTimes(1);

      liberarPrimeira();
      await primeira;
      // A primeira, ao terminar, rodou a passada que tinha sido pedida no meio.
      expect(mockEstaOnline).toHaveBeenCalledTimes(2);
    });

    it('checkout tocado enquanto o check-in ainda sobe é enviado na mesma chamada, sem esperar outro gatilho', async () => {
      let liberarCheckin!: () => void;
      mockIniciarVisita.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            liberarCheckin = () => resolve({ id: 'servidor-1' } as any);
          }),
      );
      const aberta = visitaLocal();
      const finalizada = visitaLocal({ servidorId: 'servidor-1', status: 'FINALIZADA_LOCAL', latitudeFim: -3.1, longitudeFim: -60.0, fimEm: '2026-09-24T11:00:00.000Z' });
      // 1ª passada lê a visita ainda aberta; a passada extra já a lê finalizada.
      mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValueOnce([aberta]).mockResolvedValue([finalizada]);
      mockLerVisitaLocal.mockResolvedValue(visitaLocal({ servidorId: 'servidor-1', status: 'CHECKIN_ENVIADO' }));
      mockFinalizarVisita.mockResolvedValue({} as any);

      const primeira = processarFilaEnvio('usuario-1');
      await Promise.resolve();
      await processarFilaEnvio('usuario-1'); // o "Finalizar" do promotor, no meio do envio do check-in
      liberarCheckin();
      const resultado = await primeira;

      expect(mockFinalizarVisita).toHaveBeenCalledWith('servidor-1', -3.1, -60.0, '2026-09-24T11:00:00.000Z');
      expect(resultado.visitasEnviadas).toBe(1);
      expect(resultado.checkoutsConfirmados).toBe(1);
    });
  });

  describe('hora do campo (docs/51 Fase 2)', () => {
    it('check-in, registro e checkout levam a hora em que o promotor fez, não a do envio', async () => {
      mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([visitaLocal({ inicioEm: '2026-09-24T10:00:00.000Z' })]);
      mockIniciarVisita.mockResolvedValue({ id: 'servidor-1' } as any);
      mockLerVisitaLocal.mockResolvedValue(
        visitaLocal({ servidorId: 'servidor-1', status: 'FINALIZADA_LOCAL', latitudeFim: -3.1, longitudeFim: -60.0, fimEm: '2026-09-24T10:45:00.000Z' }),
      );
      mockListarRegistrosLocais.mockResolvedValue([registroLocal({ criadoEm: '2026-09-24T10:20:00.000Z' })]);
      mockCriarRegistro.mockResolvedValue({ id: 'r' } as any);
      mockFinalizarVisita.mockResolvedValue({} as any);

      await processarFilaEnvio('usuario-1');

      expect(mockIniciarVisita).toHaveBeenCalledWith(expect.objectContaining({ inicio_em: '2026-09-24T10:00:00.000Z' }));
      expect(mockCriarRegistro).toHaveBeenCalledWith(expect.objectContaining({ criadoEm: '2026-09-24T10:20:00.000Z' }));
      expect(mockFinalizarVisita).toHaveBeenCalledWith('servidor-1', -3.1, -60.0, '2026-09-24T10:45:00.000Z');
    });
  });

  describe('o que ainda falta enviar', () => {
    it('conta check-in não aceito, registro pendente e checkout não confirmado; ignora aberta já enviada e rejeitada', async () => {
      mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([
        visitaLocal({ id: 'a' }), // check-in não aceito
        visitaLocal({ id: 'b', servidorId: 's-b', status: 'FINALIZADA_LOCAL' }), // checkout pendente
        visitaLocal({ id: 'c', servidorId: 's-c', status: 'CHECKIN_ENVIADO' }), // registro pendente
        visitaLocal({ id: 'd', servidorId: 's-d', status: 'CHECKIN_ENVIADO' }), // aberta, tudo enviado
        visitaLocal({ id: 'e', status: 'REJEITADA' }),
      ]);
      mockListarRegistrosLocais.mockImplementation(async (id) =>
        id === 'c' ? [registroLocal({ visitaLocalId: 'c' })] : [registroLocal({ visitaLocalId: String(id), status: 'ENVIADO' } as any)],
      );

      expect(await contarPendenciasEnvio('usuario-1')).toBe(3);
    });
  });

  describe('retentativa automática (docs/51 §3.2)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
      desligarRetentativaAutomatica();
      jest.useRealTimers();
    });

    async function esperarPassada() {
      // Deixa as promises da passada (mocks resolvidos) e o agendamento rodarem.
      for (let i = 0; i < 20; i++) await Promise.resolve();
    }

    it('com pendência, tenta de novo sozinha com espera crescente (15 s, 30 s...)', async () => {
      mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([visitaLocal()]);
      mockIniciarVisita.mockRejectedValue(new Error('rede'));
      mockEhErroTransitorio.mockReturnValue(true);
      mockEhErroDeRede.mockReturnValue(true);

      ligarRetentativaAutomatica('usuario-1');
      await esperarPassada();
      expect(mockIniciarVisita).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(ESPERAS_RETENTATIVA_MS[0] - 1);
      await esperarPassada();
      expect(mockIniciarVisita).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(1);
      await esperarPassada();
      expect(mockIniciarVisita).toHaveBeenCalledTimes(2);

      // Sem progresso: a próxima espera é a seguinte da escada.
      jest.advanceTimersByTime(ESPERAS_RETENTATIVA_MS[0]);
      await esperarPassada();
      expect(mockIniciarVisita).toHaveBeenCalledTimes(2);
      jest.advanceTimersByTime(ESPERAS_RETENTATIVA_MS[1] - ESPERAS_RETENTATIVA_MS[0]);
      await esperarPassada();
      expect(mockIniciarVisita).toHaveBeenCalledTimes(3);
    });

    it('fila vazia não agenda nada', async () => {
      mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([]);

      ligarRetentativaAutomatica('usuario-1');
      await esperarPassada();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('desligada (app em segundo plano), nenhum timer fica vivo', async () => {
      mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([visitaLocal()]);
      mockIniciarVisita.mockRejectedValue(new Error('rede'));
      mockEhErroTransitorio.mockReturnValue(true);

      ligarRetentativaAutomatica('usuario-1');
      await esperarPassada();
      expect(jest.getTimerCount()).toBe(1);

      desligarRetentativaAutomatica();
      expect(jest.getTimerCount()).toBe(0);
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

// docs/83 — resposta ao "ainda está lá?" sai depois do registro do formulário e antes do checkout.
describe('respostas de acompanhamento', () => {
  const resposta = (registroLocalId: string | null) => ({
    id: 'resp-1',
    visitaLocalId: 'visita-1',
    acompanhamentoUuid: 'acomp-1',
    resposta: 'CONTINUA' as const,
    registroLocalId,
    status: 'PENDENTE' as const,
    erro: null,
    criadoEm: '2026-09-24T10:05:00.000Z',
  });

  it('espera o registro do formulário e não faz checkout antes', async () => {
    const visita = visitaLocal({ servidorId: 'srv-1', status: 'FINALIZADA_LOCAL' });
    mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([visita]);
    // Registro de "continua" falhou por rede: continua PENDENTE.
    mockListarRegistrosLocais.mockResolvedValue([registroLocal({ id: 'reg-1', status: 'PENDENTE' })]);
    mockCriarRegistro.mockRejectedValue(new Error('rede'));
    mockEhErroTransitorio.mockReturnValue(true);
    mockListarRespostasDaVisita.mockResolvedValue([resposta('reg-1')]);

    await processarFilaEnvio('usuario-1');

    expect(mockResponderAcompanhamento).not.toHaveBeenCalled();
    expect(mockFinalizarVisita).not.toHaveBeenCalled();
  });

  it('manda a resposta com o registro do servidor e depois o checkout', async () => {
    const visita = visitaLocal({ servidorId: 'srv-1', status: 'FINALIZADA_LOCAL' });
    mockListarVisitasLocaisPendentesOuRejeitadas.mockResolvedValue([visita]);
    mockListarRegistrosLocais.mockResolvedValue([registroLocal({ id: 'reg-1', status: 'ENVIADO', servidorId: 'reg-srv' })]);
    mockListarRespostasDaVisita.mockResolvedValue([resposta('reg-1')]);
    mockResponderAcompanhamento.mockResolvedValue();
    mockFinalizarVisita.mockResolvedValue({} as never);

    await processarFilaEnvio('usuario-1');

    expect(mockResponderAcompanhamento).toHaveBeenCalledWith('srv-1', 'acomp-1', expect.objectContaining({ registro_uuid: 'reg-srv', idempotency_key: 'resp-1' }));
    expect(mockMarcarRespostaEnviada).toHaveBeenCalledWith('resp-1');
    expect(mockFinalizarVisita).toHaveBeenCalled();
  });
});

