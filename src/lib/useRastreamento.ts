import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  adiarPermissaoRastreamento,
  definirRastreamentoLigado,
  sincronizarRastreamento,
  solicitarPermissaoEIniciar,
  type SituacaoRastreamento,
} from './rastreamento';

/**
 * Estado do rastreamento pra tela (MainTabs pra manter o rastreamento vivo, PerfilScreen pro
 * switch). Reavalia ao montar e sempre que o app volta de background — é o gatilho que religa o
 * rastreamento depois do auto-desligar de 12h, e que pega mudança do parâmetro da empresa.
 */
// `automatico`: só o MainTabs abre a tela de explicação sozinho ao entrar; o Perfil só reflete a
// situação e abre a explicação quando o promotor mexe no switch (senão os dois abririam juntos).
export function useRastreamento(habilitado: boolean, automatico = true) {
  const [situacao, setSituacao] = useState<SituacaoRastreamento | null>(null);
  const [explicando, setExplicando] = useState(false);
  const [pedindo, setPedindo] = useState(false);
  const appState = useRef(AppState.currentState);

  const reavaliar = useCallback(async (): Promise<SituacaoRastreamento | null> => {
    if (!habilitado) return null;
    try {
      const nova = await sincronizarRastreamento();
      setSituacao(nova);
      return nova;
    } catch {
      // Falha em ler parâmetro/permissão nunca pode derrubar a tela — só não atualiza a situação.
      return null;
    }
  }, [habilitado]);

  useEffect(() => {
    void reavaliar().then((nova) => {
      if (automatico && nova === 'PRECISA_PERMISSAO') setExplicando(true);
    });

    const subscription = AppState.addEventListener('change', (proximo: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && proximo === 'active') void reavaliar();
      appState.current = proximo;
    });
    return () => subscription.remove();
  }, [reavaliar, automatico]);

  async function permitir() {
    setPedindo(true);
    try {
      setSituacao(await solicitarPermissaoEIniciar());
    } finally {
      setPedindo(false);
      setExplicando(false);
    }
  }

  async function agoraNao() {
    await adiarPermissaoRastreamento();
    setSituacao('PERMISSAO_RECUSADA');
    setExplicando(false);
  }

  /** Switch do Perfil — ligar sem permissão ainda abre a tela de explicação. */
  async function alternar(ligado: boolean) {
    const nova = await definirRastreamentoLigado(ligado);
    setSituacao(nova);
    if (nova === 'PRECISA_PERMISSAO') setExplicando(true);
  }

  return { situacao, explicando, pedindo, permitir, agoraNao, alternar, reavaliar };
}
