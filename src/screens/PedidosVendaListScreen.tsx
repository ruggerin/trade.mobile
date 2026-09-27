import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { buscarPedidoSemVisitaPermitido } from '../lib/api/parametros';
import { listarMeusPedidosVenda } from '../lib/api/pedidosVenda';
import { useRecarregarAoFocar } from '../lib/useRecarregarAoFocar';
import { formatarMoeda, mensagemErroPedido, STATUS_PEDIDO_VENDA } from '../lib/pedidoVenda';
import type { PedidosStackParamList } from '../navigation/PedidosStack';
import type { PedidoVenda, StatusPedidoVenda } from '../types/api';
import { cores, espaco, raio, sombraCard, sombraFlutuante, tipografia } from '../theme';

type Props = NativeStackScreenProps<PedidosStackParamList, 'PedidosLista'>;

type Filtro = 'abertos' | 'concluidos' | 'todos';
const STATUS_POR_FILTRO: Record<Filtro, StatusPedidoVenda[] | undefined> = {
  abertos: ['RASCUNHO', 'PENDENTE_AUTORIZACAO', 'APROVADO'],
  concluidos: ['CONCLUIDO', 'CANCELADO'],
  todos: undefined,
};
const ROTULO_FILTRO: Record<Filtro, string> = { abertos: 'Em aberto', concluidos: 'Encerrados', todos: 'Todos' };

// Aba "Pedidos" — só aparece no "modo Vendedor" (pedidos_venda.criar). Os pedidos do próprio
// vendedor; a fila de autorização fica no admin web. Ver docs/38-PEDIDO-VENDEDOR.md §8.
export function PedidosVendaListScreen({ navigation }: Props) {
  const [filtro, setFiltro] = useState<Filtro>('abertos');
  const query = useQuery({
    queryKey: ['pedidos-venda-lista', filtro],
    queryFn: () => listarMeusPedidosVenda({ status: STATUS_POR_FILTRO[filtro] }),
  });
  const pedidos = query.data?.pedidos_venda ?? [];
  // Pedido aprovado/rejeitado no admin aparece ao voltar pra aba (ver lib/useRecarregarAoFocar.ts).
  const { atualizando, puxarParaAtualizar } = useRecarregarAoFocar(query.refetch);
  // PEDIDO_VENDA_SEM_VISITA_PERMITIDO desligado = pedido só nasce pelo "Tirar pedido" da visita.
  const semVisitaQuery = useQuery({ queryKey: ['pedido-sem-visita-permitido'], queryFn: buscarPedidoSemVisitaPermitido });
  const semVisitaPermitido = semVisitaQuery.data ?? false;

  return (
    <View style={styles.container}>
      <View style={styles.filtros}>
        {(Object.keys(ROTULO_FILTRO) as Filtro[]).map((f) => (
          <Pressable key={f} style={[styles.filtro, filtro === f && styles.filtroAtivo]} onPress={() => setFiltro(f)}>
            <Text style={[styles.filtroTexto, filtro === f && styles.filtroTextoAtivo]}>{ROTULO_FILTRO[f]}</Text>
          </Pressable>
        ))}
      </View>

      {query.isLoading ? (
        <ActivityIndicator style={{ marginTop: espaco.xl }} size="large" color={cores.primaria} />
      ) : query.isError ? (
        <View style={styles.centro}>
          <Text style={styles.textoSecundario}>{mensagemErroPedido(query.error, 'Não foi possível carregar os pedidos.')}</Text>
          <Pressable style={styles.botaoRetry} onPress={() => void query.refetch()}>
            <Text style={styles.botaoRetryTexto}>Tentar novamente</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={pedidos}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.lista}
          refreshControl={<RefreshControl refreshing={atualizando} onRefresh={puxarParaAtualizar} />}
          ListEmptyComponent={
            <View style={styles.centro}>
              <MaterialCommunityIcons name="cart-outline" size={40} color={cores.textoTerciario} />
              <Text style={styles.textoSecundario}>Nenhum pedido aqui ainda.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <PedidoCard pedido={item} onPress={() => navigation.navigate('PedidoVenda', { pedidoId: item.id })} />
          )}
        />
      )}

      {semVisitaPermitido ? (
        <Pressable style={styles.fab} onPress={() => navigation.navigate('PedidoVenda', undefined)}>
          <MaterialCommunityIcons name="plus" size={22} color={cores.onPrimaria} />
          <Text style={styles.fabTexto}>Novo pedido</Text>
        </Pressable>
      ) : (
        semVisitaQuery.isSuccess && (
          <View style={styles.dica}>
            <MaterialCommunityIcons name="information-outline" size={18} color={cores.primaria} />
            <Text style={styles.dicaTexto}>
              Para tirar um pedido, faça check-in na loja e toque em "Tirar pedido" na visita.
            </Text>
          </View>
        )
      )}
    </View>
  );
}

