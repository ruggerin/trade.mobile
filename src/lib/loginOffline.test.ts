// Login sem internet e rede lenta (docs/108): hash da senha no aparelho, prazo do login online,
// disjuntor de rede ruim.

const mockMemoria = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockMemoria.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    mockMemoria.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    mockMemoria.delete(k);
  }),
}));
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256) }));
jest.mock('./db/database', () => ({
  ehErroDeRede: (err: unknown) => Boolean(err && typeof err === 'object' && 'isAxiosError' in err && !(err as { response?: unknown }).response),
}));

import {
  apagarAcessoOffline,
  conferirAcessoOffline,
  gravarAcessoOffline,
  iguaisEmTempoConstante,
  lerAcessoOffline,
  renovarContatoOnline,
  sessaoTrancada,
  validadeDoAcesso,
} from './auth/acessoOffline';
import { ErroLoginOffline, loginComPrazo } from './auth/loginComPrazo';
import { comPrazo, PrazoEstouradoError } from './prazo';
import {
  aoMudarQualidadeRede,
  DURACAO_RUIM_MS,
  FALHAS_PARA_MARCAR_RUIM,
  redeEstaRuim,
  registrarFalhaDeRede,
  registrarResposta,
  zerarQualidadeRede,
} from './qualidadeRede';
import { redeComPrazo } from './redeComPrazo';

const depois = <T,>(ms: number, valor: T) => new Promise<T>((resolve) => setTimeout(() => resolve(valor), ms));
const falhaDepois = (ms: number, erro: unknown) => new Promise<never>((_, reject) => setTimeout(() => reject(erro), ms));
const semRede = { isAxiosError: true, code: 'ECONNABORTED' };
const HORA = 60 * 60 * 1000;
const AGORA = 1_700_000_000_000;

beforeEach(() => {
  mockMemoria.clear();
  zerarQualidadeRede();
});

describe('acessoOffline', () => {
  it('guarda o hash (nunca a senha) e confere e-mail + senha', async () => {
    await gravarAcessoOffline({ usuarioId: 'u1', email: '  Ana@Empresa.com ', senha: 'segredo', horasPermitidas: 24, agora: AGORA });
    const bruto = mockMemoria.get('pdv_mobile_acesso_offline')!;
    expect(bruto).not.toContain('segredo');
    expect((await lerAcessoOffline())?.email).toBe('ana@empresa.com');

    const ok = await conferirAcessoOffline('ana@empresa.com', 'segredo', { agora: AGORA + HORA });
    expect(ok).toMatchObject({ ok: true, acesso: { usuarioId: 'u1' } });
    expect(await conferirAcessoOffline('ana@empresa.com', 'errada', { agora: AGORA + HORA })).toEqual({ ok: false, motivo: 'senha_incorreta' });
    expect(await conferirAcessoOffline('outra@empresa.com', 'segredo', { agora: AGORA + HORA })).toEqual({ ok: false, motivo: 'sem_acesso' });
  });

  it('respeita o prazo em horas e o 0 (empresa desligou)', async () => {
    await gravarAcessoOffline({ usuarioId: 'u1', email: 'ana@empresa.com', senha: 'segredo', horasPermitidas: 24, agora: AGORA });
    expect(validadeDoAcesso(await lerAcessoOffline())).toBe(AGORA + 24 * HORA);
    expect(await conferirAcessoOffline('ana@empresa.com', 'segredo', { agora: AGORA + 24 * HORA })).toEqual({ ok: false, motivo: 'vencido' });

    // Contato online renova o prazo e pode trazer um limite novo.
    await renovarContatoOnline(48, AGORA + 20 * HORA);
    expect((await conferirAcessoOffline('ana@empresa.com', 'segredo', { agora: AGORA + 60 * HORA })).ok).toBe(true);

    await renovarContatoOnline(0);
    expect(await conferirAcessoOffline('ana@empresa.com', 'segredo')).toEqual({ ok: false, motivo: 'desligado' });
    expect(validadeDoAcesso(await lerAcessoOffline())).toBeNull();
  });

  it('acesso amarrado ao aparelho: outro deviceId não confere', async () => {
    await gravarAcessoOffline({ usuarioId: 'u1', email: 'ana@empresa.com', senha: 'segredo', horasPermitidas: 24, agora: AGORA });
    expect(await conferirAcessoOffline('ana@empresa.com', 'segredo', { agora: AGORA, deviceId: 'outro-celular' })).toEqual({
      ok: false,
      motivo: 'senha_incorreta',
    });
  });

  it('apagar e sessão trancada', async () => {
    await gravarAcessoOffline({ usuarioId: 'u1', email: 'ana@empresa.com', senha: 'segredo', horasPermitidas: 24 });
    await apagarAcessoOffline();
    expect(await lerAcessoOffline()).toBeNull();

    expect(await sessaoTrancada.esta()).toBe(false);
    await sessaoTrancada.trancar();
    expect(await sessaoTrancada.esta()).toBe(true);
    await sessaoTrancada.destrancar();
    expect(await sessaoTrancada.esta()).toBe(false);
  });

  it('comparação em tempo constante', () => {
    expect(iguaisEmTempoConstante('abc', 'abc')).toBe(true);
    expect(iguaisEmTempoConstante('abc', 'abd')).toBe(false);
    expect(iguaisEmTempoConstante('abc', 'ab')).toBe(false);
  });
});

describe('comPrazo', () => {
  it('resolve no prazo e rejeita quando estoura', async () => {
    expect(await comPrazo(depois(5, 'ok'), 50)).toBe('ok');
    await expect(comPrazo(depois(80, 'tarde'), 10)).rejects.toBeInstanceOf(PrazoEstouradoError);
    await expect(comPrazo(falhaDepois(5, new Error('x')), 50)).rejects.toThrow('x');
  });
});

