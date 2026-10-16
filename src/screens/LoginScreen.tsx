import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import axios from 'axios';
import { useAuth } from '../lib/auth/AuthContext';
import { abrirDocumento } from '../lib/api/documentosLegais';
import { credenciaisStorage } from '../lib/auth/credentialsStorage';
import { textoVersaoApp } from '../lib/versao';
import { cores, espaco, raio, sombraFlutuante, tipografia } from '../theme';

// docs/05-APP-MOBILE-UX.md §3.2 — campo e-mail, campo senha (toggle mostrar/ocultar), botão
// "Entrar", estados padrão/carregando/erro inline/sem conexão.
export function LoginScreen() {
  const { login, avisoSessao } = useAuth();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [lembrar, setLembrar] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Pré-preenche o e-mail se o promotor marcou "lembrar" numa sessão anterior — a senha não é
  // mais guardada (docs/67 §4.5, ver lib/auth/credentialsStorage.ts). Só roda uma vez, ao montar.
  useEffect(() => {
    let cancelado = false;
    credenciaisStorage.get().then((salvas) => {
      if (cancelado || !salvas) return;
      setEmail(salvas.email);
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
      // Só depois do login confirmar. A biometria não é mais escolhida aqui: o app pergunta depois
      // do login e a opção fica no Perfil (lib/auth/biometria.ts).
      if (lembrar) {
        await credenciaisStorage.set({ email: email.trim() });
      } else {
        await credenciaisStorage.clear();
      }
    } catch (err) {
      if (axios.isAxiosError<{ errors?: Record<string, string[]>; message?: string }>(err)) {
        if (!err.response) {
          setErro('Não foi possível conectar. Verifique sua internet e tente novamente.');
        } else if (err.response.status === 429) {
          // Limite de tentativas de login (docs/67 §2, B8).
          setErro('Muitas tentativas seguidas. Aguarde um minuto e tente de novo.');
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
      behavior="padding"
    >
      <ScrollView
        contentContainerStyle={styles.conteudo}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Image
          source={require('../../assets/horus-logo.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel="Horus"
        />
        <Text style={styles.subtitulo}>Entre com sua conta de promotor</Text>

        {avisoSessao && !erro && (
          <View style={styles.avisoBox}>
            <Text style={styles.avisoTexto}>{avisoSessao}</Text>
          </View>
        )}

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
          <Text style={styles.lembrarTexto}>Lembrar meu e-mail</Text>
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

        {/* docs/58 §6 — o aceite de verdade é na tela seguinte ao login; aqui só o aviso com os textos. */}
        <Text style={styles.legal}>
          Ao entrar, você concorda com os{' '}
          <Text style={styles.legalLink} onPress={() => void abrirDocumento('TERMOS_USO')} accessibilityRole="link">
            Termos de Uso
          </Text>{' '}
          e a{' '}
          <Text style={styles.legalLink} onPress={() => void abrirDocumento('POLITICA_PRIVACIDADE')} accessibilityRole="link">
            Política de Privacidade
          </Text>
          .
        </Text>

        {/* Versão do app — pra o suporte saber qual build está no celular (problema de integração). */}
        <Text style={styles.versao}>{textoVersaoApp()}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: cores.fundoCard,
  },
  conteudo: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: espaco.xl,
    paddingVertical: espaco.xl,
  },
  // Logo horizontal oficial da marca (assets/horus-logo.png, proporção 1600 x 428).
  logo: {
    width: 180,
    height: 48,
    alignSelf: 'center',
    marginBottom: espaco.md,
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
  legal: {
    fontSize: 13,
    color: cores.textoSecundario,
    textAlign: 'center',
    marginTop: espaco.lg,
    lineHeight: 19,
  },
  legalLink: {
    color: cores.primaria,
    fontWeight: '600',
  },
  versao: {
    fontSize: 12,
    color: cores.textoTerciario,
    textAlign: 'center',
    marginTop: espaco.md,
  },
  erroTexto: {
    color: cores.erro,
    fontSize: 14,
  },
  avisoBox: {
    backgroundColor: cores.acentoClaro,
    borderWidth: 1,
    borderColor: cores.acentoBorda,
    borderRadius: raio.md,
    padding: espaco.md,
    marginBottom: espaco.sm,
  },
  avisoTexto: {
    color: cores.acentoTexto,
    fontSize: 14,
  },
});
