import * as Application from 'expo-application';
import Constants, { ExecutionEnvironment } from 'expo-constants';

// Versão do app pra identificar problema de integração no piloto: o `version` do app.json
// (sobe à mão a cada leva — 1.MINOR.PATCH) mais o número do build, que o EAS incrementa sozinho.
// No Expo Go o build nativo é o do próprio Expo Go, então não mostra.

export const VERSAO_APP = Constants.expoConfig?.version ?? '0.0.0';

const noExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
export const BUILD_APP: string | null = noExpoGo ? null : (Application.nativeBuildVersion ?? null);

/** "Horus 1.1.0 (build 12)" — login e Perfil. */
export function textoVersaoApp(): string {
  return `Horus ${VERSAO_APP}${BUILD_APP ? ` (build ${BUILD_APP})` : noExpoGo ? ' (Expo Go)' : ''}`;
}

// Última versão da API vista no cabeçalho X-Api-Version (gravada pelo apiClient a cada resposta):
// o Perfil mostra mesmo sem sinal, com a da última conversa com o servidor.
let ultimaVersaoApi: string | null = null;

export function registrarVersaoApi(valor: string | undefined | null): void {
  if (valor) ultimaVersaoApi = valor;
}

export function obterUltimaVersaoApi(): string | null {
  return ultimaVersaoApi;
}
