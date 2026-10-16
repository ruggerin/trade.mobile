import Constants from 'expo-constants';
import axios from 'axios';
import { tokenStorage } from '../auth/tokenStorage';
import { assinarRequisicao, caminhoDaRequisicao, registrarHorarioServidor } from '../seguranca/chaveAparelho';
import { registrarVersaoApi, VERSAO_APP } from '../versao';

// Disparado quando a API responde 401 — o AuthContext escuta isso pra limpar a sessão e
// voltar pro Login. Mesmo padrão do admin (admin/src/lib/api/client.ts), só que aqui não tem
// window/DOM: usamos um EventTarget simples em vez de window.dispatchEvent.
export const authEvents = new EventTarget();
export const UNAUTHORIZED_EVENT = 'auth:unauthorized';
// 426 da API (docs/67 Fase 2): versão abaixo da mínima — o app mostra "Atualize o Horus".
export const APP_DESATUALIZADO_EVENT = 'app:desatualizado';

/** Evento de sessão encerrada com o texto que a API mandou ("Sua conta entrou em outro aparelho..."). */
export class SessaoEncerradaEvent extends Event {
  constructor(readonly mensagem: string | null) {
    super(UNAUTHORIZED_EVENT);
  }
}

// Prioridade: EXPO_PUBLIC_API_URL (definido em .env.local) > auto-detect via Metro.
// Precisa disso pra apontar pra um túnel (Cloudflare, ngrok) ou IP fixo quando o celular não
// está na mesma rede do PC — o auto-detect só funciona em rede local.
function resolveApiBaseUrl(): string {
  const configuredUrl = process.env.EXPO_PUBLIC_API_URL;

  if (configuredUrl) {
    return configuredUrl;
  }

  // O celular não enxerga 127.0.0.1 do PC — deriva o IP da máquina de dev a partir do host que
  // o próprio Metro bundler usou pra servir o app (mesmo IP que o Expo Go já está usando).
  const hostUri = Constants.expoConfig?.hostUri;
  const host = hostUri?.split(':')[0];

  if (!host) {
    // Fallback pro emulador Android, que mapeia 10.0.2.2 pro localhost do host — não cobre
    // Expo Go num device físico, mas evita quebrar totalmente se hostUri vier vazio.
    return 'http://10.0.2.2:8000/api';
  }

  return `http://${host}:8000/api`;
}

const baseURL = resolveApiBaseUrl();
// __DEV__ é a flag global do React Native/Metro (true em dev, removida do bundle de produção)
// — sem isso, esses logs (URL base, toda requisição, corpo de erro 4xx que pode ecoar dado
// digitado pelo promotor) iam pro log do dispositivo em produção também.
if (__DEV__) console.log('[api] baseURL:', baseURL);

export const apiClient = axios.create({
  baseURL,
  // Sem isso o request fica pendurado pra sempre quando a rede bloqueia a conexão em
  // silêncio (ex: firewall descartando o pacote) — nunca resolve nem rejeita, e a tela
  // de login fica girando o spinner sem nenhum erro aparecer.
  timeout: 8000,
  headers: {
    Accept: 'application/json',
    // Identifica o cliente pra medição de uso por app (docs/52) — o admin web manda 'admin'.
    'X-Client': 'mobile',
    // Versão mínima aceita pela API (docs/67 Fase 2).
    'X-App-Version': VERSAO_APP,
  },
});

apiClient.interceptors.request.use(async (config) => {
  const token = await tokenStorage.get();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
    // Prova de posse da chave do aparelho (docs/67 Fase 3) — a API só confere quando o aparelho
    // vinculado tem chave registrada; mandar sempre não atrapalha.
    try {
      const assinatura = await assinarRequisicao(config.method ?? 'get', caminhoDaRequisicao(config.baseURL, config.url), token);
      Object.entries(assinatura).forEach(([nome, valor]) => config.headers.set(nome, valor));
    } catch (err) {
      if (__DEV__) console.log('[api] assinatura falhou', err);
    }
  }

  if (__DEV__) console.log('[api] ->', config.method?.toUpperCase(), (config.baseURL ?? '') + (config.url ?? ''));

  return config;
});

apiClient.interceptors.response.use(
  (response) => {
    if (__DEV__) console.log('[api] <-', response.status, response.config.url);
    registrarHorarioServidor(response.headers.date as string | undefined);
    registrarVersaoApi(response.headers['x-api-version'] as string | undefined);
    return response;
  },
  async (error) => {
    if (axios.isAxiosError(error)) {
      if (__DEV__) {
        console.log(
          '[api] erro',
          error.code,
          error.message,
          '| url:',
          (error.config?.baseURL ?? '') + (error.config?.url ?? ''),
          '| status:',
          error.response?.status,
          // Corpo da resposta (ex.: { message, errors } de um 422) — pode ecoar dado que o
          // promotor digitou, só faz sentido em dev; sem isso, o log só diz "deu 422" sem dizer
          // o motivo, inútil pra debugar validação/regra de negócio.
          '| body:',
          error.response?.data,
        );
      }

      registrarHorarioServidor(error.response?.headers?.date as string | undefined);
      registrarVersaoApi(error.response?.headers?.['x-api-version'] as string | undefined);

      if (error.response?.status === 401) {
        await tokenStorage.clear();
        // A API diz por que a sessão caiu (docs/67 §4.5) — a tela de login mostra.
        const dados = error.response.data as { motivo?: string; message?: string } | undefined;
        authEvents.dispatchEvent(new SessaoEncerradaEvent(dados?.motivo ? (dados.message ?? null) : null));
      }

      if (error.response?.status === 426) {
        authEvents.dispatchEvent(new Event(APP_DESATUALIZADO_EVENT));
      }
    }

    return Promise.reject(error);
  },
);
