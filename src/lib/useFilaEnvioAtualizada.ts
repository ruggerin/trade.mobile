import { useCallback, useEffect, useState } from 'react';
import {
  contarPendenciasEnvio,
  FILA_ENVIO_ATUALIZADA_EVENT,
  FILA_ENVIO_SERVIDOR_MUDOU_EVENT,
  filaEnvioEvents,
  ultimaTentativaEnvioEm,
} from './filaEnvio';

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

/**
 * Quantas visitas ainda têm algo pra mandar e quando foi a última tentativa — o promotor vê que
 * a visita está "Enviando…" em vez de achar que já foi (docs/51 Fase 3). Relê ao fim de cada
 * passada da fila.
 */
export function usePendenciasEnvio(usuarioId: string | undefined): { pendentes: number; ultimaTentativaEm: string | null } {
  const [estado, setEstado] = useState<{ pendentes: number; ultimaTentativaEm: string | null }>({ pendentes: 0, ultimaTentativaEm: null });

  const reler = useCallback(() => {
    if (!usuarioId) return;
    void contarPendenciasEnvio(usuarioId)
      .then((pendentes) => setEstado({ pendentes, ultimaTentativaEm: ultimaTentativaEnvioEm() }))
      .catch(() => {});
  }, [usuarioId]);

  useEffect(() => {
    reler();
  }, [reler]);
  useAoAtualizarFilaEnvio(reler);

  return estado;
}

/** Só quando a fila confirmou algo no servidor (check-in, registro ou checkout) — pra recarregar dado que vem de lá. */
export function useAoServidorMudarPelaFila(callback: () => void): void {
  useEffect(() => {
    filaEnvioEvents.addEventListener(FILA_ENVIO_SERVIDOR_MUDOU_EVENT, callback);
    return () => filaEnvioEvents.removeEventListener(FILA_ENVIO_SERVIDOR_MUDOU_EVENT, callback);
  }, [callback]);
}
