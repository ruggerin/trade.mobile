import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { cores, espaco, raio } from '../theme';

export interface ProdutoDetalhe {
  descricao: string;
  imagemUrl: string | null;
  codigoBarras: string | null;
  propriedade: string | null;
  secaoDescricao: string | null;
  produtoChave: boolean;
}

interface ProdutoDetalheModalProps {
  produto: ProdutoDetalhe | null;
  onClose: () => void;
}

// Ficha rápida de consulta — o promotor abre pra conferir código de barras/seção sem precisar
// tocar no item (que já é o atalho pra registrar). Só leitura, nada aqui grava nada.
export function ProdutoDetalheModal({ produto, onClose }: ProdutoDetalheModalProps) {
  return (
    <Modal visible={produto !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.cabecalho}>
          <View style={styles.cabecalhoAcaoEspaco} />
          <Text style={styles.cabecalhoTitulo} numberOfLines={1}>
            Detalhes do produto
          </Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.cabecalhoAcao}>Fechar</Text>
          </Pressable>
        </View>

        {produto && (
          <View style={styles.conteudo}>
            {produto.imagemUrl ? (
              <Image source={{ uri: produto.imagemUrl }} style={styles.imagem} resizeMode="contain" />
            ) : (
              <View style={[styles.imagem, styles.imagemVazia]}>
                <Text style={styles.imagemVaziaTexto}>Sem imagem cadastrada</Text>
              </View>
            )}

            <Text style={styles.descricao}>{produto.descricao}</Text>

            {produto.produtoChave && (
              <Text style={styles.badgeChave}>Produto-chave — avisa se ficar sem registro</Text>
            )}

            <View style={styles.linha}>
              <Text style={styles.linhaRotulo}>Código de barras</Text>
              <Text style={styles.linhaValor}>{produto.codigoBarras ?? '—'}</Text>
            </View>
            <View style={styles.linha}>
              <Text style={styles.linhaRotulo}>Seção</Text>
              <Text style={styles.linhaValor}>{produto.secaoDescricao ?? '—'}</Text>
            </View>
            <View style={styles.linha}>
              <Text style={styles.linhaRotulo}>Propriedade</Text>
              <Text style={styles.linhaValor}>
                {produto.propriedade === 'PROPRIA' ? 'Própria' : produto.propriedade === 'CONCORRENTE' ? 'Concorrente' : '—'}
              </Text>
            </View>
          </View>
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
  imagem: { width: '100%', height: 220, borderRadius: raio.lg, marginBottom: espaco.md },
  imagemVazia: { backgroundColor: cores.borda, alignItems: 'center', justifyContent: 'center' },
  imagemVaziaTexto: { color: cores.textoTerciario, fontSize: 13 },
  descricao: { fontSize: 18, fontWeight: '700', color: cores.texto, marginBottom: 4 },
  badgeChave: {
    alignSelf: 'flex-start',
    backgroundColor: cores.acentoClaro,
    color: cores.acentoTexto,
    fontSize: 12,
    fontWeight: '700',
    borderRadius: raio.sm,
    paddingHorizontal: espaco.sm,
    paddingVertical: 4,
    marginBottom: espaco.md,
  },
  linha: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: espaco.md,
    borderTopWidth: 1,
    borderTopColor: cores.divisor,
  },
  linhaRotulo: { fontSize: 14, color: cores.textoSecundario },
  linhaValor: { fontSize: 14, fontWeight: '600', color: cores.texto },
});
