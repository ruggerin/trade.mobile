import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { buscarPedido, marcarPedidoLido, type PedidoLoja } from '../lib/api/historicoLoja';
import { diaMes, diaMesInstante, rotuloStatusPedido, statusDoPedido } from '../lib/pedidoLoja';
import { cores, espaco, neutro, raio } from '../theme';

export type PedidoDetalheParams = { pedidoId: string };

// Registrada em mais de uma stack (Agenda, Lojas, Histórico — ver as *Stack.tsx) pra o "voltar"
// voltar pra onde o promotor estava; só precisa do param.
type Props = NativeStackScreenProps<{ PedidoDetalhe: PedidoDetalheParams }, 'PedidoDetalhe'>;

/**
 * Detalhe do pedido do ERP — docs/54-DETALHE-PEDIDO-PREVISAO-E-NOTIFICACAO.md §5 Fase 2: status,
 * linha do tempo (emitido → previsão → chegou), NF, observação e todos os itens com quantidade.
 * Nunca mostra valor (o domínio não tem preço). Abrir marca os avisos do sino como lidos.
 */
export function PedidoDetalheScreen({ route }: Props) {
  const { pedidoId } = route.params;
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['pedido', pedidoId], queryFn: () => buscarPedido(pedidoId) });

  useEffect(() => {
    void marcarPedidoLido(pedidoId)
      .then(() => queryClient.invalidateQueries({ queryKey: ['avisos-pedido'] }))
      .catch(() => {});
  }, [pedidoId, queryClient]);

  if (query.isLoading) {
    return (
      <View style={styles.centro}>
        <ActivityIndicator color={cores.primaria} />
      </View>
    );
  }

  if (query.isError || !query.data) {
    return (
      <View style={styles.centro}>
        <Text style={styles.textoFraco}>Não foi possível carregar o pedido agora. Ele precisa de conexão.</Text>
      </View>
    );
  }

  const pedido = query.data;
  const status = statusDoPedido(pedido);

  return (
    <ScrollView contentContainerStyle={styles.conteudo}>
      <View style={styles.cartao}>
        <View style={styles.topo}>
          <View style={{ flex: 1 }}>
            <Text style={styles.titulo}>Pedido {pedido.numero_pedido}</Text>
            {!!pedido.ponto_venda && <Text style={styles.textoFraco}>{pedido.ponto_venda}</Text>}
          </View>
          <SeloStatus pedido={pedido} />
        </View>
        {!!pedido.numero_nf && <Text style={styles.textoFraco}>NF {pedido.numero_nf}</Text>}
      </View>

      <View style={styles.cartao}>
        <Text style={styles.secao}>Linha do tempo</Text>
        <Marco icone="file-document-outline" cor={cores.primaria} titulo="Emitido" valor={diaMes(pedido.data_pedido)} feito />
        {status === 'ENTREGUE' ? (
          <>
            {!!pedido.data_previsao_entrega && (
              <Marco icone="calendar-clock" cor={neutro[400]} titulo="Previsão" valor={diaMes(pedido.data_previsao_entrega)} feito />
            )}
            <Marco
              icone="check-circle"
              cor={cores.sucesso}
              titulo="Chegou na loja"
              valor={pedido.entregue_em ? diaMesInstante(pedido.entregue_em) : '—'}
              feito
              ultimo
            />
          </>
        ) : (
          <>
            <Marco
              icone="truck-delivery-outline"
              cor={status === 'ATRASADO' ? cores.erro : cores.acento}
              titulo={status === 'ATRASADO' ? 'Previsão (passou)' : 'Previsão de chegada'}
              valor={pedido.data_previsao_entrega ? diaMes(pedido.data_previsao_entrega) : 'sem previsão do ERP'}
              feito={false}
            />
            <Marco icone="store-check-outline" cor={neutro[300]} titulo="Chegada na loja" valor="aguardando" feito={false} ultimo />
          </>
        )}
      </View>

      {!!pedido.observacao && (
        <View style={styles.cartao}>
          <Text style={styles.secao}>Observação</Text>
          <Text style={styles.texto}>{pedido.observacao}</Text>
        </View>
      )}

      <View style={styles.cartao}>
        <Text style={styles.secao}>
          {pedido.itens.length} {pedido.itens.length === 1 ? 'item' : 'itens'}
        </Text>
        {pedido.itens.map((item) => (
          <View key={item.id} style={styles.item}>
            <Text style={styles.quantidade}>{Number(item.quantidade).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}×</Text>
            <Text style={[styles.texto, { flex: 1 }]}>{item.descricao_produto}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export function SeloStatus({ pedido }: { pedido: PedidoLoja }) {
  const status = statusDoPedido(pedido);
  const [fundo, texto] =
    status === 'ENTREGUE'
      ? [cores.sucessoFundo, cores.sucesso]
      : status === 'ATRASADO'
        ? [cores.erroFundo, cores.erro]
        : [cores.acentoClaro, cores.acentoTexto];
  return (
    <View style={[styles.selo, { backgroundColor: fundo }]}>
      <Text style={[styles.seloTexto, { color: texto }]}>{rotuloStatusPedido(pedido)}</Text>
    </View>
  );
}

function Marco({
  icone,
  cor,
  titulo,
  valor,
  feito,
  ultimo = false,
}: {
  icone: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  cor: string;
  titulo: string;
  valor: string;
  feito: boolean;
  ultimo?: boolean;
}) {
  return (
    <View style={styles.marco}>
      <View style={styles.marcoTrilho}>
        <MaterialCommunityIcons name={icone} size={20} color={cor} />
        {!ultimo && <View style={[styles.marcoLinha, !feito && styles.marcoLinhaPendente]} />}
      </View>
      <View style={styles.marcoTextos}>
        <Text style={styles.marcoTitulo}>{titulo}</Text>
        <Text style={[styles.marcoValor, !feito && { color: cor === neutro[300] ? cores.textoTerciario : cor }]}>{valor}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  conteudo: { padding: espaco.lg, gap: espaco.md },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: espaco.xl },
  cartao: {
    borderRadius: raio.lg,
    borderWidth: 1,
    borderColor: cores.borda,
    backgroundColor: cores.fundoCard,
    padding: espaco.md,
    gap: espaco.sm,
  },
  topo: { flexDirection: 'row', alignItems: 'flex-start', gap: espaco.sm },
  titulo: { fontSize: 18, fontWeight: '800', color: cores.texto },
  secao: { fontSize: 11, fontWeight: '800', color: neutro[500], textTransform: 'uppercase' },
  texto: { fontSize: 14, color: cores.texto },
  textoFraco: { fontSize: 13, color: cores.textoSecundario },
  selo: { borderRadius: raio.pill, paddingHorizontal: 10, paddingVertical: 3 },
  seloTexto: { fontSize: 12, fontWeight: '700' },
  item: { flexDirection: 'row', gap: espaco.sm, paddingVertical: 4, borderTopWidth: 1, borderTopColor: cores.borda },
  quantidade: { fontSize: 14, fontWeight: '700', color: cores.texto, minWidth: 44 },
  marco: { flexDirection: 'row', gap: espaco.sm },
  marcoTrilho: { alignItems: 'center', width: 22 },
  marcoLinha: { flex: 1, width: 2, minHeight: 18, backgroundColor: neutro[300], marginVertical: 2 },
  marcoLinhaPendente: { backgroundColor: neutro[200] },
  marcoTextos: { flex: 1, paddingBottom: espaco.sm },
  marcoTitulo: { fontSize: 12, color: cores.textoSecundario },
  marcoValor: { fontSize: 15, fontWeight: '700', color: cores.texto },
});
