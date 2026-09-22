import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { listarMinhasVisitas } from '../lib/api/visitas';
import { useAuth } from '../lib/auth/AuthContext';
import { useAoAtualizarFilaEnvio } from '../lib/useFilaEnvioAtualizada';
import { useDescarteVisita } from '../lib/useDescarteVisita';
import {
  listarVisitasLocaisPendentesOuRejeitadas,
  tentarEnviarAgora,
  type VisitaLocal,
} from '../lib/visitaLocal';
import type { HistoricoStackParamList } from '../navigation/HistoricoStack';
import type { StatusVisita, Visita } from '../types/api';
import { cores, espaco, raio, sombraCard, tipografia } from '../theme';

type Props = NativeStackScreenProps<HistoricoStackParamList, 'HistoricoLista'>;
type IconeMdi = keyof typeof MaterialCommunityIcons.glyphMap;

const STATUS_INFO: Record<StatusVisita, { label: string; bg: string; texto: string; icone: IconeMdi }> = {
  ABERTA: { label: 'Aberta', bg: cores.primariaClara, texto: cores.primariaEscura, icone: 'progress-clock' },
  FINALIZADA: { label: 'Finalizada', bg: cores.sucessoFundo, texto: cores.sucesso, icone: 'check-circle-outline' },
  CANCELADA: { label: 'Cancelada', bg: cores.divisor, texto: cores.textoSecundario, icone: 'close-circle-outline' },
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

  // Descarte seguro (cancela no servidor / pede autorização do gestor) — ver lib/useDescarteVisita.tsx.
  const descarteSeguro = useDescarteVisita();

  const tentarMutation = useMutation({
    mutationFn: () => tentarEnviarAgora(usuario!.id),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['visitas-locais-pendentes'] }),
  });

  const locais = locaisQuery.data ?? [];
  const semNadaAMostrar = locais.length === 0 && query.data?.visitas.length === 0;

  return (
    <View style={styles.container}>
      {query.isLoading && locais.length === 0 && (
        <View style={styles.centro}>
          <ActivityIndicator size="large" color={cores.primaria} />
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
          <MaterialCommunityIcons name="clipboard-text-clock-outline" size={40} color={cores.textoTerciario} />
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
                  descartando={descarteSeguro.ocupado}
                  tentando={tentarMutation.isPending}
                  onDescartar={() => descarteSeguro.descartar(visita)}
                  onTentar={() => tentarMutation.mutate()}
                />
              ))}
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <VisitaCard visita={item} onPress={() => navigation.navigate('VisitaDetalhe', { visitaId: item.id, visita: item })} />
        )}
      />
      {descarteSeguro.elemento}
    </View>
  );
}

// Em que passo a visita está parada — sem isso o card só dizia "Aguardando envio", sem pista do que
// travou nem o que fazer.
function etapaDaVisita(visita: VisitaLocal): string {
  if (visita.status === 'REJEITADA') return 'Check-in recusado';
  if (!visita.servidorId) return 'Enviando o check-in';
  if (visita.status === 'FINALIZADA_LOCAL') return 'Enviando o checkout';
  return 'Visita em andamento (ainda não finalizada)';
}

