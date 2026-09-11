import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

// Cobre a janela entre abrir o app e saber se há sessão salva válida (leitura assíncrona do
// SecureStore + confirmação via /auth/me) — ver docs/05-APP-MOBILE-UX.md §3.1. Sem interação.
export function SplashScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.titulo}>PDV App</Text>
      <ActivityIndicator size="large" color="#2563eb" style={styles.spinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  titulo: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 24,
  },
  spinner: {
    marginTop: 8,
  },
});
