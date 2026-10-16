import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useContext } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Espaço do rodapé fixo de uma tela em relação à borda de baixo do aparelho. Dentro das abas, a
 * barra de abas já soma a área segura (MainTabs: `height: 56 + insets.bottom`) — somar de novo
 * no rodapé da tela deixava uma faixa vazia, grande em celular com barra de 3 botões (achado no
 * Moto g34). Fora das abas (modal, tela cheia), a área segura vale normalmente.
 */
export function useEspacoInferior(): number {
  const insets = useSafeAreaInsets();
  const alturaDasAbas = useContext(BottomTabBarHeightContext);
  return alturaDasAbas === undefined ? insets.bottom : 0;
}
