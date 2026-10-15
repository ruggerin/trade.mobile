// O módulo nativo do Sentry não existe no Jest: o que importa testar aqui é a LIMPEZA de dados
// (nada de localização, credencial ou dado pessoal sai num evento).
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  setUser: jest.fn(),
  setTag: jest.fn(),
  captureException: jest.fn(),
  wrap: (c: unknown) => c,
  mobileReplayIntegration: jest.fn((opcoes: unknown) => ({ name: 'MobileReplay', opcoes })),
}));

import * as Sentry from '@sentry/react-native';
import { configuracaoReplay, definirUsuarioSentry, limparBreadcrumb, limparEvento, redigir, reportarErro } from './sentry';

describe('redigir', () => {
  it('troca valor de chave sensível em qualquer nível, sem mexer no resto', () => {
    const r = redigir({
      loja: 'Mercado Central',
      latitude: -3.1,
      aninhado: { Authorization: 'Bearer x', senha: '123', tentativas: 2 },
      lista: [{ token: 'abc', ok: true }],
    });

    expect(r).toEqual({
      loja: 'Mercado Central',
      latitude: '[redigido]',
      aninhado: { Authorization: '[redigido]', senha: '[redigido]', tentativas: 2 },
      lista: [{ token: '[redigido]', ok: true }],
    });
  });

  it('não explode com null, primitivo nem objeto muito fundo', () => {
    expect(redigir(null)).toBeNull();
    expect(redigir('texto')).toBe('texto');
    let fundo: Record<string, unknown> = { latitude: 1 };
    for (let i = 0; i < 20; i++) fundo = { filho: fundo };
    expect(() => redigir(fundo)).not.toThrow();
  });
});

describe('limparEvento', () => {
  it('remove corpo, cookies, headers, e-mail, IP e nome do aparelho', () => {
    const evento = limparEvento({
      type: undefined,
      request: { data: { senha: 'x' }, cookies: { a: 'b' }, headers: { Authorization: 'Bearer y' }, query_string: 'q=1' },
      user: { id: 'u-1', email: 'a@b.com', username: 'fulano', ip_address: '1.2.3.4' },
      contexts: { device: { name: 'iPhone de Fulano', model: 'Moto G' } },
      extra: { latitude: -3.1, quantidade: 3 },
    } as never) as unknown as Record<string, Record<string, unknown>>;

    expect(evento.request).toEqual({});
    expect(evento.user).toEqual({ id: 'u-1' });
    expect(evento.contexts.device).toEqual({ model: 'Moto G' });
    expect(evento.extra).toEqual({ latitude: '[redigido]', quantidade: 3 });
  });
});

describe('limparBreadcrumb', () => {
  it('guarda método e rota, tira a query string e o que for sensível', () => {
    const b = limparBreadcrumb({
      category: 'xhr',
      data: { method: 'GET', url: 'https://api.x/api/visitas?busca=maria&token=abc', status_code: 200, Authorization: 'Bearer z' },
    });

    expect(b.data).toEqual({ method: 'GET', url: 'https://api.x/api/visitas', status_code: 200, Authorization: '[redigido]' });
  });

  it('breadcrumb sem data passa direto', () => {
    expect(limparBreadcrumb({ message: 'oi' })).toEqual({ message: 'oi' });
  });
});

describe('usuário e reporte', () => {
  beforeEach(() => jest.clearAllMocks());

  it('identifica só por id, empresa e tipo; logout limpa', () => {
    definirUsuarioSentry({ id: 'u-1', empresaId: 'e-9', tipo: 'PROMOTOR' });
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: 'u-1' });
    expect(Sentry.setTag).toHaveBeenCalledWith('empresa_id', 'e-9');
    expect(Sentry.setTag).toHaveBeenCalledWith('user_type', 'PROMOTOR');

    definirUsuarioSentry(null);
    expect(Sentry.setUser).toHaveBeenLastCalledWith(null);
  });

  it('reportarErro marca a origem e o nível fatal, e nunca lança', () => {
    const erro = new Error('boom');
    reportarErro(erro, 'erro_global', true);
    expect(Sentry.captureException).toHaveBeenCalledWith(erro, { tags: { origem: 'erro_global' }, level: 'fatal' });

    (Sentry.captureException as jest.Mock).mockImplementationOnce(() => {
      throw new Error('sdk quebrou');
    });
    expect(() => reportarErro(erro, 'render')).not.toThrow();
  });
});

describe('configuracaoReplay', () => {
  it('desligado: não devolve nada (nenhuma integração nativa)', () => {
    expect(configuracaoReplay(false)).toEqual({});
  });

  it('ligado: só grava em erro, nunca sessão normal, e mascara tudo', () => {
    const c = configuracaoReplay(true);

    expect(c.replaysSessionSampleRate).toBe(0);
    expect(c.replaysOnErrorSampleRate).toBe(1);
    expect(Sentry.mobileReplayIntegration).toHaveBeenCalledWith({ maskAllText: true, maskAllImages: true, maskAllVectors: true });
  });
});
