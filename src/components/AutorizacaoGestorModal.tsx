import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { cores, espaco, neutro, raio, sombraFlutuante } from '../theme';

/**
 * Autorização de um gestor pra cancelar uma visita travada que o promotor não consegue cancelar
 * sozinho. Dois modos — código de 6 dígitos gerado no admin web (padrão: o gestor nunca digita
 * e-mail/senha no aparelho de outra pessoa) ou, por compatibilidade, e-mail+senha dele direto. A
 * autorização é conferida no servidor; aqui só coleta e mostra o erro. "Descartar só neste
 * aparelho" é a saída de último caso quando não há como falar com o servidor.
 */
export function AutorizacaoGestorModal({
  visible,
  enviando,
  erro,
  onEnviarCodigo,
  onEnviarSenha,
  onSoNesteAparelho,
  onClose,
}: {
  visible: boolean;
  enviando: boolean;
  erro: string | null;
  onEnviarCodigo: (codigo: string) => void;
  onEnviarSenha: (email: string, senha: string) => void;
  onSoNesteAparelho: () => void;
  onClose: () => void;
}) {
  const [modo, setModo] = useState<'CODIGO' | 'SENHA'>('CODIGO');
  const [codigo, setCodigo] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');

  useEffect(() => {
    if (visible) {
      setModo('CODIGO');
      setCodigo('');
      setEmail('');
      setSenha('');
    }
  }, [visible]);

  const prontoCodigo = codigo.trim().length === 6 && !enviando;
  const prontoSenha = email.trim().length > 3 && senha.length > 0 && !enviando;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.fundo} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.cartao}>
          <Text style={styles.titulo}>Autorização do gestor</Text>

          {modo === 'CODIGO' ? (
            <>
              <Text style={styles.texto}>
                O cancelamento pelo promotor não está liberado para esta visita. Peça a um gestor o código de
                autorização gerado no sistema (válido por 10 minutos) e digite abaixo.
              </Text>
              <TextInput
                style={[styles.input, styles.inputCodigo]}
                placeholder="000000"
                value={codigo}
                onChangeText={(v) => setCodigo(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                maxLength={6}
              />
              {!!erro && <Text style={styles.erro}>{erro}</Text>}
              <Pressable
                style={({ pressed }) => [styles.botao, !prontoCodigo && styles.botaoOff, pressed && { opacity: 0.85 }]}
                disabled={!prontoCodigo}
                onPress={() => onEnviarCodigo(codigo.trim())}
              >
                {enviando ? <ActivityIndicator color={cores.onPrimaria} /> : <Text style={styles.botaoTexto}>Autorizar e descartar</Text>}
              </Pressable>
              <Pressable style={styles.link} onPress={() => setModo('SENHA')} disabled={enviando}>
                <Text style={styles.linkTextoNeutro}>Não tenho um código — usar e-mail e senha</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.texto}>
                O cancelamento pelo promotor não está liberado para esta visita. Peça a um gestor para digitar o e-mail
                e a senha dele — ficam registrados na visita.
              </Text>
              <TextInput
                style={styles.input}
                placeholder="E-mail do gestor"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="username"
              />
              <TextInput
                style={styles.input}
                placeholder="Senha do gestor"
                value={senha}
                onChangeText={setSenha}
                secureTextEntry
                autoCapitalize="none"
                textContentType="password"
              />
              {!!erro && <Text style={styles.erro}>{erro}</Text>}
              <Pressable
                style={({ pressed }) => [styles.botao, !prontoSenha && styles.botaoOff, pressed && { opacity: 0.85 }]}
                disabled={!prontoSenha}
                onPress={() => onEnviarSenha(email.trim(), senha)}
              >
                {enviando ? <ActivityIndicator color={cores.onPrimaria} /> : <Text style={styles.botaoTexto}>Autorizar e descartar</Text>}
              </Pressable>
              <Pressable style={styles.link} onPress={() => setModo('CODIGO')} disabled={enviando}>
                <Text style={styles.linkTextoNeutro}>Usar código de autorização</Text>
              </Pressable>
            </>
          )}

          <Pressable style={styles.link} onPress={onSoNesteAparelho} disabled={enviando}>
            <Text style={styles.linkTexto}>Descartar só neste aparelho</Text>
          </Pressable>
          <Pressable style={styles.link} onPress={onClose} disabled={enviando}>
            <Text style={[styles.linkTexto, { color: cores.textoSecundario }]}>Voltar</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: 'rgba(17,24,39,0.55)', alignItems: 'center', justifyContent: 'center', padding: espaco.xl },
  cartao: { width: '100%', backgroundColor: cores.fundoCard, borderRadius: raio.xl, padding: espaco.xl, gap: espaco.md, ...sombraFlutuante },
  titulo: { fontSize: 18, fontWeight: '800', color: cores.texto, textAlign: 'center' },
  texto: { fontSize: 13, color: cores.textoSecundario, lineHeight: 19 },
  input: {
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.md,
    paddingHorizontal: espaco.md,
    minHeight: 48,
    fontSize: 15,
    color: cores.texto,
    backgroundColor: cores.fundo,
  },
  inputCodigo: {
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 8,
  },
  erro: { color: cores.erro, fontSize: 13, textAlign: 'center' },
  botao: { minHeight: 50, borderRadius: raio.md, backgroundColor: cores.erro, alignItems: 'center', justifyContent: 'center' },
  botaoOff: { backgroundColor: neutro[300] },
  botaoTexto: { color: cores.branco, fontWeight: '800', fontSize: 15 },
  link: { minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  linkTexto: { color: cores.erro, fontWeight: '700', fontSize: 13 },
  linkTextoNeutro: { color: cores.primaria, fontWeight: '700', fontSize: 13 },
});
