import type { Usuario } from '../types/api';

/**
 * O promotor vê a régua de XP? Recurso de plano ligado E fora do modo prévia (docs/88 §2.1, §13).
 * Vem com a empresa do usuário logado — sem chamada extra, funciona offline.
 */
export function xpVisivel(usuario: Usuario | null | undefined): boolean {
  return Boolean(usuario?.empresa?.controle_xp_habilitado && usuario.empresa.xp?.visivel_promotor);
}

export function rankingVisivel(usuario: Usuario | null | undefined): boolean {
  return xpVisivel(usuario) && Boolean(usuario?.empresa?.xp?.ranking_habilitado);
}

export const formatarXp = (n: number) => n.toLocaleString('pt-BR');
