import { useEffect } from 'react';
import { FILA_ENVIO_ATUALIZADA_EVENT, filaEnvioEvents } from './filaEnvio';

/**
 * Assina o evento disparado ao fim de toda passada do motor de sincronização (mesmo padrão de
 * `authEvents` em lib/api/client.ts) — usado pelas telas que mostram estado da fila local
 * (visita em andamento, banner de "aguardando envio", histórico) pra saber quando reler o
 * SQLite, sem precisar de polling.
 */
export function useAoAtualizarFilaEnvio(callback: () => void): void {
  useEffect(() => {
    filaEnvioEvents.addEventListener(FILA_ENVIO_ATUALIZADA_EVENT, callback);
    return () => filaEnvioEvents.removeEventListener(FILA_ENVIO_ATUALIZADA_EVENT, callback);
  }, [callback]);
}
