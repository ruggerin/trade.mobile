import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';

type Recarregar = () => Promise<unknown>;

/**
 * As abas do bottom tab nunca são desmontadas — voltar pra uma aba não refaz a consulta sozinho,
 * então o que mudou no servidor (loja/pedido/planograma alterado no admin, visita sincronizada)
 * só aparecia reabrindo o app. Isto recarrega ao ganhar foco (pula o primeiro, que a própria
 * useQuery já busca ao montar) e devolve o estado pro "puxar pra atualizar" (RefreshControl).
 *
 * Voltar do SEGUNDO PLANO é outra coisa, coberta globalmente pelo focusManager em App.tsx.
 */
export function useRecarregarAoFocar(...recarregar: Recarregar[]): { atualizando: boolean; puxarParaAtualizar: () => void } {
  // Ref pra não recriar o efeito de foco a cada render (as funções refetch são estáveis, mas o
  // array de rest params é novo toda vez).
  const funcoes = useRef(recarregar);
  funcoes.current = recarregar;

  const primeiroFoco = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (primeiroFoco.current) {
        primeiroFoco.current = false;
        return;
      }
      for (const f of funcoes.current) void f();
    }, []),
  );

  const [atualizando, setAtualizando] = useState(false);
  const puxarParaAtualizar = useCallback(() => {
    setAtualizando(true);
    void Promise.allSettled(funcoes.current.map((f) => f())).finally(() => setAtualizando(false));
  }, []);

  return { atualizando, puxarParaAtualizar };
}
