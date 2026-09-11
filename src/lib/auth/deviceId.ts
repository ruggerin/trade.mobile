import * as SecureStore from 'expo-secure-store';

// Trava de 1 dispositivo por PROMOTOR (docs/02-API-BACKEND.md) — o backend exige
// dispositivo_identificador no login. Gerado uma única vez e persistido: não precisa ser
// criptograficamente forte, só estável e único por instalação do app.
const DEVICE_ID_KEY = 'pdv_mobile_device_id';

function gerarId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function obterDeviceId(): Promise<string> {
  const existente = await SecureStore.getItemAsync(DEVICE_ID_KEY);

  if (existente) {
    return existente;
  }

  const novo = gerarId();
  await SecureStore.setItemAsync(DEVICE_ID_KEY, novo);
  return novo;
}
