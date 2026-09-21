import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { cores, espaco, raio, sombraFlutuante, tipografia } from '../theme';

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
        <View style={styles.logoBadge}>
          <MaterialCommunityIcons name="storefront" size={32} color={cores.primaria} />
        </View>
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
          placeholderTextColor={cores.textoTerciario}
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
            placeholderTextColor={cores.textoTerciario}
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
            <ActivityIndicator color={cores.onPrimaria} />
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
    backgroundColor: cores.fundoCard,
  },
  conteudo: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: espaco.xl,
  },
  logoBadge: {
    width: 64,
    height: 64,
    borderRadius: raio.lg,
    backgroundColor: cores.primariaClara,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: espaco.lg,
  },
  titulo: {
    ...tipografia.tituloGrande,
    fontSize: 30,
    color: cores.texto,
    textAlign: 'center',
  },
  subtitulo: {
    fontSize: 16,
    color: cores.textoSecundario,
    textAlign: 'center',
    marginTop: espaco.xs,
    marginBottom: espaco.xl,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: cores.texto,
    marginBottom: 6,
    marginTop: espaco.lg,
  },
  input: {
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.md,
    paddingHorizontal: espaco.lg,
    paddingVertical: 14,
    fontSize: 16,
    color: cores.texto,
    minHeight: 48,
    backgroundColor: cores.fundoCard,
  },
  senhaContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.md,
    minHeight: 48,
    backgroundColor: cores.fundoCard,
  },
  senhaInput: {
    flex: 1,
    paddingHorizontal: espaco.lg,
    paddingVertical: 14,
    fontSize: 16,
    color: cores.texto,
  },
  toggleSenha: {
    paddingHorizontal: espaco.lg,
    minHeight: 48,
    justifyContent: 'center',
  },
  toggleSenhaTexto: {
    color: cores.primaria,
    fontWeight: '600',
    fontSize: 14,
  },
  lembrarLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: espaco.lg,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: cores.borda,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  checkboxMarcado: {
    backgroundColor: cores.primaria,
    borderColor: cores.primaria,
  },
  checkboxMarca: {
    color: cores.onPrimaria,
    fontSize: 13,
    fontWeight: '700',
  },
  lembrarTexto: {
    fontSize: 14,
    color: cores.texto,
  },
  botao: {
    backgroundColor: cores.primaria,
    borderRadius: raio.md,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: espaco.xl,
    ...sombraFlutuante,
    shadowColor: cores.primaria,
    shadowOpacity: 0.3,
  },
  botaoPressionado: {
    opacity: 0.85,
  },
  botaoTexto: {
    ...tipografia.botao,
    color: cores.onPrimaria,
    fontSize: 17,
  },
  erroBox: {
    backgroundColor: cores.erroFundo,
    borderWidth: 1,
    borderColor: cores.erroBorda,
    borderRadius: raio.md,
    padding: espaco.md,
    marginBottom: espaco.sm,
  },
  erroTexto: {
    color: cores.erro,
    fontSize: 14,
  },
});
