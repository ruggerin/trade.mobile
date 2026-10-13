import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { cores, espaco } from '../theme';

// Cobre a janela entre abrir o app e saber se há sessão salva válida (leitura assíncrona do
// SecureStore + confirmação via /auth/me) — ver docs/05-APP-MOBILE-UX.md §3.1. Sem interação.
export function SplashScreen() {
  return (
    <View style={styles.container}>
      <Image
        source={require('../../assets/horus-logo.png')}
        style={styles.logo}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel="Horus"
      />
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
  // Logo horizontal oficial da marca (assets/horus-logo.png, proporção 1600 x 428).
  logo: {
    width: 200,
    height: 54,
    marginBottom: espaco.xl,
  },
  spinner: {
    marginTop: espaco.xs,
  },
});
