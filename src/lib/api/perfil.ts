import type { Usuario } from '../../types/api';
import { apiClient } from './client';

// Self-service de foto de perfil — sempre direto (sem passar pela fila offline): é uma ação
// pontual, feita raramente, não faz parte da coleta de campo que precisa resistir sem rede.
// Mesmo formato de FormData usado em lib/api/visitas.ts::criarRegistro.
export async function atualizarFotoPerfil(imagemUri: string): Promise<Usuario> {
  const nomeArquivo = imagemUri.split('/').pop() ?? 'foto.jpg';
  const extensao = /\.(\w+)$/.exec(nomeArquivo)?.[1]?.toLowerCase();
  const tipoMime = `image/${extensao === 'jpg' ? 'jpeg' : (extensao ?? 'jpeg')}`;

  const form = new FormData();
  form.append('imagem', { uri: imagemUri, name: nomeArquivo, type: tipoMime } as unknown as Blob);

  const { data } = await apiClient.post<{ usuario: Usuario }>('/auth/me/foto', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data.usuario;
}

export async function removerFotoPerfil(): Promise<Usuario> {
  const { data } = await apiClient.delete<{ usuario: Usuario }>('/auth/me/foto');
  return data.usuario;
}
