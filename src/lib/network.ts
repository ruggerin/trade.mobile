import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

/**
 * Vale tentar `processarFilaEnvio()`? Só desiste quando o aparelho diz que está SEM conexão
 * nenhuma (`isConnected === false`). O "internet alcançável" do NetInfo demora a atualizar depois
 * de trocar de wifi pra 4G no Android e fazia a passada imediata desistir sem tentar
 * (docs/51 §3.3) — agora quem decide é a própria chamada: se a rede não responder, o motor já
 * trata como erro passageiro e tenta de novo.
 */
export async function estaOnline(): Promise<boolean> {
  const estado = await NetInfo.fetch();
  return estado.isConnected !== false;
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
