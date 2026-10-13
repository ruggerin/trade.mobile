import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { ExigenciaRastreamento } from './api/parametros';
import {
  adiarPermissaoRastreamento,
  definirRastreamentoLigado,
  resolverRastreamento,
  sincronizarRastreamento,
  situacaoRegular,
  solicitarPermissaoEIniciar,
  type EstadoRastreamento,
  type SituacaoRastreamento,
} from './rastreamento';
import { buscarVisitaEmAndamento } from './visitaLocal';

// Nas exigências AVISO/OBRIGATÓRIO, reavalia de tempos em tempos com o app aberto — o promotor
// pode desligar o GPS pela barra de notificações sem o app ir pra background.
const REAVALIAR_EXIGENTE_MS = 30_000;

/**
 * Estado do rastreamento pra tela (MainTabs pra manter o rastreamento vivo e mostrar aviso/
 * bloqueio, PerfilScreen pro switch). Reavalia ao montar e sempre que o app volta de background —
 * é o gatilho que religa o rastreamento depois do auto-desligar de 12h, e que pega mudança do
 * parâmetro da empresa ou da permissão feita nas configurações do aparelho.
 *
 * docs/47-RASTREAMENTO-EXIGENCIA.md: `bloquear` (OBRIGATÓRIO, irregular, sem visita em andamento)
 * e `avisar` (AVISO irregular, ou OBRIGATÓRIO irregular com visita em andamento — deixa terminar a
 * visita, decisão 2 do §7) já vêm calculados.
 */
// `automatico`: só o MainTabs abre a tela de explicação sozinho ao entrar; o Perfil só reflete a
// situação e abre a explicação quando o promotor mexe no switch (senão os dois abririam juntos).
export function useRastreamento(habilitado: boolean, automatico = true, usuarioId?: string) {
  const [estado, setEstado] = useState<EstadoRastreamento | null>(null);
  const [visitaEmAndamento, setVisitaEmAndamento] = useState(false);
  const [explicando, setExplicando] = useState(false);
  const [pedindo, setPedindo] = useState(false);
  const [resolvendo, setResolvendo] = useState(false);
  const appState = useRef(AppState.currentState);

  const reavaliar = useCallback(async (): Promise<EstadoRastreamento | null> => {
    if (!habilitado) return null;
    try {
      const [novo, visita] = await Promise.all([
        sincronizarRastreamento(),
        usuarioId ? buscarVisitaEmAndamento(usuarioId).catch(() => null) : Promise.resolve(null),
      ]);
      setEstado(novo);
      setVisitaEmAndamento(!!visita);
      return novo;
    } catch {
      // Falha em ler parâmetro/permissão nunca pode derrubar a tela — só não atualiza a situação.
      return null;
    }
  }, [habilitado, usuarioId]);

  useEffect(() => {
    void reavaliar().then((novo) => {
      if (automatico && novo?.situacao === 'PRECISA_PERMISSAO') setExplicando(true);
    });

    const subscription = AppState.addEventListener('change', (proximo: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && proximo === 'active') void reavaliar();
      appState.current = proximo;
    });
    return () => subscription.remove();
  }, [reavaliar, automatico]);

  const exigente = estado !== null && estado.exigencia !== 'OPCIONAL';
  useEffect(() => {
    if (!exigente) return;
    const id = setInterval(() => {
      if (AppState.currentState === 'active') void reavaliar();
    }, REAVALIAR_EXIGENTE_MS);
    return () => clearInterval(id);
  }, [exigente, reavaliar]);

  async function permitir() {
    setPedindo(true);
    try {
      setEstado(await solicitarPermissaoEIniciar());
    } finally {
      setPedindo(false);
      setExplicando(false);
    }
  }

  async function agoraNao() {
    await adiarPermissaoRastreamento();
    setExplicando(false);
    await reavaliar();
  }

  /** Switch do Perfil (só na exigência OPCIONAL) — ligar sem permissão ainda abre a explicação. */
  async function alternar(ligado: boolean) {
    const novo = await definirRastreamentoLigado(ligado);
    setEstado(novo);
    if (novo.situacao === 'PRECISA_PERMISSAO') setExplicando(true);
  }

  /** Botão "Resolver" da faixa de aviso / tela de bloqueio. */
  async function resolver() {
    if (!estado) return;
    setResolvendo(true);
    try {
      setEstado(await resolverRastreamento(estado.situacao));
    } finally {
      setResolvendo(false);
    }
  }

  const situacao: SituacaoRastreamento | null = estado?.situacao ?? null;
  const exigencia: ExigenciaRastreamento = estado?.exigencia ?? 'OPCIONAL';
  const irregular = situacao !== null && !situacaoRegular(situacao);
  const bloquear = irregular && exigencia === 'OBRIGATORIO' && !visitaEmAndamento;
  const avisar = irregular && (exigencia === 'AVISO' || (exigencia === 'OBRIGATORIO' && visitaEmAndamento));

  return {
    situacao,
    exigencia,
    detalhe: estado?.detalhe ?? null,
    irregular,
    bloquear,
    avisar,
    visitaEmAndamento,
    explicando,
    pedindo,
    resolvendo,
    permitir,
    agoraNao,
    alternar,
    resolver,
    reavaliar,
  };
}
