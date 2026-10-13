import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { apiClient } from '../api/client';
import { sha256Hex } from './chaveAparelho';

// Atestação do app (docs/67 Fase 3): prova pro servidor que é o app oficial do Horus num aparelho
// real — Play Integrity no Android, App Attest no iOS. A atestação vai amarrada a um desafio de uso
// único e à chave pública do aparelho (hash = SHA256(desafio|chave)), então só vale pra este login.
//
// No Expo Go o app que roda é o Expo Go, não o Horus: a atestação nunca passaria. Ali (e sempre que
// o servidor não exige nem tem Play Integrity configurado) nada é enviado — o servidor só bloqueia
// com ATESTACAO_OBRIGATORIA ligada.
const APP_ATTEST_KEY_ID = 'pdv_mobile_app_attest_key';

export interface Atestacao {
  desafio: string;
  plataforma: 'android' | 'ios';
  token?: string;
  key_id?: string;
  objeto?: string;
  assercao?: string;
}

interface Desafio {
  desafio: string;
  obrigatoria: boolean;
  play_integrity_projeto: string | null;
}

const noExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
let provedorAndroidPronto = false;

type ModuloIntegridade = typeof import('@expo/app-integrity');

/**
 * Carrega o @expo/app-integrity só na hora de atestar. Importar no topo do arquivo derrubava o app
 * na abertura em aparelho sem o módulo nativo (o Expo Go real não traz, apesar da documentação),
 * antes mesmo da tela de login — achado no teste no celular de 12/10/2026.
 */
function moduloIntegridade(): ModuloIntegridade | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@expo/app-integrity') as ModuloIntegridade;
  } catch {
    return null;
  }
}

/**
 * Pede desafio e atestação. `momento`: no login o iOS atesta uma chave nova; no refresh só gera uma
 * asserção com a chave já atestada (a Apple limita atestações). null = nada a enviar.
 */
export async function obterAtestacao(chavePublica: string, momento: 'login' | 'refresh'): Promise<Atestacao | null> {
  if (noExpoGo) return null;
  const AppIntegrity = moduloIntegridade();

  try {
    if (!AppIntegrity) throw new Error('módulo de atestação indisponível neste build');
    const { data } = await apiClient.post<Desafio>('/auth/desafio');
    const hash = sha256Hex(`${data.desafio}|${chavePublica}`);

    if (Platform.OS === 'android') {
      if (!data.play_integrity_projeto) return data.obrigatoria ? { desafio: data.desafio, plataforma: 'android' } : null;
      if (!provedorAndroidPronto) {
        await AppIntegrity.prepareIntegrityTokenProviderAsync(data.play_integrity_projeto);
        provedorAndroidPronto = true;
      }
      const token = await AppIntegrity.requestIntegrityCheckAsync(hash);
      return { desafio: data.desafio, plataforma: 'android', token };
    }

    if (Platform.OS === 'ios' && AppIntegrity.isSupported) {
      const chaveAtestada = await SecureStore.getItemAsync(APP_ATTEST_KEY_ID);
      if (momento === 'refresh' && chaveAtestada) {
        const assercao = await AppIntegrity.generateAssertionAsync(chaveAtestada, hash);
        return { desafio: data.desafio, plataforma: 'ios', assercao };
      }
      const keyId = await AppIntegrity.generateKeyAsync();
      const objeto = await AppIntegrity.attestKeyAsync(keyId, hash);
      await SecureStore.setItemAsync(APP_ATTEST_KEY_ID, keyId);
      return { desafio: data.desafio, plataforma: 'ios', key_id: keyId, objeto };
    }

    return data.obrigatoria ? { desafio: data.desafio, plataforma: Platform.OS === 'ios' ? 'ios' : 'android' } : null;
  } catch (err) {
    // Falha local (sem Play Services, App Attest indisponível): segue sem atestação; se o servidor
    // exigir, o login é recusado com uma mensagem clara.
    if (__DEV__) console.log('[atestacao] falhou', err);
    return null;
  }
}

/** Sinais de root/jailbreak e emulador — alerta pro ADMIN (INTEGRIDADE_MODO decide se bloqueia). */
export async function sinaisIntegridade(): Promise<{ root: boolean; emulador: boolean }> {
  let root = false;
  try {
    root = await Device.isRootedExperimentalAsync();
  } catch {
    root = false;
  }
  return { root, emulador: !Device.isDevice };
}

export function dadosDoAparelho(): { dispositivo_nome: string | null; dispositivo_plataforma: 'android' | 'ios' | null; dispositivo_versao_so: string | null } {
  return {
    dispositivo_nome: [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || null,
    dispositivo_plataforma: Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : null,
    dispositivo_versao_so: Device.osVersion,
  };
}