function VisitaLocalCard({
  visita,
  descartando,
  tentando,
  onDescartar,
  onTentar,
}: {
  visita: VisitaLocal;
  descartando: boolean;
  tentando: boolean;
  onDescartar: () => void;
  onTentar: () => void;
}) {
  const rejeitada = visita.status === 'REJEITADA';

  return (
    <View style={[styles.card, rejeitada && styles.cardRejeitada]}>
      <View style={styles.cardIcone}>
        <MaterialCommunityIcons
          name={rejeitada ? 'alert-circle-outline' : 'cloud-upload-outline'}
          size={20}
          color={rejeitada ? cores.erro : cores.primaria}
        />
      </View>
      <View style={styles.cardConteudo}>
        <View style={styles.cardTopo}>
          <Text style={styles.cardPdv} numberOfLines={1}>
            {visita.pontoVenda.fantasia}
          </Text>
          <View style={[styles.badge, { backgroundColor: rejeitada ? cores.erroFundo : cores.primariaClara }]}>
            <Text style={[styles.badgeTexto, { color: rejeitada ? cores.erro : cores.primariaEscura }]}>
              {rejeitada ? 'Rejeitada' : 'Aguardando envio'}
            </Text>
          </View>
        </View>
        <Text style={styles.cardData}>
          {new Date(visita.inicioEm).toLocaleDateString('pt-BR')} às{' '}
          {new Date(visita.inicioEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </Text>
        <Text style={styles.cardData}>{etapaDaVisita(visita)}</Text>
        {!!visita.erro && <Text style={styles.cardErro}>{visita.erro}</Text>}
        <View style={{ flexDirection: 'row', gap: espaco.sm, flexWrap: 'wrap' }}>
          {!rejeitada && visita.status !== 'CHECKIN_ENVIADO' && (
            <Pressable
              style={[styles.botaoDescartar, (tentando || descartando) && styles.botaoDesabilitado]}
              onPress={onTentar}
              disabled={tentando || descartando}
            >
              <Text style={styles.botaoDescartarTexto}>{tentando ? 'Enviando...' : 'Tentar enviar agora'}</Text>
            </Pressable>
          )}
          <Pressable
            style={[styles.botaoDescartar, descartando && styles.botaoDesabilitado]}
            onPress={onDescartar}
            disabled={descartando}
          >
            <Text style={styles.botaoDescartarTexto}>{descartando ? 'Descartando...' : 'Descartar'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function VisitaCard({ visita, onPress }: { visita: Visita; onPress: () => void }) {
  const data = new Date(visita.inicio_data);
  const status = STATUS_INFO[visita.status];
  const totalRegistros = visita.registros_count ?? visita.registros?.length ?? 0;

  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.cardPressionado]} onPress={onPress}>
      <View style={[styles.cardIcone, { backgroundColor: status.bg }]}>
        <MaterialCommunityIcons name={status.icone} size={20} color={status.texto} />
      </View>
      <View style={styles.cardConteudo}>
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
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={cores.textoTerciario} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: cores.fundo,
  },
  lista: {
    padding: espaco.lg,
    gap: espaco.md,
  },
  secaoLocal: {
    gap: espaco.sm,
    marginBottom: espaco.sm,
  },
  secaoLocalTitulo: {
    ...tipografia.rotulo,
    color: cores.textoSecundario,
    marginBottom: 2,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    backgroundColor: cores.fundoCard,
    borderRadius: raio.lg,
    padding: espaco.md,
    borderWidth: 1,
    borderColor: cores.borda,
    minHeight: 48,
    marginBottom: espaco.md,
    ...sombraCard,
  },
  cardRejeitada: {
    borderColor: cores.erroBorda,
  },
  cardPressionado: {
    backgroundColor: cores.divisor,
  },
  cardIcone: {
    width: 40,
    height: 40,
    borderRadius: raio.md,
    backgroundColor: cores.primariaClara,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardConteudo: {
    flex: 1,
  },
  cardTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: espaco.sm,
  },
  cardPdv: {
    ...tipografia.destaque,
    flex: 1,
    fontSize: 16,
    color: cores.texto,
  },
  cardData: {
    fontSize: 14,
    color: cores.textoSecundario,
    marginTop: espaco.xs,
  },
  cardRegistros: {
    fontSize: 13,
    color: cores.textoTerciario,
    marginTop: 2,
  },
  cardErro: {
    fontSize: 13,
    color: cores.erro,
    marginTop: espaco.xs,
  },
  botaoDescartar: {
    marginTop: espaco.sm,
    alignSelf: 'flex-start',
    minHeight: 36,
    paddingHorizontal: espaco.md,
    justifyContent: 'center',
    borderRadius: raio.sm,
    backgroundColor: cores.erro,
  },
  botaoDesabilitado: {
    opacity: 0.6,
  },
  botaoDescartarTexto: {
    color: cores.branco,
    fontWeight: '700',
    fontSize: 13,
  },
  badge: {
    borderRadius: raio.sm,
    paddingHorizontal: espaco.sm,
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
    paddingHorizontal: espaco.xxl,
    paddingTop: espaco.xxl * 1.5,
    gap: espaco.md,
  },
  erroTexto: {
    fontSize: 15,
    color: cores.erro,
    textAlign: 'center',
    marginBottom: espaco.lg,
  },
  vazioTexto: {
    fontSize: 15,
    color: cores.textoSecundario,
    textAlign: 'center',
  },
  botaoRetry: {
    backgroundColor: cores.primaria,
    borderRadius: raio.md,
    paddingHorizontal: espaco.xl,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoRetryTexto: {
    color: cores.onPrimaria,
    fontWeight: '700',
    fontSize: 15,
  },
});
