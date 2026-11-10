import * as Application from 'expo-application';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { identificacaoDoUpdate } from './atualizacao';

// Versão do app pra identificar problema de integração no piloto: o `version` do app.json
// (sobe à mão a cada leva — 1.MINOR.PATCH) mais o número do build, que o EAS incrementa sozinho.
// No Expo Go o build nativo é o do próprio Expo Go, então não mostra.

export const VERSAO_APP = Constants.expoConfig?.version ?? '0.0.0';

const noExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
export const BUILD_APP: string | null = noExpoGo ? null : (Application.nativeBuildVersion ?? null);

/**
 * "Horus 1.3.1 (build 12 · update a1b2c3d4)" — login e Perfil. Com OTA (docs/107), o `version` acompanha
 * o update em execução (vem do manifesto), e o build é o do APK; o id do update diz ao suporte qual
 * JS está rodando de verdade ("embutido" = o bundle do próprio APK).
 */
export function textoVersaoApp(): string {
  const update = identificacaoDoUpdate();
  const detalhes = [BUILD_APP ? `build ${BUILD_APP}` : null, update ? `update ${update}` : null].filter(Boolean);
  if (detalhes.length === 0) return `Horus ${VERSAO_APP}${noExpoGo ? '' : ' (Expo Go)'}`;
  return `Horus ${VERSAO_APP} (${detalhes.join(' · ')})`;
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
