import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { buscarHistoricoLoja, buscarPedidosLoja, type EventoHistorico, type PedidoLoja } from '../lib/api/historicoLoja';
import { cores, espaco, neutro, raio } from '../theme';

const MAX_ITENS_POR_PEDIDO = 4;

function dataCurta(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/**
 * Aba "Histórico da loja" (docs/28 §4): pedidos do ERP, últimas rupturas/alertas e as últimas
 * visitas — só consulta. Online-only: sem rede mostra um aviso em vez de quebrar o fluxo de visita.
 */
export function HistoricoLojaPanel({ pontoVendaUuid }: { pontoVendaUuid: string }) {
  const historicoQuery = useQuery({
    queryKey: ['historico-loja', pontoVendaUuid],
    queryFn: () => buscarHistoricoLoja(pontoVendaUuid),
    staleTime: 60_000,
    retry: false,
  });
  const pedidosQuery = useQuery({
    queryKey: ['pedidos-loja', pontoVendaUuid],
    queryFn: () => buscarPedidosLoja(pontoVendaUuid),
    staleTime: 60_000,
    retry: false,
  });

  if (historicoQuery.isLoading && pedidosQuery.isLoading) {
    return (
      <View style={styles.painel}>
        <ActivityIndicator color={cores.primaria} />
      </View>
    );
  }

  if (historicoQuery.isError && pedidosQuery.isError) {
    return (
      <View style={styles.painel}>
        <Text style={styles.vazio}>Não foi possível carregar o histórico agora. Ele precisa de conexão.</Text>
      </View>
    );
  }

  const pedidos = pedidosQuery.data ?? [];
  const rupturas = historicoQuery.data?.rupturas ?? [];
  const alertas = historicoQuery.data?.alertas ?? [];
  const visitas = historicoQuery.data?.visitas ?? [];

  if (pedidos.length === 0 && rupturas.length === 0 && alertas.length === 0 && visitas.length === 0) {
    return (
      <View style={styles.painel}>
        <Text style={styles.vazio}>Ainda não há histórico para esta loja.</Text>
      </View>
    );
  }

  return (
    <View style={styles.painel}>
      {pedidos.length > 0 && (
        <Secao titulo="Pedidos">
          {pedidos.slice(0, 5).map((pedido) => (
            <Pedido key={pedido.id} pedido={pedido} />
          ))}
        </Secao>
      )}
      {rupturas.length > 0 && (
        <Secao titulo="Últimas rupturas">
          {rupturas.map((e) => (
            <Evento key={e.id} evento={e} />
          ))}
        </Secao>
      )}
      {alertas.length > 0 && (
        <Secao titulo="Últimos alertas">
          {alertas.map((e) => (
            <Evento key={e.id} evento={e} />
          ))}
        </Secao>
      )}
      {visitas.length > 0 && (
        <Secao titulo="Últimas visitas">
          {visitas.map((v) => (
            <Text key={v.id} style={styles.linha}>
              {dataCurta(v.inicio_data)}
              {v.promotor ? ` · ${v.promotor}` : ''}
            </Text>
          ))}
        </Secao>
      )}
    </View>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <View style={styles.secao}>
      <Text style={styles.secaoTitulo}>{titulo}</Text>
      {children}
    </View>
  );
}

function Pedido({ pedido }: { pedido: PedidoLoja }) {
  const entregue = pedido.status === 'ENTREGUE';
  const extras = pedido.itens.length - MAX_ITENS_POR_PEDIDO;
  return (
    <View style={styles.pedido}>
      <View style={styles.pedidoTopo}>
        <Text style={styles.pedidoNumero}>Pedido {pedido.numero_pedido}</Text>
        <View style={[styles.selo, entregue ? styles.seloEntregue : styles.seloPendente]}>
          <Text style={[styles.seloTexto, entregue ? styles.seloTextoEntregue : styles.seloTextoPendente]}>
            {entregue && pedido.entregue_em ? `Entregue ${dataCurta(pedido.entregue_em)}` : 'A caminho'}
          </Text>
        </View>
      </View>
      <Text style={styles.linhaFraca}>Feito em {dataCurta(pedido.data_pedido)}</Text>
      {pedido.itens.slice(0, MAX_ITENS_POR_PEDIDO).map((item) => (
        <Text key={item.id} style={styles.linha}>
          {Number(item.quantidade).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}× {item.descricao_produto}
        </Text>
      ))}
      {extras > 0 && <Text style={styles.linhaFraca}>+ {extras} item(ns)</Text>}
    </View>
  );
}

function Evento({ evento }: { evento: EventoHistorico }) {
  return (
    <View style={styles.evento}>
      <Text style={styles.linha}>
        {dataCurta(evento.ocorrido_em)} · {evento.produto ?? evento.tipo_registro ?? 'Registro'}
        {evento.resolvido ? ' (resolvido)' : ''}
      </Text>
      {!!(evento.observacao || evento.promotor) && (
        <Text style={styles.linhaFraca} numberOfLines={2}>
          {[evento.promotor, evento.observacao].filter(Boolean).join(' — ')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  painel: { padding: espaco.lg },
  vazio: { fontSize: 13, color: cores.textoTerciario, textAlign: 'center', marginTop: espaco.xl },
  card: {
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.borda,
    backgroundColor: cores.fundoCard,
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
  },
  cabecalho: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm },
  cabecalhoTexto: { flex: 1 },
  titulo: { fontSize: 14, fontWeight: '700', color: cores.texto },
  resumo: { fontSize: 12, color: cores.textoSecundario, marginTop: 1 },
  corpo: { maxHeight: 240, marginTop: espaco.sm },
  secao: { marginBottom: espaco.md },
  secaoTitulo: { fontSize: 11, fontWeight: '800', color: neutro[500], textTransform: 'uppercase', marginBottom: 4 },
  linha: { fontSize: 13, color: cores.texto },
  linhaFraca: { fontSize: 12, color: cores.textoSecundario },
  evento: { marginBottom: 6 },
  pedido: { marginBottom: espaco.sm, gap: 1 },
  pedidoTopo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pedidoNumero: { fontSize: 13, fontWeight: '700', color: cores.texto },
  selo: { borderRadius: raio.pill, paddingHorizontal: 8, paddingVertical: 2 },
  seloPendente: { backgroundColor: cores.acentoClaro },
  seloEntregue: { backgroundColor: neutro[100] },
  seloTexto: { fontSize: 11, fontWeight: '700' },
  seloTextoPendente: { color: cores.acentoTexto },
  seloTextoEntregue: { color: neutro[700] },
});
