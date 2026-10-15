import { useEffect } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../lib/auth/AuthContext';
import { cores, espaco, raio, tipografia } from '../theme';

// Telas que seguram o app antes das abas (docs/67): versão abaixo da mínima (426) e sessão
// esperando a biometria do aparelho.

export function AtualizarAppScreen() {
  return (
    <View style={styles.container}>
      <Image source={require('../../assets/horus-logo.png')} style={styles.logo} resizeMode="contain" />
      <Text style={styles.titulo}>Atualize o Horus</Text>
      <Text style={styles.texto}>
        Esta versão do app não é mais aceita. Atualize pela loja de aplicativos (ou peça o link ao seu gestor) para
        continuar.
      </Text>
    </View>
  );
}

export function DesbloqueioScreen() {
  const { desbloquearComBiometria, logout } = useAuth();

  useEffect(() => {
    void desbloquearComBiometria();
    // Só pede uma vez ao abrir; depois o botão tenta de novo.
  }, []);

  return (
    <View style={styles.container}>
      <Image source={require('../../assets/horus-logo.png')} style={styles.logo} resizeMode="contain" />
      <Text style={styles.titulo}>App bloqueado</Text>
      <Text style={styles.texto}>Use sua biometria para continuar.</Text>
      <Pressable style={({ pressed }) => [styles.botao, pressed && styles.pressionado]} onPress={() => void desbloquearComBiometria()}>
        <Text style={styles.botaoTexto}>Usar biometria</Text>
      </Pressable>
      <Pressable style={styles.link} onPress={() => void logout()} hitSlop={8}>
        <Text style={styles.linkTexto}>Entrar com e-mail e senha</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: cores.fundoCard,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: espaco.xl,
  },
  logo: {
    width: 180,
    height: 48,
    marginBottom: espaco.xl,
  },
  titulo: {
    fontSize: 20,
    fontWeight: '700',
    color: cores.texto,
    marginBottom: espaco.sm,
    textAlign: 'center',
  },
  texto: {
    fontSize: 15,
    color: cores.textoSecundario,
    textAlign: 'center',
    marginBottom: espaco.xl,
  },
  botao: {
    backgroundColor: cores.primaria,
    borderRadius: raio.md,
    minHeight: 52,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressionado: {
    opacity: 0.85,
  },
  botaoTexto: {
    ...tipografia.botao,
    color: cores.onPrimaria,
    fontSize: 17,
  },
  link: {
    marginTop: espaco.lg,
  },
  linkTexto: {
    color: cores.primaria,
    fontWeight: '600',
    fontSize: 14,
  },
});
