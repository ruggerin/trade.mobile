import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { SeloEnvio, TipoSeloEnvio } from '../lib/statusEnvioVisita';
import { amber, cores, espaco, indigo, verde, vermelho } from '../theme';

// docs/110 — mesma linguagem do mockup: âmbar = guardada no celular, índigo = enviando/aberta,
// verde = confirmada, vermelho = precisa de ação.
const CORES: Record<TipoSeloEnvio, string> = {
  SALVA: amber[700],
  ENVIANDO: indigo[600],
  EM_ANDAMENTO: indigo[600],
  ENVIADA: verde[700],
  NAO_ENVIADA: vermelho[600],
};

export function SeloEnvioVisita({ selo, comDetalhe = true }: { selo: SeloEnvio; comDetalhe?: boolean }) {
  const cor = CORES[selo.tipo];
  return (
    <View style={styles.coluna}>
      <View style={[styles.badge, { backgroundColor: `${cor}1A`, borderColor: cor }]}>
        {selo.tipo === 'ENVIANDO' && <ActivityIndicator size="small" color={cor} style={styles.giro} />}
        <Text style={[styles.texto, { color: cor }]}>{selo.rotulo}</Text>
      </View>
      {comDetalhe && !!selo.detalhe && <Text style={styles.detalhe}>{selo.detalhe}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  coluna: { gap: 4, flexShrink: 1 },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: espaco.sm,
    paddingVertical: 2,
  },
  giro: { transform: [{ scale: 0.7 }], width: 12, height: 12 },
  texto: { fontSize: 12, fontWeight: '700' },
  detalhe: { fontSize: 12, color: cores.textoSecundario, lineHeight: 16 },
});
