import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { cores, espaco, neutro, raio, sombraFlutuante } from '../theme';

/**
 * Autorização de um gestor (e-mail + senha dele) pra cancelar uma visita travada que o promotor
 * não consegue cancelar sozinho. A senha é conferida no servidor; aqui só coleta e mostra o erro.
 * "Descartar só neste aparelho" é a saída de último caso quando não há como falar com o servidor.
 */
export function AutorizacaoGestorModal({
  visible,
  enviando,
  erro,
  onEnviar,
  onSoNesteAparelho,
  onClose,
}: {
  visible: boolean;
  enviando: boolean;
  erro: string | null;
  onEnviar: (email: string, senha: string) => void;
  onSoNesteAparelho: () => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');

  useEffect(() => {
    if (visible) {
      setEmail('');
      setSenha('');
    }
  }, [visible]);

  const pronto = email.trim().length > 3 && senha.length > 0 && !enviando;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.fundo} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.cartao}>
          <Text style={styles.titulo}>Autorização do gestor</Text>
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
            style={({ pressed }) => [styles.botao, !pronto && styles.botaoOff, pressed && { opacity: 0.85 }]}
            disabled={!pronto}
            onPress={() => onEnviar(email.trim(), senha)}
          >
            {enviando ? <ActivityIndicator color={cores.onPrimaria} /> : <Text style={styles.botaoTexto}>Autorizar e descartar</Text>}
          </Pressable>
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
  erro: { color: cores.erro, fontSize: 13, textAlign: 'center' },
  botao: { minHeight: 50, borderRadius: raio.md, backgroundColor: cores.erro, alignItems: 'center', justifyContent: 'center' },
  botaoOff: { backgroundColor: neutro[300] },
  botaoTexto: { color: cores.branco, fontWeight: '800', fontSize: 15 },
  link: { minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  linkTexto: { color: cores.erro, fontWeight: '700', fontSize: 13 },
});
