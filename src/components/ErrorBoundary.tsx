import { Component, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface Props {
  children: ReactNode;
}

interface State {
  temErro: boolean;
}

// docs/05-APP-MOBILE-UX.md §3.9 — "Erro genérico inesperado: tela de fallback amigável, nunca
// uma tela em branco ou crash visível pro usuário". Só React error boundary cobre isso (erro
// de render não tratado) — precisa ser classe, hooks não suportam getDerivedStateFromError.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { temErro: false };

  static getDerivedStateFromError(): State {
    return { temErro: true };
  }

  render() {
    if (this.state.temErro) {
      return (
        <View style={styles.container}>
          <Text style={styles.titulo}>Ops, algo deu errado</Text>
          <Text style={styles.texto}>
            Tivemos um problema inesperado. Feche e abra o app de novo — se continuar
            acontecendo, avise o suporte.
          </Text>
          <Pressable style={styles.botao} onPress={() => this.setState({ temErro: false })}>
            <Text style={styles.botaoTexto}>Tentar novamente</Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: '#ffffff',
  },
  titulo: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  texto: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  botao: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingHorizontal: 24,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoTexto: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
