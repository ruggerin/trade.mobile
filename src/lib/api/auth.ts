import type { Usuario } from '../../types/api';
import { apiClient } from './client';
import { obterDeviceId } from '../auth/deviceId';
import { chavePublicaBase64 } from '../seguranca/chaveAparelho';
import { dadosDoAparelho, obterAtestacao, sinaisIntegridade } from '../seguranca/atestacao';

export interface LoginResponse {
  token: string;
  usuario: Usuario;
}

// dispositivo_identificador é sempre enviado — trava de 1 aparelho por usuário no app, pra
// qualquer user_type (docs/67 §4). O header X-Client: mobile marca a sessão como do app.
// Junto vão o modelo/versão do aparelho (tela de licenças do ADMIN), a chave pública que assina os
// requests, a atestação do app e os sinais de root/emulador (docs/67 Fase 3).
export async function login(email: string, senha: string): Promise<LoginResponse> {
  const dispositivo_identificador = await obterDeviceId();
  const chave_publica = await chavePublicaBase64();
  const [atestacao, integridade] = await Promise.all([obterAtestacao(chave_publica, 'login'), sinaisIntegridade()]);

  const { data } = await apiClient.post<LoginResponse>('/auth/login', {
    email,
    senha,
    dispositivo_identificador,
    ...dadosDoAparelho(),
    chave_publica,
    atestacao,
    integridade,
  });
  return data;
}

// Troca o token atual por um novo com mais 7 dias (docs/67 §4.4) — ver lib/auth/renovacaoSessao.ts.
// A atestação também roda aqui (docs/67 §5.3), com a chave já registrada no login.
export async function refresh(): Promise<{ token: string }> {
  const atestacao = await obterAtestacao(await chavePublicaBase64(), 'refresh');
  const { data } = await apiClient.post<{ token: string }>('/auth/refresh', { atestacao });
  return data;
}

export async function logout(): Promise<void> {
  await apiClient.post('/auth/logout');
}

export async function me(): Promise<{ usuario: Usuario }> {
  const { data } = await apiClient.get<{ usuario: Usuario }>('/auth/me');
  return data;
}
