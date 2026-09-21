import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { cores, espaco, raio, tipografia } from '../theme';

// Cobre a janela entre abrir o app e saber se há sessão salva válida (leitura assíncrona do
// SecureStore + confirmação via /auth/me) — ver docs/05-APP-MOBILE-UX.md §3.1. Sem interação.
export function SplashScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.logoBadge}>
        <MaterialCommunityIcons name="storefront" size={36} color={cores.primaria} />
      </View>
      <Text style={styles.titulo}>PDV App</Text>
      <ActivityIndicator size="large" color={cores.primaria} style={styles.spinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cores.fundoCard,
  },
  logoBadge: {
    width: 72,
    height: 72,
    borderRadius: raio.lg,
    backgroundColor: cores.primariaClara,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: espaco.lg,
  },
  titulo: {
    ...tipografia.tituloGrande,
    fontSize: 26,
    color: cores.texto,
    marginBottom: espaco.lg,
  },
  spinner: {
    marginTop: espaco.xs,
  },
});
