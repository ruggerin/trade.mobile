import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { buscarNaoLidos, type NaoLidos } from '../lib/api/comentarios';
import type { HistoricoStackParamList } from '../navigation/HistoricoStack';
import { cores, espaco, raio } from '../theme';

type Props = NativeStackScreenProps<HistoricoStackParamList, 'Notificacoes'>;

type ItemNaoLido = NaoLidos['registros'][number];

// Feed "estilo Instagram/Facebook" — comentário do gestor em qualquer registro do promotor (ou,
// pra admin/gestor, de qualquer promotor da empresa). Toque leva direto ao registro com a
// conversa já aberta, sem precisar navegar loja → visita → registro na mão. Ver
// docs/29-NOTIFICACOES-MOBILE.md. Quem marca como lido é o feed do próprio registro
// (ComentariosRegistroModal, ao abrir) — esta tela só lista, não mexe no estado de leitura.
export function NotificacoesScreen({ navigation }: Props) {
  const query = useQuery({ queryKey: ['comentarios-nao-lidos'], queryFn: buscarNaoLidos, retry: false });

  function abrir(item: ItemNaoLido) {
    navigation.navigate('VisitaDetalhe', { visitaId: item.visita_id, abrirRegistroId: item.registro_id });
  }

  if (query.isLoading) {
    return (
      <View style={styles.centro}>
        <ActivityIndicator color={cores.primaria} />
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={styles.centro}>
        <Text style={styles.vazioTexto}>Não foi possível carregar agora. Verifique a conexão.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={query.data?.registros ?? []}
      keyExtractor={(item) => item.registro_id}
      contentContainerStyle={styles.lista}
      ListEmptyComponent={
        <View style={styles.centro}>
          <Text style={styles.vazioTexto}>Nenhuma notificação nova.</Text>
        </View>
      }
      renderItem={({ item }) => <ItemNotificacao item={item} onPress={() => abrir(item)} />}
    />
  );
}

function ItemNotificacao({ item, onPress }: { item: ItemNaoLido; onPress: () => void }) {
  const iniciais = item.ultimo.autor
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
  const quando = new Date(item.ultimo.em).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Pressable style={({ pressed }) => [styles.item, pressed && styles.itemPressionado]} onPress={onPress}>
      <View style={styles.avatar}>
        <Text style={styles.avatarTexto}>{iniciais}</Text>
      </View>
      <View style={styles.conteudo}>
        <Text style={styles.linha1}>
          <Text style={styles.negrito}>{item.ultimo.autor}</Text> comentou em{' '}
          <Text style={styles.negrito}>{item.sobre}</Text>
        </Text>
        <Text style={styles.linha2} numberOfLines={2}>
          "{item.ultimo.texto}"{item.ponto_venda ? ` · ${item.ponto_venda}` : ''} · {quando}
        </Text>
      </View>
      {item.nao_lidos > 0 && <View style={styles.ponto} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  lista: { flexGrow: 1, padding: espaco.md, gap: espaco.xs },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: espaco.xl, paddingTop: espaco.xxl },
  vazioTexto: { fontSize: 15, color: cores.textoSecundario, textAlign: 'center' },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: espaco.sm,
    padding: espaco.md,
    borderRadius: raio.lg,
  },
  itemPressionado: { backgroundColor: cores.fundoCard },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: cores.primariaClara,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTexto: { fontSize: 13, fontWeight: '700', color: cores.primariaEscura },
  conteudo: { flex: 1, gap: 2 },
  linha1: { fontSize: 14, color: cores.texto, lineHeight: 19 },
  negrito: { fontWeight: '700' },
  linha2: { fontSize: 13, color: cores.textoSecundario, lineHeight: 18 },
  ponto: { width: 8, height: 8, borderRadius: 4, backgroundColor: cores.primaria, marginTop: 6 },
});
