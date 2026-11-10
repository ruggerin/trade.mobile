import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../lib/auth/AuthContext';
import { useEstaOnline } from '../lib/network';
import { amber, espaco } from '../theme';

/**
 * Faixa fixa no topo das abas (docs/108 §5.5): "entrou sem internet" enquanto o servidor não
 * confirma a sessão, e "sem internet"/"internet lenta" quando o aparelho está sem sinal ou o
 * disjuntor de rede marcou a conexão como ruim (lib/qualidadeRede.ts). Some sozinha quando a rede
 * volta — a fila de envio e a revalidação da sessão rodam por conta própria.
 */
export function FaixaModoOffline() {
  const { modoOffline } = useAuth();
  const online = useEstaOnline();

  if (!modoOffline && online) return null;

  const texto = modoOffline
    ? online
      ? 'Você entrou sem internet. Confirmando sua sessão…'
      : 'Você entrou sem internet. Os envios ficam na fila e saem quando a conexão voltar.'
    : 'Sem internet ou conexão lenta. Você pode continuar: tudo fica guardado e é enviado depois.';

  return (
    <View style={styles.faixa} accessibilityRole="alert">
      <MaterialCommunityIcons name="cloud-off-outline" size={18} color={amber[800]} />
      <Text style={styles.texto}>{texto}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  faixa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm,
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.sm,
    backgroundColor: amber[50],
    borderBottomWidth: 1,
    borderBottomColor: amber[200],
  },
  texto: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: amber[800],
  },
});
