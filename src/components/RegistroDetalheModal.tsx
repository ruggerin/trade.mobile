import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cores, espaco, raio } from '../theme';

export interface RegistroDetalhe {
  tipoDescricao: string;
  vinculoLabel: string | null;
  valoresCampos: [string, string][];
  ruptura: boolean;
  observacao: string | null;
  imagensLocais: string[];
  criadoEm: string;
  erro: string | null;
}

interface RegistroDetalheModalProps {
  registro: RegistroDetalhe | null;
  onClose: () => void;
}

// Ficha de consulta do registro já feito — fotos em tamanho grande + todos os valores, sem editar
// nada aqui. "Cancelar registro" continua no card da lista (ação separada, não duplicada aqui).
export function RegistroDetalheModal({ registro, onClose }: RegistroDetalheModalProps) {
  return (
    <Modal visible={registro !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.cabecalho}>
          <View style={styles.cabecalhoAcaoEspaco} />
          <Text style={styles.cabecalhoTitulo} numberOfLines={1}>
            Detalhes do registro
          </Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.cabecalhoAcao}>Fechar</Text>
          </Pressable>
        </View>

        {registro && (
          <ScrollView contentContainerStyle={styles.conteudo}>
            {registro.imagensLocais.length > 0 ? (
              <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={styles.carrossel}>
                {registro.imagensLocais.map((uri) => (
                  <Image key={uri} source={{ uri }} style={styles.imagem} resizeMode="contain" />
                ))}
              </ScrollView>
            ) : (
              <View style={[styles.imagem, styles.imagemVazia]}>
                <Text style={styles.imagemVaziaTexto}>Sem foto</Text>
              </View>
            )}
            {registro.imagensLocais.length > 1 && (
              <Text style={styles.dicaCarrossel}>{registro.imagensLocais.length} fotos — arraste pra ver todas</Text>
            )}

            <Text style={styles.descricao}>{registro.tipoDescricao}</Text>
            {registro.vinculoLabel && <Text style={styles.vinculo}>{registro.vinculoLabel}</Text>}

            {registro.ruptura && <Text style={styles.badgeRuptura}>Ruptura</Text>}
            {registro.erro && <Text style={styles.badgeErro}>{registro.erro}</Text>}

            {registro.valoresCampos.map(([chave, valor]) => (
              <View key={chave} style={styles.linha}>
                <Text style={styles.linhaValor}>{valor}</Text>
              </View>
            ))}

            {!!registro.observacao && (
              <View style={styles.linha}>
                <Text style={styles.linhaRotulo}>Observação</Text>
                <Text style={styles.linhaValor}>{registro.observacao}</Text>
              </View>
            )}

            <View style={styles.linha}>
              <Text style={styles.linhaRotulo}>Registrado em</Text>
              <Text style={styles.linhaValor}>
                {new Date(registro.criadoEm).toLocaleDateString('pt-BR')} às{' '}
                {new Date(registro.criadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: cores.fundo },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: cores.fundoCard,
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.md,
    borderBottomWidth: 1,
    borderBottomColor: cores.divisor,
    gap: espaco.sm,
  },
  cabecalhoAcao: { color: cores.primaria, fontSize: 15, fontWeight: '600' },
  cabecalhoAcaoEspaco: { width: 60 },
  cabecalhoTitulo: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: cores.texto },
  conteudo: { padding: espaco.xl, gap: 4 },
  carrossel: { borderRadius: raio.lg, marginBottom: espaco.sm },
  imagem: { width: 335, height: 260, borderRadius: raio.lg, marginBottom: espaco.md },
  imagemVazia: { backgroundColor: cores.borda, alignItems: 'center', justifyContent: 'center' },
  imagemVaziaTexto: { color: cores.textoTerciario, fontSize: 13 },
  dicaCarrossel: { fontSize: 12, color: cores.textoTerciario, marginBottom: espaco.md, marginTop: -4 },
  descricao: { fontSize: 18, fontWeight: '700', color: cores.texto, marginBottom: 2 },
  vinculo: { fontSize: 14, color: cores.textoSecundario, marginBottom: espaco.md },
  badgeRuptura: {
    alignSelf: 'flex-start',
    backgroundColor: cores.erroFundo,
    color: cores.erro,
    fontSize: 12,
    fontWeight: '700',
    borderRadius: raio.sm,
    paddingHorizontal: espaco.sm,
    paddingVertical: 4,
    marginBottom: espaco.md,
  },
  badgeErro: {
    alignSelf: 'flex-start',
    backgroundColor: cores.erroFundo,
    color: cores.erro,
    fontSize: 12,
    fontWeight: '600',
    borderRadius: raio.sm,
    paddingHorizontal: espaco.sm,
    paddingVertical: 4,
    marginBottom: espaco.md,
  },
  linha: {
    paddingVertical: espaco.md,
    borderTopWidth: 1,
    borderTopColor: cores.divisor,
  },
  linhaRotulo: { fontSize: 12, color: cores.textoSecundario, marginBottom: 2 },
  linhaValor: { fontSize: 14, fontWeight: '600', color: cores.texto },
});
