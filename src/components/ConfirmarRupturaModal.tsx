import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cores, espaco, neutro, raio, sombraCard } from '../theme';

/**
 * Tela de confirmação de ruptura (decisão 4 de docs/20-FORMULARIO-DINAMICO-CAMPANHA.md) — depois
 * que um registro com campo SORTIMENTO (confirmar_ruptura_ausentes=true) é salvo, mostra só os
 * produtos que o promotor marcou ausentes, pré-selecionados; ele desmarca o que não quer
 * sinalizar e confirma. Não item a item (evita encher a tela de pop-up) — uma tela só, no fim.
 */
interface ConfirmarRupturaModalProps {
  visible: boolean;
  produtos: { produtoUuid: string; descricao: string }[];
  enviando: boolean;
  onCancelar: () => void;
  onConfirmar: (produtosConfirmados: { produtoUuid: string; descricao: string }[]) => void;
}

export function ConfirmarRupturaModal({ visible, produtos, enviando, onCancelar, onConfirmar }: ConfirmarRupturaModalProps) {
  const [marcados, setMarcados] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (visible) setMarcados(new Set(produtos.map((p) => p.produtoUuid)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function alternar(produtoUuid: string) {
    setMarcados((atual) => {
      const novo = new Set(atual);
      if (novo.has(produtoUuid)) {
        novo.delete(produtoUuid);
      } else {
        novo.add(produtoUuid);
      }
      return novo;
    });
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancelar}>
      <View style={styles.container}>
        <View style={styles.cabecalho}>
          <MaterialCommunityIcons name="alert-decagram-outline" size={18} color={cores.erro} />
          <Text style={styles.cabecalhoTitulo}>Confirmar ruptura</Text>
        </View>
        <ScrollView contentContainerStyle={styles.lista}>
          <Text style={styles.subtitulo}>
            Estes produtos ficaram marcados como ausentes no mix. Confirma que é ruptura de
            verdade? Desmarque o que não quer sinalizar.
          </Text>
          {produtos.map((produto) => {
            const marcado = marcados.has(produto.produtoUuid);
            return (
              <Pressable
                key={produto.produtoUuid}
                style={({ pressed }) => [styles.item, pressed && styles.itemPressionado]}
                onPress={() => alternar(produto.produtoUuid)}
              >
                <View style={[styles.checkbox, marcado && styles.checkboxMarcado]}>
                  {marcado && <Text style={styles.checkboxMarca}>✓</Text>}
                </View>
                <Text style={styles.itemTexto}>{produto.descricao}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.rodape}>
          <Pressable style={({ pressed }) => [styles.botaoSecundario, pressed && styles.itemPressionado]} onPress={onCancelar}>
            <Text style={styles.botaoSecundarioTexto}>Nenhuma é ruptura</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.botaoPrimario, pressed && styles.itemPressionado]}
            disabled={enviando}
            onPress={() => onConfirmar(produtos.filter((p) => marcados.has(p.produtoUuid)))}
          >
            {enviando ? (
              <ActivityIndicator color={cores.branco} />
            ) : (
              <Text style={styles.botaoPrimarioTexto}>
                Confirmar {marcados.size > 0 ? `(${marcados.size})` : ''}
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: cores.fundo },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: espaco.sm,
    backgroundColor: cores.fundoCard,
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.md,
    borderBottomWidth: 1,
    borderBottomColor: cores.divisor,
  },
  cabecalhoTitulo: { fontSize: 16, fontWeight: '700', color: cores.texto },
  lista: { padding: espaco.lg, gap: espaco.sm },
  subtitulo: { fontSize: 13, color: cores.textoSecundario, marginBottom: espaco.sm },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: cores.fundoCard,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.borda,
    padding: espaco.md,
    minHeight: 48,
    ...sombraCard,
  },
  itemPressionado: { backgroundColor: neutro[100] },
  itemTexto: { fontSize: 14, color: cores.texto, flex: 1 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: cores.borda,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxMarcado: { backgroundColor: cores.erro, borderColor: cores.erro },
  checkboxMarca: { color: cores.branco, fontSize: 14, fontWeight: '700' },
  rodape: {
    padding: espaco.lg,
    backgroundColor: cores.fundoCard,
    borderTopWidth: 1,
    borderTopColor: cores.divisor,
    gap: espaco.sm,
  },
  botaoSecundario: {
    minHeight: 48,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.borda,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoSecundarioTexto: { color: neutro[700], fontSize: 14, fontWeight: '700' },
  botaoPrimario: {
    minHeight: 52,
    borderRadius: raio.md,
    backgroundColor: cores.erro,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoPrimarioTexto: { color: cores.branco, fontSize: 15, fontWeight: '700' },
});
