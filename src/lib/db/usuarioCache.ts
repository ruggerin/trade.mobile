import type { Usuario } from '../../types/api';
import { getDatabase } from './database';

// Cópia do usuário logado (resposta do login e do /auth/me) — sem ela, abrir o app sem sinal com a
// sessão válida caía no Login (o /auth/me falhava e o app achava que não havia ninguém logado).
// Uma linha só; apagada no logout e quando a sessão cai (limparCacheLocal).

export async function salvarUsuarioCache(usuario: Usuario): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('INSERT OR REPLACE INTO usuario_sessao (id, json, atualizado_em) VALUES (1, ?, ?)', [
    JSON.stringify(usuario),
    new Date().toISOString(),
  ]);
}

export async function lerUsuarioCache(): Promise<Usuario | null> {
  const db = await getDatabase();
  const linha = await db.getFirstAsync<{ json: string }>('SELECT json FROM usuario_sessao WHERE id = 1');
  if (!linha) return null;
  try {
    return JSON.parse(linha.json) as Usuario;
  } catch {
    return null;
  }
}
