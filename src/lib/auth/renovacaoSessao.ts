import axios from 'axios';
import { refresh } from '../api/auth';
import { tokenStorage } from './tokenStorage';

// O token do app vence em 7 dias (docs/67 §4.4). Renova quando passa de 1 dia, na abertura do
// app e na volta do segundo plano — quem usa o app pelo menos uma vez por semana nunca precisa
// logar de novo. Promotor que fica mais de 7 dias sem abrir o app faz login de novo (a fila
// offline não se perde: ela não é apagada quando a sessão cai).
const RENOVAR_APOS_MS = 24 * 60 * 60 * 1000;

let emAndamento: Promise<void> | null = null;

async function renovar(): Promise<void> {
  const token = await tokenStorage.get();
  if (!token) return;

  const emitidoEm = await tokenStorage.emitidoEm();
  // Token sem data é de antes da docs/67 (legado) — renova já, pra ganhar a validade nova.
  if (emitidoEm !== null && Date.now() - emitidoEm < RENOVAR_APOS_MS) return;

  try {
    const { token: novo } = await refresh();
    await tokenStorage.set(novo);
  } catch (err) {
    // Sem rede: tenta de novo na próxima abertura. 401 já é tratado pelo interceptor do
    // apiClient (limpa a sessão e volta pro login). 403 = token do admin web, não se aplica.
    if (__DEV__ && axios.isAxiosError(err)) console.log('[sessao] refresh falhou', err.response?.status ?? err.code);
  }
}

/** Renova o token se ele já tem mais de 1 dia. Chamadas simultâneas compartilham a mesma renovação. */
export function renovarSessaoSeNecessario(): Promise<void> {
  emAndamento ??= renovar().finally(() => {
    emAndamento = null;
  });
  return emAndamento;
}
