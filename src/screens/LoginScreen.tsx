import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import axios from 'axios';
import { useAuth } from '../lib/auth/AuthContext';
import { credenciaisStorage } from '../lib/auth/credentialsStorage';

// docs/05-APP-MOBILE-UX.md §3.2 — campo e-mail, campo senha (toggle mostrar/ocultar), botão
// "Entrar", estados padrão/carregando/erro inline/sem conexão.
export function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [lembrar, setLembrar] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Pré-preenche se o promotor marcou "lembrar" numa sessão anterior — ver
  // lib/auth/credentialsStorage.ts. Só roda uma vez, ao montar a tela (ela só aparece de novo
  // depois de logout/sessão revogada, então não precisa reagir a mudanças depois disso).
  useEffect(() => {
    let cancelado = false;
    credenciaisStorage.get().then((salvas) => {
      if (cancelado || !salvas) return;
      setEmail(salvas.email);
      setSenha(salvas.senha);
      setLembrar(true);
    });
    return () => {
      cancelado = true;
    };
  }, []);

  async function handleEntrar() {
    if (!email.trim() || !senha) {
      setErro('Preencha e-mail e senha.');
      return;
    }

    setErro(null);
    setCarregando(true);

    try {
      await login(email.trim(), senha);
      // Só depois do login confirmar — nunca guarda uma senha que nem foi validada ainda.
      if (lembrar) {
        await credenciaisStorage.set({ email: email.trim(), senha });
      } else {
        await credenciaisStorage.clear();
      }
    } catch (err) {
      if (axios.isAxiosError<{ errors?: Record<string, string[]>; message?: string }>(err)) {
        if (!err.response) {
          setErro('Não foi possível conectar. Verifique sua internet e tente novamente.');
        } else {
          const primeiraMensagem = err.response.data.errors
            ? Object.values(err.response.data.errors)[0]?.[0]
            : err.response.data.message;
          setErro(primeiraMensagem ?? 'Credenciais inválidas.');
        }
      } else {
        setErro('Algo deu errado. Tente novamente.');
      }
    } finally {
      setCarregando(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.conteudo}>
        <Text style={styles.titulo}>PDV App</Text>
        <Text style={styles.subtitulo}>Entre com sua conta de promotor</Text>

        {erro && (
          <View style={styles.erroBox}>
            <Text style={styles.erroTexto}>{erro}</Text>
          </View>
        )}

        <Text style={styles.label}>E-mail</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          editable={!carregando}
          placeholder="voce@empresa.com.br"
          placeholderTextColor="#9ca3af"
        />

        <Text style={styles.label}>Senha</Text>
        <View style={styles.senhaContainer}>
          <TextInput
            style={styles.senhaInput}
            value={senha}
            onChangeText={setSenha}
            secureTextEntry={!mostrarSenha}
            editable={!carregando}
            placeholder="Sua senha"
            placeholderTextColor="#9ca3af"
          />
          <Pressable
            onPress={() => setMostrarSenha((v) => !v)}
            style={styles.toggleSenha}
            hitSlop={12}
          >
            <Text style={styles.toggleSenhaTexto}>{mostrarSenha ? 'Ocultar' : 'Mostrar'}</Text>
          </Pressable>
        </View>

        <Pressable
          style={styles.lembrarLinha}
          onPress={() => setLembrar((v) => !v)}
          disabled={carregando}
          hitSlop={8}
        >
          <View style={[styles.checkbox, lembrar && styles.checkboxMarcado]}>
            {lembrar && <Text style={styles.checkboxMarca}>✓</Text>}
          </View>
          <Text style={styles.lembrarTexto}>Lembrar e-mail e senha</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.botao, (carregando || pressed) && styles.botaoPressionado]}
          onPress={() => void handleEntrar()}
          disabled={carregando}
        >
          {carregando ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.botaoTexto}>Entrar</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  conteudo: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  titulo: {
    fontSize: 32,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  subtitulo: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 32,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#111827',
    minHeight: 48,
  },
  senhaContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    minHeight: 48,
  },
  senhaInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#111827',
  },
  toggleSenha: {
    paddingHorizontal: 16,
    minHeight: 48,
    justifyContent: 'center',
  },
  toggleSenhaTexto: {
    color: '#2563eb',
    fontWeight: '600',
    fontSize: 14,
  },
  lembrarLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  checkboxMarcado: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  checkboxMarca: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  lembrarTexto: {
    fontSize: 14,
    color: '#374151',
  },
  botao: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
  },
  botaoPressionado: {
    opacity: 0.8,
  },
  botaoTexto: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  erroBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  erroTexto: {
    color: '#b91c1c',
    fontSize: 14,
  },
});
