import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

/**
 * Sinal de conectividade "de verdade" (rádio conectado E internet alcançável, não só wifi
 * associado sem internet) — usado pra decidir quando vale tentar `processarFilaEnvio()` e pra
 * mostrar "sem conexão" na UI sem depender de uma chamada de API falhar primeiro.
 */
export async function estaOnline(): Promise<boolean> {
  const estado = await NetInfo.fetch();
  return Boolean(estado.isConnected && estado.isInternetReachable !== false);
}

/** Dispara `callback` toda vez que o aparelho passa de offline pra online. */
export function aoReconectar(callback: () => void): () => void {
  let estavaOnline: boolean | null = null;

  const unsubscribe = NetInfo.addEventListener((estado) => {
    const online = Boolean(estado.isConnected && estado.isInternetReachable !== false);
    if (online && estavaOnline === false) {
      callback();
    }
    estavaOnline = online;
  });

  return unsubscribe;
}

export function useEstaOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((estado) => {
      setOnline(Boolean(estado.isConnected && estado.isInternetReachable !== false));
    });
    return unsubscribe;
  }, []);

  return online;
}
