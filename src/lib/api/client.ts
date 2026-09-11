import Constants from 'expo-constants';
import axios from 'axios';
import { tokenStorage } from '../auth/tokenStorage';

// Disparado quando a API responde 401 — o AuthContext escuta isso pra limpar a sessão e
// voltar pro Login. Mesmo padrão do admin (admin/src/lib/api/client.ts), só que aqui não tem
// window/DOM: usamos um EventTarget simples em vez de window.dispatchEvent.
export const authEvents = new EventTarget();
export const UNAUTHORIZED_EVENT = 'auth:unauthorized';

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
  },
});

apiClient.interceptors.request.use(async (config) => {
  const token = await tokenStorage.get();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  if (__DEV__) console.log('[api] ->', config.method?.toUpperCase(), (config.baseURL ?? '') + (config.url ?? ''));

  return config;
});

apiClient.interceptors.response.use(
  (response) => {
    if (__DEV__) console.log('[api] <-', response.status, response.config.url);
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

      if (error.response?.status === 401) {
        await tokenStorage.clear();
        authEvents.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
      }
    }

    return Promise.reject(error);
  },
);
