import * as Updates from 'expo-updates';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/**
 * Atualização OTA (docs/107 §4.5). Regra: NUNCA recarregar sozinho — um `reloadAsync` no meio de um
 * check-in ou de um formulário faz o promotor perder o contexto. O update baixa em segundo plano e
 * entra no próximo cold start.
 *
 * O `checkAutomatically: ON_LOAD` do app.json só verifica ao abrir do zero, e o Horus pode ficar dias
 * vivo por causa do rastreamento em segundo plano; por isso o hook também verifica ao voltar pro
 * primeiro plano, respeitando um intervalo mínimo (o Expo limita a frequência de verificações).
 */
export const INTERVALO_MINIMO_VERIFICACAO_MS = 60 * 60 * 1000;

/** Updates só existem em build de release com `updates.url`; Expo Go e dev client rejeitam as chamadas. */
export function atualizacaoDisponivelNoBuild(): boolean {
  return !__DEV__ && Updates.isEnabled;
}

export async function baixarAtualizacaoSeHouver(): Promise<boolean> {
  try {
    const { isAvailable } = await Updates.checkForUpdateAsync();
    if (!isAvailable) return false;
    const resultado = await Updates.fetchUpdateAsync();
    return resultado.isNew;
  } catch {
    // Sem internet ou limite de verificações: tenta na próxima volta ao app.
    return false;
  }
}

export function useBaixarAtualizacao(): void {
  // Começa "agora": o ON_LOAD já verificou na abertura; a primeira volta do segundo plano só confere
  // de novo depois do intervalo.
  const ultimaVerificacao = useRef(Date.now());

  useEffect(() => {
    if (!atualizacaoDisponivelNoBuild()) return;

    const assinatura = AppState.addEventListener('change', (estado) => {
      if (estado !== 'active') return;
      if (Date.now() - ultimaVerificacao.current < INTERVALO_MINIMO_VERIFICACAO_MS) return;
      ultimaVerificacao.current = Date.now();
      void baixarAtualizacaoSeHouver();
    });

    return () => assinatura.remove();
  }, []);
}

/**
 * Identificação do código em execução, pro suporte (docs/107 §4.6): 8 primeiros caracteres do id do
 * update, "embutido" quando é o bundle do próprio APK, ou nada no Expo Go / dev.
 */
export function identificacaoDoUpdate(): string | null {
  if (!Updates.isEnabled) return null;
  if (Updates.isEmbeddedLaunch || !Updates.updateId) return 'embutido';
  return Updates.updateId.slice(0, 8);
}