function PedidoCard({ pedido, onPress }: { pedido: PedidoVenda; onPress: () => void }) {
  const status = STATUS_PEDIDO_VENDA[pedido.status];

  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.cardPressionado]} onPress={onPress}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.cardLoja} numberOfLines={1}>
          {pedido.ponto_venda?.fantasia ?? '—'}
        </Text>
        <Text style={styles.textoSecundario}>
          {new Date(pedido.created_at).toLocaleDateString('pt-BR')} · {pedido.total_itens}{' '}
          {pedido.total_itens === 1 ? 'item' : 'itens'}
        </Text>
        <View style={[styles.chip, { backgroundColor: status.fundo }]}>
          <Text style={[styles.chipTexto, { color: status.cor }]}>{status.label}</Text>
        </View>
      </View>
      <Text style={styles.cardTotal}>{formatarMoeda(pedido.total)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: cores.fundo },
  filtros: { flexDirection: 'row', gap: espaco.sm, paddingHorizontal: espaco.lg, paddingTop: espaco.md },
  filtro: {
    borderRadius: raio.pill,
    borderWidth: 1,
    borderColor: cores.borda,
    paddingHorizontal: espaco.md,
    paddingVertical: 6,
    backgroundColor: cores.fundoCard,
  },
  filtroAtivo: { backgroundColor: cores.primaria, borderColor: cores.primaria },
  filtroTexto: { ...tipografia.legenda, color: cores.textoSecundario },
  filtroTextoAtivo: { color: cores.onPrimaria },
  lista: { padding: espaco.lg, gap: espaco.md, paddingBottom: 96 },
  centro: { alignItems: 'center', justifyContent: 'center', padding: espaco.xl, gap: espaco.md },
  textoSecundario: { ...tipografia.corpoSecundario, color: cores.textoSecundario, textAlign: 'left' },
  botaoRetry: { backgroundColor: cores.primaria, borderRadius: raio.sm, paddingHorizontal: espaco.lg, paddingVertical: 10 },
  botaoRetryTexto: { color: cores.onPrimaria, fontWeight: '600' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    backgroundColor: cores.fundoCard,
    borderRadius: raio.lg,
    borderWidth: 1,
    borderColor: cores.borda,
    padding: espaco.md,
    ...sombraCard,
  },
  cardPressionado: { backgroundColor: cores.divisor },
  cardLoja: { ...tipografia.destaque, color: cores.texto },
  cardTotal: { ...tipografia.subtitulo, color: cores.texto },
  chip: { alignSelf: 'flex-start', borderRadius: raio.pill, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  chipTexto: { ...tipografia.legenda },
  fab: {
    position: 'absolute',
    right: espaco.lg,
    bottom: espaco.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.xs,
    backgroundColor: cores.primaria,
    borderRadius: raio.pill,
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.md,
    ...sombraFlutuante,
  },
  fabTexto: { ...tipografia.botao, color: cores.onPrimaria },
  dica: {
    position: 'absolute',
    left: espaco.lg,
    right: espaco.lg,
    bottom: espaco.lg,
    flexDirection: 'row',
    gap: espaco.sm,
    alignItems: 'center',
    backgroundColor: cores.primariaClara,
    borderRadius: raio.md,
    padding: espaco.md,
  },
  dicaTexto: { ...tipografia.corpoSecundario, color: cores.primariaEscura, flex: 1 },
});
