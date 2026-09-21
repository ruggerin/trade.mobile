import type { TextStyle } from 'react-native';

/**
 * Escala tipográfica única — pesos e letter-spacing ajustados pra dar um ar mais "editado" que o
 * default do sistema (títulos com peso mais alto e leve aperto de espaçamento, corpo neutro).
 * Cada tela ainda escreve o próprio StyleSheet (cor, margem etc.) — isso aqui só fixa tamanho,
 * peso e espaçamento em um único lugar pra não divergir tela a tela.
 */
export const tipografia = {
  tituloGrande: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 } as TextStyle,
  titulo: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3 } as TextStyle,
  subtitulo: { fontSize: 17, fontWeight: '700', letterSpacing: -0.1 } as TextStyle,
  destaque: { fontSize: 15, fontWeight: '700' } as TextStyle,
  corpo: { fontSize: 15, fontWeight: '400' } as TextStyle,
  corpoSecundario: { fontSize: 13, fontWeight: '400' } as TextStyle,
  legenda: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2 } as TextStyle,
  rotulo: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' } as TextStyle,
  botao: { fontSize: 15, fontWeight: '700', letterSpacing: 0.1 } as TextStyle,
};
