import type { ViewStyle } from 'react-native';
import { neutro } from './cores';

/** Raio de borda único — quanto maior o elemento, maior o raio (mesma lógica do admin web). */
export const raio = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
};

export const espaco = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

/** Sombra suave padrão pra cards elevados — discreta o bastante pra não brigar com a borda 1px. */
export const sombraCard: ViewStyle = {
  shadowColor: neutro[900],
  shadowOpacity: 0.06,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 },
  elevation: 2,
};

export const sombraFlutuante: ViewStyle = {
  shadowColor: neutro[900],
  shadowOpacity: 0.15,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 6,
};
