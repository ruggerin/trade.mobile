import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

// Chave do aparelho (docs/67 Fase 3): par P-256 gerado uma vez por instalação, a privada só no
// SecureStore (Keystore/Keychain). A pública vai no login; depois disso todo request vai assinado
// (X-Assinatura) — token copiado pra outro aparelho ou script não serve sem a privada. O servidor
// verifica em EnsureAssinaturaAparelho; o formato da mensagem precisa bater com o de lá.
const CHAVE_PRIVADA_KEY = 'pdv_mobile_chave_aparelho';

let cache: Uint8Array | null = null;
// Diferença entre o relógio do servidor e o do aparelho (ms) — o servidor só aceita assinatura com
// timestamp perto do dele, e relógio de celular erra. Atualizada pelo header Date das respostas.
let deslocamentoRelogioMs = 0;

async function chavePrivada(): Promise<Uint8Array> {
  if (cache) return cache;

  const salva = await SecureStore.getItemAsync(CHAVE_PRIVADA_KEY);
  if (salva) {
    cache = hexToBytes(salva);
    return cache;
  }

  const nova = p256.utils.randomPrivateKey(Crypto.getRandomBytes(48));
  await SecureStore.setItemAsync(CHAVE_PRIVADA_KEY, bytesToHex(nova));
  cache = nova;
  return nova;
}

function base64(bytes: Uint8Array): string {
  let binario = '';
  bytes.forEach((b) => {
    binario += String.fromCharCode(b);
  });
  return btoa(binario);
}

/** Chave pública (ponto não comprimido, 65 bytes) em base64 — o formato que o login espera. */
export async function chavePublicaBase64(): Promise<string> {
  return base64(p256.getPublicKey(await chavePrivada(), false));
}

export function sha256Hex(texto: string): string {
  return bytesToHex(sha256(utf8ToBytes(texto)));
}

export function registrarHorarioServidor(headerDate: string | undefined): void {
  if (!headerDate) return;
  const servidor = Date.parse(headerDate);
  if (!Number.isNaN(servidor)) deslocamentoRelogioMs = servidor - Date.now();
}

/** "/api/visitas" a partir de baseURL + url do axios, sem host nem query string. */
export function caminhoDaRequisicao(baseURL: string | undefined, url: string | undefined): string {
  const completa = /^https?:\/\//.test(url ?? '') ? (url ?? '') : `${(baseURL ?? '').replace(/\/$/, '')}/${(url ?? '').replace(/^\//, '')}`;
  const semHost = completa.replace(/^https?:\/\/[^/]+/, '');
  return semHost.split('?')[0].split('#')[0] || '/';
}

/**
 * Authorization + assinatura pra chamadas que não passam pelo apiClient (FileSystem.downloadAsync,
 * <Image source={{ headers }}>) — sem a assinatura a API recusa quando o aparelho tem chave.
 */
export async function headersAutenticados(url: string, token: string, metodo = 'GET'): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${token}`,
    ...(await assinarRequisicao(metodo, caminhoDaRequisicao(undefined, url), token)),
  };
}

/**
 * Headers de assinatura: ECDSA P-256 de "MÉTODO\n/caminho\ntimestamp\nhash-do-token", onde
 * hash-do-token é o SHA-256 da parte secreta do token (depois do "|").
 */
export async function assinarRequisicao(metodo: string, caminho: string, token: string): Promise<Record<string, string>> {
  const em = Math.floor((Date.now() + deslocamentoRelogioMs) / 1000).toString();
  const segredo = token.includes('|') ? token.split('|').slice(1).join('|') : token;
  const mensagem = `${metodo.toUpperCase()}\n${caminho}\n${em}\n${sha256Hex(segredo)}`;
  const assinatura = p256.sign(sha256(utf8ToBytes(mensagem)), await chavePrivada(), { prehash: false });

  return {
    'X-Assinatura-Em': em,
    'X-Assinatura': base64(assinatura.toDERRawBytes()),
  };
}