describe('loginComPrazo', () => {
  const resposta = { token: 't-novo', usuario: { id: 'u1' } };

  beforeEach(async () => {
    await gravarAcessoOffline({ usuarioId: 'u1', email: 'ana@empresa.com', senha: 'segredo', horasPermitidas: 24, agora: AGORA });
    jest.spyOn(Date, 'now').mockReturnValue(AGORA + HORA);
  });
  afterEach(() => jest.restoreAllMocks());

  it('rede no prazo: entra online', async () => {
    const r = await loginComPrazo({ email: 'ana@empresa.com', senha: 'segredo', loginOnline: () => depois(5, resposta), prazoMs: 50 });
    expect(r).toEqual({ modo: 'online', resposta });
  });

  it('erro do servidor nunca cai pro offline', async () => {
    const recusa = { isAxiosError: true, response: { status: 422 } };
    await expect(
      loginComPrazo({ email: 'ana@empresa.com', senha: 'segredo', loginOnline: () => Promise.reject(recusa), prazoMs: 50 }),
    ).rejects.toBe(recusa);
  });

  it('rede lenta com acesso válido: entra offline no prazo e entrega a resposta tardia', async () => {
    const r = await loginComPrazo({ email: 'ana@empresa.com', senha: 'segredo', loginOnline: () => depois(60, resposta), prazoMs: 10 });
    expect(r.modo).toBe('offline');
    if (r.modo === 'offline') expect(await r.respostaTardia).toEqual(resposta);
  });

  it('rede lenta sem acesso que sirva: espera a resposta de verdade', async () => {
    const r = await loginComPrazo({ email: 'ana@empresa.com', senha: 'outra', loginOnline: () => depois(40, resposta), prazoMs: 10 });
    expect(r).toEqual({ modo: 'online', resposta });

    await expect(
      loginComPrazo({ email: 'ana@empresa.com', senha: 'outra', loginOnline: () => falhaDepois(40, semRede), prazoMs: 10 }),
    ).rejects.toMatchObject({ motivo: 'senha_incorreta' });
  });

  it('sem rede: offline na hora; sem acesso, ErroLoginOffline com o motivo', async () => {
    const r = await loginComPrazo({ email: 'ana@empresa.com', senha: 'segredo', loginOnline: () => Promise.reject(semRede) });
    expect(r.modo).toBe('offline');

    const erro = await loginComPrazo({ email: 'ninguem@empresa.com', senha: 'x', loginOnline: () => Promise.reject(semRede) }).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroLoginOffline);
    expect(erro.motivo).toBe('sem_acesso');
    expect(erro.erroDeRede).toBe(semRede);
  });

  it('sem conexão nenhuma: nem dispara a rede', async () => {
    const loginOnline = jest.fn(() => depois(5, resposta));
    const r = await loginComPrazo({ email: 'ana@empresa.com', senha: 'segredo', loginOnline, temConexao: false });
    expect(r.modo).toBe('offline');
    expect(loginOnline).not.toHaveBeenCalled();
  });

  it('rede marcada como ruim: não espera o prazo', async () => {
    for (let i = 0; i < FALHAS_PARA_MARCAR_RUIM; i += 1) registrarFalhaDeRede();
    const inicio = performance.now();
    const r = await loginComPrazo({ email: 'ana@empresa.com', senha: 'segredo', loginOnline: () => depois(500, resposta), prazoMs: 400 });
    expect(r.modo).toBe('offline');
    expect(performance.now() - inicio).toBeLessThan(300);
  });
});

describe('qualidadeRede (disjuntor)', () => {
  it('abre depois de N falhas seguidas, avisa, e fecha com resposta rápida', () => {
    const ouvinte = jest.fn();
    const parar = aoMudarQualidadeRede(ouvinte);

    registrarFalhaDeRede(AGORA);
    registrarFalhaDeRede(AGORA);
    expect(redeEstaRuim(AGORA)).toBe(false);
    registrarFalhaDeRede(AGORA);
    expect(redeEstaRuim(AGORA)).toBe(true);
    expect(ouvinte).toHaveBeenCalledWith(true);

    // Vence sozinho.
    expect(redeEstaRuim(AGORA + DURACAO_RUIM_MS + 1)).toBe(false);

    // Resposta lenta não fecha; rápida fecha e avisa.
    registrarResposta(5_000, AGORA);
    expect(redeEstaRuim(AGORA)).toBe(true);
    registrarResposta(300, AGORA);
    expect(redeEstaRuim(AGORA)).toBe(false);
    expect(ouvinte).toHaveBeenLastCalledWith(false);
    parar();
  });

  it('resposta do servidor (mesmo 4xx) zera a contagem de falhas', () => {
    registrarFalhaDeRede();
    registrarFalhaDeRede();
    registrarResposta(100);
    registrarFalhaDeRede();
    expect(redeEstaRuim()).toBe(false);
  });

  it('redeComPrazo responde pelo cache na hora com a rede ruim, e ainda grava a rede quando chega', async () => {
    for (let i = 0; i < FALHAS_PARA_MARCAR_RUIM; i += 1) registrarFalhaDeRede();
    const salvar = jest.fn(() => Promise.resolve());
    const inicio = performance.now();
    const dados = await redeComPrazo({ rede: () => depois(100, ['novo']), salvar, lerCache: async () => ['velho'], prazoMs: 2_500 });
    expect(dados).toEqual(['velho']);
    expect(performance.now() - inicio).toBeLessThan(80);
    await depois(130, null);
    expect(salvar).toHaveBeenCalledWith(['novo']);
  });
});
