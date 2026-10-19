import { ehErroDeRede } from './db/database';

/**
 * Quanto a tela espera a rede antes de usar o que já está no aparelho. Sem sinal o erro vem na
 * hora e o cache já entrava; o caso ruim é a rede LENTA: a chamada não falha, só demora, e a tela
 * ficava girando até o timeout do client (8 s) com o dado ali no SQLite. Mesmo princípio do
 * `networkTimeoutSeconds` do NetworkFirst do Workbox.
 */
export const PRAZO_REDE_COM_CACHE_MS = 2500;

interface Opcoes<T> {
  /** Chamada à API. */
  rede: () => Promise<T>;
  /** Grava a resposta no cache (best-effort — falha aqui nunca derruba a tela). */
  salvar?: (dados: T) => Promise<void>;
  /** Lê o cache; `null` quando nunca sincronizou. */
  lerCache: () => Promise<T | null>;
  prazoMs?: number;
}

// Lista vazia no cache não serve pra responder antes da rede: pode ser "nunca sincronizou", e
// mostrar vazio enquanto a rede ainda traz os dados faria o promotor achar que não há nada.
function temDados<T>(cache: T | null): cache is T {
  return cache !== null && !(Array.isArray(cache) && cache.length === 0);
}

/**
 * Rede primeiro, com prazo: responde com a rede se ela chegar dentro do prazo; se não, com o
 * cache (quando há dado), e a chamada segue em segundo plano — quando chega, atualiza o cache pra
 * próxima vez. Sem rede nenhuma, cai pro cache como sempre; erro do servidor (4xx/5xx com
 * resposta) é repassado, nunca escondido atrás de dado antigo.
 */
export async function redeComPrazo<T>({ rede, salvar, lerCache, prazoMs = PRAZO_REDE_COM_CACHE_MS }: Opcoes<T>): Promise<T> {
  const chamada = rede().then((dados) => {
    if (salvar) void salvar(dados).catch(() => {});
    return dados;
  });
  // Quem responder pelo cache abandona a chamada: o erro dela não pode virar rejeição sem handler.
  chamada.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<'prazo'>((resolve) => {
    timer = setTimeout(() => resolve('prazo'), prazoMs);
  });

  try {
    const primeiro = await Promise.race([chamada, prazo]);
    if (primeiro !== 'prazo') return primeiro;

    const cache = await lerCache();
    if (temDados(cache)) return cache;
    return await chamada;
  } catch (err) {
    if (!ehErroDeRede(err)) throw err;
    const cache = await lerCache();
    if (cache === null) throw err;
    return cache;
  } finally {
    clearTimeout(timer);
  }
}
