import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cores, espaco, raio, tipografia } from '../theme';

/**
 * Fallback de erro compartilhado — usado tanto pelo ErrorBoundary (erro de render, dentro da
 * árvore React) quanto pelo tratador global instalado em App.tsx (erro fora do render: efeito,
 * callback, módulo nativo — ver lib/crashHandler.ts). docs/05-APP-MOBILE-UX.md §3.9 pede uma
 * tela amigável "nunca em branco ou crash visível", mas o pedido concreto que motivou mostrar a
 * mensagem aqui (em vez de só um texto genérico) foi poder ler o que aconteceu e reportar pro
 * suporte sem precisar reproduzir o problema de novo.
 */
export function TelaErro({ erro, onTentarNovamente }: { erro: unknown; onTentarNovamente: () => void }) {
  const mensagem = erro instanceof Error ? erro.message : String(erro);

  return (
    <View style={styles.container}>
      <View style={styles.icone}>
        <MaterialCommunityIcons name="alert-circle-outline" size={32} color={cores.erro} />
      </View>
      <Text style={styles.titulo}>Ops, algo deu errado</Text>
      <Text style={styles.texto}>
        Tivemos um problema inesperado. Se continuar acontecendo, tira um print desta mensagem e
        manda pro suporte:
      </Text>
      <ScrollView style={styles.caixaErro} contentContainerStyle={styles.caixaErroConteudo}>
        <Text selectable style={styles.mensagemErro}>
          {mensagem}
        </Text>
      </ScrollView>
      <Pressable style={styles.botao} onPress={onTentarNovamente}>
        <Text style={styles.botaoTexto}>Tentar novamente</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: espaco.xxl,
    paddingVertical: espaco.xxl * 1.5,
    backgroundColor: cores.fundoCard,
  },
  icone: {
    width: 64,
    height: 64,
    borderRadius: raio.lg,
    backgroundColor: cores.erroFundo,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: espaco.lg,
  },
  titulo: {
    ...tipografia.titulo,
    color: cores.texto,
    textAlign: 'center',
  },
  texto: {
    fontSize: 15,
    color: cores.textoSecundario,
    textAlign: 'center',
    marginTop: espaco.sm,
    marginBottom: espaco.lg,
  },
  caixaErro: {
    maxHeight: 160,
    width: '100%',
    backgroundColor: cores.erroFundo,
    borderWidth: 1,
    borderColor: cores.erroBorda,
    borderRadius: raio.md,
    marginBottom: espaco.xl,
  },
  caixaErroConteudo: {
    padding: espaco.md,
  },
  mensagemErro: {
    fontSize: 12,
    color: cores.erroForte,
    fontFamily: 'monospace',
  },
  botao: {
    backgroundColor: cores.primaria,
    borderRadius: raio.md,
    paddingHorizontal: espaco.xl,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoTexto: {
    color: cores.onPrimaria,
    fontSize: 16,
    fontWeight: '700',
  },
});
