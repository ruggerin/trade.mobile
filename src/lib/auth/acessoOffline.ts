import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { obterDeviceId } from './deviceId';

/**
 * Login sem internet (docs/108 §5.1). Depois de um login online, o app guarda no SecureStore um hash
 * da senha (PBKDF2-SHA256, sal aleatório + id do aparelho) — nunca a senha — amarrado ao usuário e a
 * este celular. Quando a rede não responde a tempo, a senha digitada é conferida aqui e o promotor
 * entra em modo offline com o token e o usuário já salvos, desde que o último contato online tenha
 * sido há menos de `horasPermitidas` (parâmetro LOGIN_OFFLINE_HORAS da empresa; 0 = desligado).
 *
 * Apagado no "Sair e limpar este aparelho", quando a sessão cai (401) e quando outro usuário entra.
 */
const CHAVE_ACESSO = 'pdv_mobile_acesso_offline';
// "Sair" tranca a sessão em vez de apagá-la (docs/108 §9.1): token, cache e acesso offline ficam,
// e o app volta pro Login até a senha ser conferida (online ou aqui).
const CHAVE_TRANCADA = 'pdv_mobile_sessao_trancada';

/**
 * Iterações do PBKDF2. O Hermes não tem JIT: 100 mil iterações em JS puro levam vários segundos num
 * aparelho de entrada. Com o sal + id do aparelho e a trava de 1 celular por usuário (docs/67 §4),
 * 10 mil já tornam a força bruta no aparelho roubado inviável no prazo em que o acesso vale.
 * Medir na Fase 5 (docs/108 §8) e registrar aqui se mudar.
 */
export const ITERACOES_PBKDF2 = 10_000;
export const HORAS_OFFLINE_PADRAO = 24;

export interface AcessoOffline {
  usuarioId: string;
  email: string;
  /** Sal aleatório (hex). */
  sal: string;
  /** PBKDF2-SHA256(senha, sal + deviceId) em hex. */
  hash: string;
  /** Último login online ou `/auth/me` com 2xx (epoch ms). */
  ultimoLoginOnline: number;
  /** LOGIN_OFFLINE_HORAS lido no último contato online. 0 = login offline desligado. */
  horasPermitidas: number;
}

export type MotivoRecusaOffline = 'sem_acesso' | 'desligado' | 'vencido' | 'senha_incorreta';

export type ResultadoOffline = { ok: true; acesso: AcessoOffline } | { ok: false; motivo: MotivoRecusaOffline };

export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function derivar(senha: string, salHex: string, deviceId: string): Promise<string> {
  const sal = new Uint8Array([...hexToBytes(salHex), ...utf8ToBytes(deviceId)]);
  return bytesToHex(await pbkdf2Async(sha256, utf8ToBytes(senha), sal, { c: ITERACOES_PBKDF2, dkLen: 32 }));
}

/** Comparação em tempo constante — não vaza por quanto tempo o hash "quase bateu". */
export function iguaisEmTempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i += 1) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

export async function lerAcessoOffline(): Promise<AcessoOffline | null> {
  try {
    const valor = await SecureStore.getItemAsync(CHAVE_ACESSO);
    if (!valor) return null;
    const acesso = JSON.parse(valor) as Partial<AcessoOffline>;
    if (!acesso.usuarioId || !acesso.email || !acesso.sal || !acesso.hash) return null;
    return {
      usuarioId: acesso.usuarioId,
      email: acesso.email,
      sal: acesso.sal,
      hash: acesso.hash,
      ultimoLoginOnline: Number(acesso.ultimoLoginOnline ?? 0),
      horasPermitidas: Number.isFinite(acesso.horasPermitidas) ? Number(acesso.horasPermitidas) : HORAS_OFFLINE_PADRAO,
    };
  } catch {
    return null;
  }
}

/** Grava (ou regrava) o acesso depois de um login ONLINE com 2xx. */
export async function gravarAcessoOffline(dados: {
  usuarioId: string;
  email: string;
  senha: string;
  horasPermitidas: number;
  agora?: number;
}): Promise<void> {
  const sal = bytesToHex(Crypto.getRandomBytes(16));
  const hash = await derivar(dados.senha, sal, await obterDeviceId());
  const acesso: AcessoOffline = {
    usuarioId: dados.usuarioId,
    email: normalizarEmail(dados.email),
    sal,
    hash,
    ultimoLoginOnline: dados.agora ?? Date.now(),
    horasPermitidas: dados.horasPermitidas,
  };
  await SecureStore.setItemAsync(CHAVE_ACESSO, JSON.stringify(acesso));
}

/** Contato online confirmado (`/auth/me` 2xx): renova o prazo e o limite de horas, se informado. */
export async function renovarContatoOnline(horasPermitidas?: number, agora: number = Date.now()): Promise<void> {
  const acesso = await lerAcessoOffline();
  if (!acesso) return;
  acesso.ultimoLoginOnline = agora;
  if (horasPermitidas !== undefined) acesso.horasPermitidas = horasPermitidas;
  await SecureStore.setItemAsync(CHAVE_ACESSO, JSON.stringify(acesso));
}

export async function apagarAcessoOffline(): Promise<void> {
  await SecureStore.deleteItemAsync(CHAVE_ACESSO);
}

/** Até quando o acesso offline vale (epoch ms), ou null se não há acesso / está desligado. */
export function validadeDoAcesso(acesso: AcessoOffline | null): number | null {
  if (!acesso || acesso.horasPermitidas <= 0) return null;
  return acesso.ultimoLoginOnline + acesso.horasPermitidas * 60 * 60 * 1000;
}

/**
 * Confere e-mail + senha contra o acesso guardado. A ordem das recusas importa pra mensagem: sem
 * acesso neste aparelho → empresa desligou → prazo vencido → senha errada.
 */
export async function conferirAcessoOffline(
  email: string,
  senha: string,
  opcoes: { agora?: number; deviceId?: string } = {},
): Promise<ResultadoOffline> {
  const acesso = await lerAcessoOffline();
  if (!acesso || acesso.email !== normalizarEmail(email)) return { ok: false, motivo: 'sem_acesso' };
  if (acesso.horasPermitidas <= 0) return { ok: false, motivo: 'desligado' };
  const validade = validadeDoAcesso(acesso);
  if (validade === null || (opcoes.agora ?? Date.now()) >= validade) return { ok: false, motivo: 'vencido' };
  const hash = await derivar(senha, acesso.sal, opcoes.deviceId ?? (await obterDeviceId()));
  if (!iguaisEmTempoConstante(hash, acesso.hash)) return { ok: false, motivo: 'senha_incorreta' };
  return { ok: true, acesso };
}

export const sessaoTrancada = {
  async esta(): Promise<boolean> {
    return (await SecureStore.getItemAsync(CHAVE_TRANCADA)) === '1';
  },
  async trancar(): Promise<void> {
    await SecureStore.setItemAsync(CHAVE_TRANCADA, '1');
  },
  async destrancar(): Promise<void> {
    await SecureStore.deleteItemAsync(CHAVE_TRANCADA);
  },
};
