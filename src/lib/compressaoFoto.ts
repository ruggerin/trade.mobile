import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/**
 * Foto reduzida logo na captura, antes de entrar na fila de envio. A câmera entrega a resolução
 * cheia do sensor (2–5 MB num celular atual mesmo com `quality: 0.7`); em rede lenta isso não
 * sobe dentro do timeout, recomeça do zero e trava a fila — o check-out vai junto. 1600 px no
 * lado maior ainda dá pra ler preço, validade e etiqueta de gôndola na auditoria; JPEG 0,6 fica
 * na faixa de 150–300 KB.
 */
export const LADO_MAXIMO_FOTO_PX = 1600;
export const QUALIDADE_FOTO = 0.6;

/** Novo tamanho mantendo a proporção, ou `null` quando a foto já cabe (não amplia). */
export function dimensoesReduzidas(largura: number, altura: number): { width: number } | { height: number } | null {
  if (!largura || !altura || Math.max(largura, altura) <= LADO_MAXIMO_FOTO_PX) return null;
  return largura >= altura ? { width: LADO_MAXIMO_FOTO_PX } : { height: LADO_MAXIMO_FOTO_PX };
}

/**
 * Devolve o caminho da foto comprimida. Se a compressão falhar por qualquer motivo, devolve a
 * original: foto grande demora pra subir, mas foto perdida é evidência de campo perdida.
 */
export async function comprimirFoto(foto: { uri: string; width: number; height: number }): Promise<string> {
  try {
    const contexto = ImageManipulator.manipulate(foto.uri);
    const reduzir = dimensoesReduzidas(foto.width, foto.height);
    if (reduzir) contexto.resize(reduzir);
    const imagem = await contexto.renderAsync();
    const salva = await imagem.saveAsync({ compress: QUALIDADE_FOTO, format: SaveFormat.JPEG });
    return salva.uri;
  } catch (err) {
    if (__DEV__) console.warn('[foto] compressão falhou, segue a original', err);
    return foto.uri;
  }
}
