import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { buscarNaoLidos, type NaoLidos } from '../lib/api/comentarios';
import { buscarAvisosPedido, type AvisoPedido } from '../lib/api/historicoLoja';
import { textoAvisoPedido } from '../lib/pedidoLoja';
import type { HistoricoStackParamList } from '../navigation/HistoricoStack';
import { cores, espaco, raio } from '../theme';

type Props = NativeStackScreenProps<HistoricoStackParamList, 'Notificacoes'>;

type ItemNaoLido = NaoLidos['registros'][number];

// Duas fontes no mesmo feed (docs/54 §3): comentário em registro (docs/29) e aviso de pedido do
// ERP (a caminho / entregue). Cada uma continua com o próprio "lido" — o feed só junta e ordena.
type ItemFeed = { tipo: 'comentario'; em: string; chave: string; item: ItemNaoLido } | { tipo: 'pedido'; em: string; chave: string; aviso: AvisoPedido };

/** Bucketiza em "Hoje"/"Ontem"/data, com o feed já ordenado do mais recente pro mais antigo. */
export function agruparPorDia<T extends { em: string }>(itens: T[]): { titulo: string; data: T[] }[] {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const ontem = new Date(hoje);
  ontem.setDate(ontem.getDate() - 1);

  const grupos: { titulo: string; data: T[] }[] = [];
  for (const item of itens) {
    const dia = new Date(item.em);
    dia.setHours(0, 0, 0, 0);

    const titulo =
      dia.getTime() === hoje.getTime()
        ? 'Hoje'
        : dia.getTime() === ontem.getTime()
          ? 'Ontem'
          : dia.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

    const ultimoGrupo = grupos.at(-1);
    if (ultimoGrupo?.titulo === titulo) {
      ultimoGrupo.data.push(item);
    } else {
      grupos.push({ titulo, data: [item] });
    }
  }

  return grupos;
}

/** Junta comentários e avisos de pedido, mais recente primeiro. */
export function montarFeed(comentarios: ItemNaoLido[], avisos: AvisoPedido[]): ItemFeed[] {
  return [
    ...comentarios.map((item): ItemFeed => ({ tipo: 'comentario', em: item.ultimo.em, chave: `c-${item.registro_id}`, item })),
    ...avisos.map((aviso): ItemFeed => ({ tipo: 'pedido', em: aviso.em, chave: `p-${aviso.id}`, aviso })),
  ].sort((a, b) => new Date(b.em).getTime() - new Date(a.em).getTime());
}

// Feed "estilo Instagram/Facebook". Comentário: toque leva direto ao registro com a conversa
// aberta (docs/29); quem marca como lido é o próprio registro. Pedido: toque abre o detalhe do
// pedido, que marca o aviso como lido (docs/54).
export function NotificacoesScreen({ navigation }: Props) {
  const comentariosQuery = useQuery({ queryKey: ['comentarios-nao-lidos'], queryFn: buscarNaoLidos, retry: false });
  const pedidosQuery = useQuery({ queryKey: ['avisos-pedido'], queryFn: buscarAvisosPedido, retry: false });

  function abrir(feed: ItemFeed) {
    if (feed.tipo === 'comentario') {
      navigation.navigate('VisitaDetalhe', { visitaId: feed.item.visita_id, abrirRegistroId: feed.item.registro_id });
    } else {
      navigation.navigate('PedidoDetalhe', { pedidoId: feed.aviso.pedido_id });
    }
  }

  if (comentariosQuery.isLoading || pedidosQuery.isLoading) {
    return (
      <View style={styles.centro}>
        <ActivityIndicator color={cores.primaria} />
      </View>
    );
  }

  if (comentariosQuery.isError && pedidosQuery.isError) {
    return (
      <View style={styles.centro}>
        <Text style={styles.vazioTexto}>Não foi possível carregar agora. Verifique a conexão.</Text>
      </View>
    );
  }

  const feed = montarFeed(comentariosQuery.data?.registros ?? [], pedidosQuery.data?.avisos ?? []);

  return (
    <SectionList
      sections={agruparPorDia(feed)}
      keyExtractor={(item) => item.chave}
      contentContainerStyle={styles.lista}
      stickySectionHeadersEnabled={false}
      ListEmptyComponent={
        <View style={styles.centro}>
          <Text style={styles.vazioTexto}>Nenhuma notificação nova.</Text>
        </View>
      }
      renderSectionHeader={({ section }) => <Text style={styles.tituloSecao}>{section.titulo}</Text>}
      renderItem={({ item }) =>
        item.tipo === 'comentario' ? (
          <ItemComentario item={item.item} onPress={() => abrir(item)} />
        ) : (
          <ItemPedido aviso={item.aviso} onPress={() => abrir(item)} />
        )
      }
    />
  );
}

function quando(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function ItemComentario({ item, onPress }: { item: ItemNaoLido; onPress: () => void }) {
  const iniciais = item.ultimo.autor
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

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
          "{item.ultimo.texto}"{item.ponto_venda ? ` · ${item.ponto_venda}` : ''} · {quando(item.ultimo.em)}
        </Text>
      </View>
      {item.nao_lidos > 0 && <View style={styles.ponto} />}
    </Pressable>
  );
}

function ItemPedido({ aviso, onPress }: { aviso: AvisoPedido; onPress: () => void }) {
  const entregue = aviso.tipo === 'ENTREGUE';
  return (
    <Pressable style={({ pressed }) => [styles.item, pressed && styles.itemPressionado]} onPress={onPress}>
      <View style={[styles.avatar, { backgroundColor: entregue ? cores.sucessoFundo : cores.acentoClaro }]}>
        <MaterialCommunityIcons
          name={entregue ? 'package-variant-closed-check' : 'truck-delivery-outline'}
          size={18}
          color={entregue ? cores.sucesso : cores.acentoTexto}
        />
      </View>
      <View style={styles.conteudo}>
        <Text style={styles.linha1}>{textoAvisoPedido(aviso)}</Text>
        <Text style={styles.linha2}>Toque pra ver os itens · {quando(aviso.em)}</Text>
      </View>
      <View style={styles.ponto} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  lista: { flexGrow: 1, padding: espaco.md, gap: espaco.xs },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: espaco.xl, paddingTop: espaco.xxl },
  tituloSecao: {
    fontSize: 12,
    fontWeight: '700',
    color: cores.textoSecundario,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    paddingHorizontal: espaco.md,
    paddingTop: espaco.sm,
    paddingBottom: espaco.xs,
  },
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
