import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { listarMinhasVisitas } from '../lib/api/visitas';
import { useAuth } from '../lib/auth/AuthContext';
import { useAoAtualizarFilaEnvio } from '../lib/useFilaEnvioAtualizada';
import { descartarVisitaRejeitada, listarVisitasLocaisPendentesOuRejeitadas, type VisitaLocal } from '../lib/visitaLocal';
import type { HistoricoStackParamList } from '../navigation/HistoricoStack';
import type { StatusVisita, Visita } from '../types/api';

type Props = NativeStackScreenProps<HistoricoStackParamList, 'HistoricoLista'>;

const STATUS_INFO: Record<StatusVisita, { label: string; bg: string; texto: string }> = {
  ABERTA: { label: 'Aberta', bg: '#eff6ff', texto: '#1d4ed8' },
  FINALIZADA: { label: 'Finalizada', bg: '#f0fdf4', texto: '#15803d' },
  CANCELADA: { label: 'Cancelada', bg: '#f3f4f6', texto: '#6b7280' },
};

// docs/05-APP-MOBILE-UX.md §3.7 — visitas do próprio promotor, mais recentes primeiro. Além da
// lista já confirmada pelo servidor, mostra no topo o que ainda está na fila de envio local
// (aguardando sinal) ou foi rejeitado (ver docs/04-APP-MOBILE.md "Fila offline de envio") — sem
// isso, uma visita coletada em campo sem sinal "sumiria" da visão do promotor até sincronizar.
export function HistoricoScreen({ navigation }: Props) {
  const { usuario } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['visitas', 'historico'],
    queryFn: listarMinhasVisitas,
  });

  const locaisQuery = useQuery({
    queryKey: ['visitas-locais-pendentes', usuario?.id],
    queryFn: () => listarVisitasLocaisPendentesOuRejeitadas(usuario!.id),
    enabled: Boolean(usuario),
  });
  useAoAtualizarFilaEnvio(() => void queryClient.invalidateQueries({ queryKey: ['visitas-locais-pendentes'] }));

  const descartarMutation = useMutation({
    mutationFn: (id: string) => descartarVisitaRejeitada(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['visitas-locais-pendentes'] }),
    onError: () => Alert.alert('Erro', 'Não foi possível descartar esta visita. Tente de novo.'),
  });

  function confirmarDescarte(visita: VisitaLocal) {
    Alert.alert(
      'Descartar visita',
      `O check-in em ${visita.pontoVenda.fantasia} foi recusado${visita.erro ? `: ${visita.erro}` : ''}. Os registros feitos (inclusive fotos) serão perdidos. Descartar mesmo assim?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Descartar', style: 'destructive', onPress: () => descartarMutation.mutate(visita.id) },
      ],
    );
  }

  const locais = locaisQuery.data ?? [];
  const semNadaAMostrar = locais.length === 0 && query.data?.visitas.length === 0;

  return (
    <View style={styles.container}>
      {query.isLoading && locais.length === 0 && (
        <View style={styles.centro}>
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      )}

      {query.isError && locais.length === 0 && (
        <View style={styles.centro}>
          <Text style={styles.erroTexto}>Não foi possível carregar seu histórico.</Text>
          <Pressable style={styles.botaoRetry} onPress={() => void query.refetch()}>
            <Text style={styles.botaoRetryTexto}>Tentar novamente</Text>
          </Pressable>
        </View>
      )}

      {semNadaAMostrar && (
        <View style={styles.centro}>
          <Text style={styles.vazioTexto}>Você ainda não fez nenhuma visita.</Text>
        </View>
      )}

      <FlatList
        data={query.data?.visitas ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.lista}
        ListHeaderComponent={
          locais.length > 0 ? (
            <View style={styles.secaoLocal}>
              <Text style={styles.secaoLocalTitulo}>Aguardando envio</Text>
              {locais.map((visita) => (
                <VisitaLocalCard
                  key={visita.id}
                  visita={visita}
                  descartando={descartarMutation.isPending}
                  onDescartar={() => confirmarDescarte(visita)}
                />
              ))}
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <VisitaCard visita={item} onPress={() => navigation.navigate('VisitaDetalhe', { visita: item })} />
        )}
      />
    </View>
  );
}

function VisitaLocalCard({
  visita,
  descartando,
  onDescartar,
}: {
  visita: VisitaLocal;
  descartando: boolean;
  onDescartar: () => void;
}) {
  const rejeitada = visita.status === 'REJEITADA';

  return (
    <View style={[styles.card, rejeitada && styles.cardRejeitada]}>
      <View style={styles.cardTopo}>
        <Text style={styles.cardPdv} numberOfLines={1}>
          {visita.pontoVenda.fantasia}
        </Text>
        <View style={[styles.badge, { backgroundColor: rejeitada ? '#fef2f2' : '#eff6ff' }]}>
          <Text style={[styles.badgeTexto, { color: rejeitada ? '#b91c1c' : '#1d4ed8' }]}>
            {rejeitada ? 'Rejeitada' : 'Aguardando envio'}
          </Text>
        </View>
      </View>
      <Text style={styles.cardData}>
        {new Date(visita.inicioEm).toLocaleDateString('pt-BR')} às{' '}
        {new Date(visita.inicioEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
      </Text>
      {rejeitada && visita.erro && <Text style={styles.cardErro}>{visita.erro}</Text>}
      {rejeitada && (
        <Pressable
          style={[styles.botaoDescartar, descartando && styles.botaoDesabilitado]}
          onPress={onDescartar}
          disabled={descartando}
        >
          <Text style={styles.botaoDescartarTexto}>{descartando ? 'Descartando...' : 'Descartar'}</Text>
        </Pressable>
      )}
    </View>
  );
}

function VisitaCard({ visita, onPress }: { visita: Visita; onPress: () => void }) {
  const data = new Date(visita.inicio_data);
  const status = STATUS_INFO[visita.status];
  const totalRegistros = visita.registros_count ?? visita.registros?.length ?? 0;

  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.cardPressionado]} onPress={onPress}>
      <View style={styles.cardTopo}>
        <Text style={styles.cardPdv} numberOfLines={1}>
          {visita.ponto_venda?.fantasia}
        </Text>
        <View style={[styles.badge, { backgroundColor: status.bg }]}>
          <Text style={[styles.badgeTexto, { color: status.texto }]}>{status.label}</Text>
        </View>
      </View>
      <Text style={styles.cardData}>
        {data.toLocaleDateString('pt-BR')} às{' '}
        {data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
      </Text>
      <Text style={styles.cardRegistros}>
        {totalRegistros} registro{totalRegistros === 1 ? '' : 's'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  lista: {
    padding: 16,
    gap: 12,
  },
  secaoLocal: {
    gap: 8,
    marginBottom: 8,
  },
  secaoLocalTitulo: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    minHeight: 48,
    marginBottom: 12,
  },
  cardRejeitada: {
    borderColor: '#fecaca',
  },
  cardPressionado: {
    backgroundColor: '#f3f4f6',
  },
  cardTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardPdv: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  cardData: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 6,
  },
  cardRegistros: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 2,
  },
  cardErro: {
    fontSize: 13,
    color: '#b91c1c',
    marginTop: 6,
  },
  botaoDescartar: {
    marginTop: 10,
    alignSelf: 'flex-start',
    minHeight: 36,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#b91c1c',
  },
  botaoDesabilitado: {
    opacity: 0.6,
  },
  botaoDescartarTexto: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeTexto: {
    fontSize: 12,
    fontWeight: '700',
  },
  centro: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 48,
  },
  erroTexto: {
    fontSize: 15,
    color: '#b91c1c',
    textAlign: 'center',
    marginBottom: 16,
  },
  vazioTexto: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
  },
  botaoRetry: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingHorizontal: 20,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoRetryTexto: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
});
