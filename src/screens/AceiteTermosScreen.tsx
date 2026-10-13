import axios from 'axios';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { abrirDocumento, aceitarDocumentos, TITULO_DOCUMENTO, versaoLegivel } from '../lib/api/documentosLegais';
import { useAuth } from '../lib/auth/AuthContext';
import type { DocumentoPendente } from '../types/api';
import { cores, espaco, raio, tipografia } from '../theme';

// Aceite dos Termos de Uso e da Política de Privacidade (docs/58 §6) — no lugar das abas enquanto
// houver versão vigente sem aceite (primeiro acesso ou texto atualizado). Um checkbox só, gravando
// um aceite por documento. Quem não aceita não entra: "Sair".
export function AceiteTermosScreen() {
  const { usuario, atualizarUsuario, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const [concordo, setConcordo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const pendentes = usuario?.documentos_pendentes ?? [];

  const titulos = pendentes.map((d) => TITULO_DOCUMENTO[d.tipo]);
  const nomes = titulos.length > 1 ? `${titulos.slice(0, -1).join(', ')} e ${titulos[titulos.length - 1]}` : (titulos[0] ?? '');

  async function continuar() {
    setErro(null);
    setEnviando(true);
    try {
      const { usuario: atualizado } = await aceitarDocumentos(pendentes);
      atualizarUsuario(atualizado);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        // Publicaram versão nova com a tela aberta: mostra as pendências atuais e pede de novo.
        const atuais = (err.response.data as { documentos_pendentes?: DocumentoPendente[] }).documentos_pendentes;
        if (usuario && atuais) atualizarUsuario({ ...usuario, documentos_pendentes: atuais });
        setConcordo(false);
        setErro('Os documentos acabaram de ser atualizados. Leia a versão atual e aceite de novo.');
      } else if (axios.isAxiosError(err) && !err.response) {
        setErro('Sem conexão. Conecte-se à internet para aceitar e continuar.');
      } else {
        setErro('Não foi possível registrar o aceite. Tente de novo.');
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.conteudo, { paddingTop: insets.top + espaco.xl, paddingBottom: insets.bottom + espaco.xl }]}
    >
      <Image source={require('../../assets/horus-logo.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="Horus" />
      <Text style={styles.titulo}>{nomes}</Text>
      <Text style={styles.texto}>
        Para continuar usando o Horus, leia e aceite {pendentes.length > 1 ? 'os documentos abaixo' : 'o documento abaixo'}. Eles
        explicam as regras de uso e como tratamos os seus dados.
      </Text>

      {erro && (
        <View style={styles.erroBox}>
          <Text style={styles.erroTexto}>{erro}</Text>
        </View>
      )}

      {pendentes.map((d) => (
        <Pressable
          key={d.tipo}
          style={({ pressed }) => [styles.cartao, pressed && styles.pressionado]}
          onPress={() => void abrirDocumento(d.tipo, d.versao)}
          accessibilityRole="button"
          accessibilityLabel={`Ler ${TITULO_DOCUMENTO[d.tipo]}`}
        >
          <Text style={styles.cartaoTitulo}>{TITULO_DOCUMENTO[d.tipo]}</Text>
          <Text style={styles.cartaoSub}>Atualizado em {versaoLegivel(d.versao)} · toque para ler</Text>
        </Pressable>
      ))}

      <Pressable
        style={styles.linhaCheck}
        onPress={() => setConcordo((v) => !v)}
        disabled={enviando}
        hitSlop={8}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: concordo }}
      >
        <View style={[styles.checkbox, concordo && styles.checkboxMarcado]}>{concordo && <Text style={styles.checkboxMarca}>✓</Text>}</View>
        <Text style={styles.textoCheck}>
          Li e concordo com {pendentes.length > 1 ? 'os' : 'o'} {nomes}.
        </Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.botao, (!concordo || enviando) && styles.botaoDesativado, pressed && styles.pressionado]}
        onPress={() => void continuar()}
        disabled={!concordo || enviando}
      >
        {enviando ? <ActivityIndicator color={cores.onPrimaria} /> : <Text style={styles.botaoTexto}>Continuar</Text>}
      </Pressable>

      <Pressable style={styles.link} onPress={() => void logout()} disabled={enviando} hitSlop={8}>
        <Text style={styles.linkTexto}>Sair</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: cores.fundoCard },
  conteudo: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: espaco.xl },
  logo: { width: 160, height: 43, alignSelf: 'center', marginBottom: espaco.xl },
  titulo: { fontSize: 20, fontWeight: '700', color: cores.texto, marginBottom: espaco.sm },
  texto: { fontSize: 15, color: cores.textoSecundario, marginBottom: espaco.lg, lineHeight: 21 },
  erroBox: {
    backgroundColor: cores.acentoClaro,
    borderWidth: 1,
    borderColor: cores.acentoBorda,
    borderRadius: raio.md,
    padding: espaco.md,
    marginBottom: espaco.md,
  },
  erroTexto: { color: cores.acentoTexto, fontSize: 14 },
  cartao: {
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.md,
    padding: espaco.lg,
    marginBottom: espaco.sm,
    minHeight: 56,
  },
  cartaoTitulo: { fontSize: 16, fontWeight: '600', color: cores.primaria },
  cartaoSub: { fontSize: 13, color: cores.textoSecundario, marginTop: 2 },
  pressionado: { opacity: 0.85 },
  linhaCheck: { flexDirection: 'row', alignItems: 'flex-start', marginTop: espaco.lg, marginBottom: espaco.lg },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: cores.borda,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 1,
  },
  checkboxMarcado: { backgroundColor: cores.primaria, borderColor: cores.primaria },
  checkboxMarca: { color: cores.onPrimaria, fontSize: 14, fontWeight: '700' },
  textoCheck: { flex: 1, fontSize: 15, color: cores.texto, lineHeight: 21 },
  botao: {
    backgroundColor: cores.primaria,
    borderRadius: raio.md,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoDesativado: { opacity: 0.5 },
  botaoTexto: { ...tipografia.botao, color: cores.onPrimaria, fontSize: 17 },
  link: { alignSelf: 'center', marginTop: espaco.lg, padding: espaco.sm },
  linkTexto: { color: cores.primaria, fontWeight: '600', fontSize: 15 },
});
