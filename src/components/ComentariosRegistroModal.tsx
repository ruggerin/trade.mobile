import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { criarComentario, listarComentarios } from '../lib/api/comentarios';
import { cores, espaco, neutro, raio } from '../theme';

/**
 * Feedback de um registro (docs/28 §3): o gestor responde ("pedido chega sexta") e o promotor vê
 * e responde de volta. Feed cronológico simples; abrir busca a lista e o backend já marca como
 * lido — depois disso o badge da aba Histórico é recarregado.
 */
export function ComentariosRegistroModal({
  visible,
  visitaUuid,
  registroUuid,
  titulo,
  onClose,
}: {
  visible: boolean;
  visitaUuid: string;
  registroUuid: string | null;
  titulo: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [texto, setTexto] = useState('');

  const query = useQuery({
    queryKey: ['comentarios', registroUuid],
    queryFn: async () => {
      const comentarios = await listarComentarios(visitaUuid, registroUuid!);
      void queryClient.invalidateQueries({ queryKey: ['comentarios-nao-lidos'] });
      return comentarios;
    },
    enabled: visible && !!registroUuid,
    retry: false,
  });

  const enviar = useMutation({
    mutationFn: () => criarComentario(visitaUuid, registroUuid!, texto.trim()),
    onSuccess: () => {
      setTexto('');
      void queryClient.invalidateQueries({ queryKey: ['comentarios', registroUuid] });
    },
  });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.cabecalho}>
          <View style={styles.espaco} />
          <Text style={styles.titulo} numberOfLines={1}>
            Feedback — {titulo}
          </Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.fechar}>Fechar</Text>
          </Pressable>
        </View>

        {query.isLoading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={cores.primaria} />
        ) : query.isError ? (
          <Text style={styles.vazio}>Não foi possível carregar agora. Verifique a conexão.</Text>
        ) : (
          <FlatList
            data={query.data}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.lista}
            ListEmptyComponent={<Text style={styles.vazio}>Nenhum comentário ainda. Escreva o primeiro abaixo.</Text>}
            renderItem={({ item }) => (
              <View style={[styles.balao, item.meu ? styles.balaoMeu : styles.balaoOutro]}>
                <Text style={[styles.autor, item.meu && styles.textoMeu]}>
                  {item.autor.nome} ·{' '}
                  {new Date(item.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </Text>
                <Text style={[styles.texto, item.meu && styles.textoMeu]}>{item.texto}</Text>
              </View>
            )}
          />
        )}

        {enviar.isError && <Text style={styles.erro}>Não foi possível enviar. Tente de novo.</Text>}
        <View style={styles.entrada}>
          <TextInput
            style={styles.input}
            placeholder="Escreva uma resposta"
            value={texto}
            onChangeText={setTexto}
            multiline
            maxLength={2000}
          />
          <Pressable
            style={({ pressed }) => [styles.enviar, (!texto.trim() || enviar.isPending) && styles.enviarOff, pressed && { opacity: 0.85 }]}
            disabled={!texto.trim() || enviar.isPending}
            onPress={() => enviar.mutate()}
          >
            {enviar.isPending ? <ActivityIndicator color={cores.onPrimaria} /> : <Text style={styles.enviarTexto}>Enviar</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
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
  espaco: { width: 50 },
  titulo: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: cores.texto },
  fechar: { color: cores.primaria, fontSize: 15, fontWeight: '600' },
  lista: { padding: espaco.lg, gap: espaco.sm, flexGrow: 1 },
  vazio: { textAlign: 'center', color: cores.textoTerciario, fontSize: 14, marginTop: espaco.xl, paddingHorizontal: espaco.lg },
  balao: { maxWidth: '85%', borderRadius: raio.lg, paddingHorizontal: espaco.md, paddingVertical: espaco.sm },
  balaoMeu: { alignSelf: 'flex-end', backgroundColor: cores.primaria },
  balaoOutro: { alignSelf: 'flex-start', backgroundColor: cores.fundoCard, borderWidth: 1, borderColor: cores.borda },
  autor: { fontSize: 11, fontWeight: '700', color: cores.textoSecundario, marginBottom: 2 },
  texto: { fontSize: 14, color: cores.texto },
  textoMeu: { color: cores.onPrimaria },
  erro: { color: cores.erro, fontSize: 13, textAlign: 'center', paddingVertical: 4 },
  entrada: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: espaco.sm,
    padding: espaco.md,
    backgroundColor: cores.fundoCard,
    borderTopWidth: 1,
    borderTopColor: cores.divisor,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.md,
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
    fontSize: 15,
    color: cores.texto,
    backgroundColor: cores.fundo,
  },
  enviar: { minHeight: 44, borderRadius: raio.md, backgroundColor: cores.primaria, paddingHorizontal: espaco.lg, alignItems: 'center', justifyContent: 'center' },
  enviarOff: { backgroundColor: neutro[300] },
  enviarTexto: { color: cores.onPrimaria, fontWeight: '700', fontSize: 15 },
});
