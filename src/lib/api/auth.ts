import type { Usuario } from '../../types/api';
import { apiClient } from './client';
import { obterDeviceId } from '../auth/deviceId';

export interface LoginResponse {
  token: string;
  usuario: Usuario;
}

// dispositivo_identificador é sempre enviado — só tem efeito no backend pra user_type
// PROMOTOR (trava de 1 dispositivo por vez, ver docs/02-API-BACKEND.md), mas não faz mal
// mandar sempre: ADMIN/GESTOR não usam esse fluxo pelo mobile mesmo.
export async function login(email: string, senha: string): Promise<LoginResponse> {
  const dispositivo_identificador = await obterDeviceId();
  const { data } = await apiClient.post<LoginResponse>('/auth/login', {
    email,
    senha,
    dispositivo_identificador,
  });
  return data;
}

export async function logout(): Promise<void> {
  await apiClient.post('/auth/logout');
}

export async function me(): Promise<{ usuario: Usuario }> {
  const { data } = await apiClient.get<{ usuario: Usuario }>('/auth/me');
  return data;
}
