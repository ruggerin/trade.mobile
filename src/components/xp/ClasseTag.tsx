import { StyleSheet, Text, View } from 'react-native';
import { neutro, raio } from '../../theme';
import type { ClasseLoja } from '../../types/api';
import { IconeTipoRegistro } from '../IconeTipoRegistro';

// Classe da loja na régua de XP (docs/88 §4): ícone e cor do cadastro do gestor.
export function ClasseTag({ classe, xp }: { classe: ClasseLoja | null | undefined; xp?: number | null }) {
  if (!classe && xp == null) return null;
  const cor = classe?.cor ?? neutro[500];
  return (
    <View style={[styles.tag, { borderColor: cor }]}>
      {classe?.icone ? <IconeTipoRegistro icone={classe.icone} size={13} color={cor} /> : null}
      <Text style={[styles.texto, { color: cor }]} numberOfLines={1}>
        {[classe?.nome, xp != null ? `${xp.toLocaleString('pt-BR')} XP` : null].filter(Boolean).join(' · ')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: raio.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  texto: { fontSize: 11, fontWeight: '700' },
});
