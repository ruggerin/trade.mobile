import { MaterialCommunityIcons } from '@expo/vector-icons';
import { neutro } from '../theme';

/**
 * Ícone de `TipoRegistro.icone` — slug do Material Design Icons (pictogrammers.com/library/mdi,
 * sem prefixo "mdi-"), renderizado via `MaterialCommunityIcons` (`@expo/vector-icons`, glifos
 * embutidos no app, sem pedir rede). O mesmo slug é o que o admin mostra via `@mdi/font` — ver
 * admin/src/components/MdiIcon.tsx. Confere contra `glyphMap` antes de renderizar: um código
 * digitado errado no admin não quebra o app, só não desenha nada (mesmo espírito do lado admin).
 */
export function IconeTipoRegistro({
  icone,
  size = 22,
  color = neutro[700],
}: {
  icone: string | null | undefined;
  size?: number;
  color?: string;
}) {
  if (!icone || !(icone in MaterialCommunityIcons.glyphMap)) {
    return null;
  }

  return <MaterialCommunityIcons name={icone as keyof typeof MaterialCommunityIcons.glyphMap} size={size} color={color} />;
}
