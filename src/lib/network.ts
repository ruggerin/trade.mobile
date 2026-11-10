import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { aoMudarQualidadeRede, redeEstaRuim, useRedeRuim } from './qualidadeRede';

/**
 * Vale tentar `processarFilaEnvio()`? Só desiste quando o aparelho diz que está SEM conexão
 * nenhuma (`isConnected === false`). O "internet alcançável" do NetInfo demora a atualizar depois
 * de trocar de wifi pra 4G no Android e fazia a passada imediata desistir sem tentar
 * (docs/51 §3.3) — agora quem decide é a própria chamada: se a rede não responder, o motor já
 * trata como erro passageiro e tenta de novo. Rede marcada como ruim pelo disjuntor
 * (lib/qualidadeRede.ts) também NÃO impede a tentativa: é a tentativa que vai mostrar que voltou.
 */
export async function estaOnline(): Promise<boolean> {
  const estado = await NetInfo.fetch();
  return estado.isConnected !== false;
}

/** Sem conexão nenhuma OU rede marcada como ruim pelo disjuntor (docs/108 §5.3). */
export async function semRedeUtil(): Promise<boolean> {
  if (redeEstaRuim()) return true;
  return !(await estaOnline());
}

/**
 * Dispara `callback` toda vez que o aparelho passa de offline pra online — inclusive quando a rede
 * sai do estado "ruim" do disjuntor (uma resposta rápida do servidor prova que voltou).
 */
export function aoReconectar(callback: () => void): () => void {
  let estavaOnline: boolean | null = null;

  const unsubscribe = NetInfo.addEventListener((estado) => {
    const online = Boolean(estado.isConnected && estado.isInternetReachable !== false);
    if (online && estavaOnline === false) {
      callback();
    }
    estavaOnline = online;
  });
  const pararQualidade = aoMudarQualidadeRede((ruim) => {
    if (!ruim) callback();
  });

  return () => {
    unsubscribe();
    pararQualidade();
  };
}

export function useEstaOnline(): boolean {
  const [online, setOnline] = useState(true);
  const ruim = useRedeRuim();

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((estado) => {
      setOnline(Boolean(estado.isConnected && estado.isInternetReachable !== false));
    });
    return unsubscribe;
  }, []);

  return online && !ruim;
}
