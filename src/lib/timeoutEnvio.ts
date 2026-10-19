import * as FileSystem from 'expo-file-system/legacy';

/**
 * Timeout de envio proporcional ao tamanho, em vez de 90 s fixos pra tudo: uma foto grande em
 * rede lenta precisa de mais tempo do que isso (estourava, recomeçava do zero e travava a fila),
 * e um envio pequeno pendurado não deveria segurar a fila por 90 s até ser dado como falho.
 * Conta com o pior caso razoável de rede móvel (~8 KB/s de subida, EDGE/3G fraco).
 */
export const TIMEOUT_ENVIO_BASE_MS = 20_000;
export const TIMEOUT_ENVIO_MAXIMO_MS = 180_000;
const BYTES_POR_SEGUNDO_PIOR_CASO = 8 * 1024;

export function timeoutDeEnvio(bytes: number): number {
  const transferencia = (Math.max(0, bytes) / BYTES_POR_SEGUNDO_PIOR_CASO) * 1000;
  return Math.min(TIMEOUT_ENVIO_MAXIMO_MS, Math.round(TIMEOUT_ENVIO_BASE_MS + transferencia));
}

/** Tamanho do arquivo local em bytes (0 se não der pra ler — o timeout cai pro mínimo). */
export async function tamanhoDoArquivo(uri: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && 'size' in info ? (info.size ?? 0) : 0;
  } catch {
    return 0;
  }
}
