import { addSslPinningErrorListener, initializeSslPinning, isSslPinningAvailable } from 'react-native-ssl-public-key-pinning';

// Certificate pinning do domínio da API (docs/67 Fase 3): o app só aceita o servidor cujo
// certificado tem uma das chaves públicas conhecidas — proxy no meio (mitmproxy, Charles) não lê
// nem forja as chamadas mesmo com um certificado instalado no celular.
//
// Liga só quando EXPO_PUBLIC_PINNING_HASHES está no build (SHA-256 base64 do SPKI, separados por
// vírgula — no mínimo 2: o atual e um reserva, exigência do iOS) e o módulo nativo existe (não
// existe no Expo Go). Trocar o certificado do servidor por uma chave fora da lista derruba o app em
// campo: sempre publique o reserva antes de trocar. EXPO_PUBLIC_PINNING_EXPIRA (aaaa-mm-dd) desliga
// o pinning sozinho nessa data, pra quem não atualizar o app.
export async function iniciarPinning(): Promise<void> {
  const hashes = (process.env.EXPO_PUBLIC_PINNING_HASHES ?? '').split(',').map((h: string) => h.trim()).filter(Boolean);
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  const dominio = apiUrl.replace(/^https?:\/\//, '').split(/[/:]/)[0];

  if (hashes.length < 2 || !dominio || !apiUrl.startsWith('https://') || !isSslPinningAvailable()) {
    return;
  }

  await initializeSslPinning({
    [dominio]: {
      publicKeyHashes: hashes,
      expirationDate: process.env.EXPO_PUBLIC_PINNING_EXPIRA || undefined,
    },
  });

  if (__DEV__) {
    addSslPinningErrorListener((erro) => console.log('[pinning] recusado', erro.serverHostname, erro.message));
  }
}
