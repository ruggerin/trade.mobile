import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { listarOrdensServicoPendentes } from '../lib/api/ordensServico';
import { listarPontosVenda } from '../lib/api/pontosVenda';
import { useAuth } from '../lib/auth/AuthContext';
import { listarVisitasLocaisAbertas } from '../lib/visitaLocal';
import { useAoAtualizarFilaEnvio } from '../lib/useFilaEnvioAtualizada';
import type { PontosVendaStackParamList } from '../navigation/PontosVendaStack';
import type { OrdemServico, PontoVenda } from '../types/api';

type Props = NativeStackScreenProps<PontosVendaStackParamList, 'PontosVendaLista'>;
type ModoExibicao = 'lista' | 'mapa';

// docs/05-APP-MOBILE-UX.md §3.3 — card com fantasia/razão social/bairro, busca, estados
// carregando/vazio/busca-sem-resultado/erro-com-retry, banner de visita em aberto, alternância
// lista↔mapa. O doc pede "mapa com clusters de PDVs" — implementado sem cluster de propósito
// (nenhuma lib de clustering instalada ainda); com poucas dezenas de PDVs por empresa isso não
// costuma virar problema visual, mas é uma simplificação consciente, não um esquecimento.
export function PontosVendaListScreen({ navigation }: Props) {
  const { usuario } = useAuth();
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState('');
  const [modo, setModo] = useState<ModoExibicao>('lista');

  const query = useQuery({
    queryKey: ['pontos-venda', busca],
    queryFn: () => listarPontosVenda(busca || undefined),
  });

  // Vem da fila local (RASCUNHO/CHECKIN_ENVIADO/FINALIZADA_LOCAL), não da API — funciona
  // offline e reflete visitas que ainda nem chegaram no servidor. Ver docs/04-APP-MOBILE.md
  // "Fila offline de envio". Só pode haver uma por vez na prática, mas nada trava duas — isso
  // aqui é só o banner de UX, pega a mais recente.
  const visitaAbertaQuery = useQuery({
    queryKey: ['visitas-locais-abertas', usuario?.id],
    queryFn: () => listarVisitasLocaisAbertas(usuario!.id),
    enabled: Boolean(usuario),
  });
  useAoAtualizarFilaEnvio(() => void queryClient.invalidateQueries({ queryKey: ['visitas-locais-abertas'] }));
  const visitaAberta = visitaAbertaQuery.data?.[0] ?? null;
  const pontosVenda = query.data?.pontos_venda ?? [];

  // Badge "Pendência" no card do PDV (docs/07-ORDEM-DE-SERVICO.md §4) — quando existe mais de
  // uma OS pendente pro mesmo PDV, usa a primeira só pra decidir qual vincular automaticamente
  // no check-in (raro na prática, mas evita a tela travar esperando o promotor escolher).
  const pendenciasQuery = useQuery({
    queryKey: ['ordens-servico', 'pendentes'],
    queryFn: listarOrdensServicoPendentes,
  });
  const pendenciaPorPdv = useMemo(() => {
    const mapa = new Map<string, OrdemServico>();
    for (const os of pendenciasQuery.data ?? []) {
      if (!mapa.has(os.ponto_venda.id)) mapa.set(os.ponto_venda.id, os);
    }
    return mapa;
  }, [pendenciasQuery.data]);

  function irParaCheckin(pontoVenda: PontoVenda) {
    navigation.navigate('PontoVendaCheckin', { pontoVenda, ordemServico: pendenciaPorPdv.get(pontoVenda.id) });
  }

  return (
    <View style={styles.container}>
      {visitaAberta && (
        <Pressable
          style={({ pressed }) => [styles.banner, pressed && styles.bannerPressionado]}
          onPress={() => navigation.navigate('VisitaAndamento', { visitaLocalId: visitaAberta.id })}
        >
          <Text style={styles.bannerTexto}>
            Visita em andamento em {visitaAberta.pontoVenda.fantasia} — toque para continuar
          </Text>
        </Pressable>
      )}

      <TextInput
        style={styles.busca}
        value={busca}
        onChangeText={setBusca}
        placeholder="Buscar por nome, fantasia ou bairro"
        placeholderTextColor="#9ca3af"
        autoCapitalize="none"
      />

      <View style={styles.toggleRow}>
        <Pressable
          style={[styles.toggleBotao, modo === 'lista' && styles.toggleBotaoAtivo]}
          onPress={() => setModo('lista')}
        >
          <Text style={[styles.toggleTexto, modo === 'lista' && styles.toggleTextoAtivo]}>Lista</Text>
        </Pressable>
        <Pressable
          style={[styles.toggleBotao, modo === 'mapa' && styles.toggleBotaoAtivo]}
          onPress={() => setModo('mapa')}
        >
          <Text style={[styles.toggleTexto, modo === 'mapa' && styles.toggleTextoAtivo]}>Mapa</Text>
        </Pressable>
      </View>

      {query.isLoading && (
        <View style={styles.centro}>
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      )}

      {query.isError && (
        <View style={styles.centro}>
          <Text style={styles.erroTexto}>Não foi possível carregar os pontos de venda.</Text>
          <Pressable style={styles.botaoRetry} onPress={() => void query.refetch()}>
            <Text style={styles.botaoRetryTexto}>Tentar novamente</Text>
          </Pressable>
        </View>
      )}

      {query.isSuccess && pontosVenda.length === 0 && (
        <View style={styles.centro}>
          <Text style={styles.vazioTexto}>
            {busca ? 'Nenhum ponto de venda encontrado pra essa busca.' : 'Nenhum ponto de venda cadastrado ainda.'}
          </Text>
        </View>
      )}

      {query.isSuccess && pontosVenda.length > 0 && modo === 'lista' && (
        <FlatList
          data={pontosVenda}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.lista}
          renderItem={({ item }) => (
            <PontoVendaCard
              pontoVenda={item}
              pendencia={pendenciaPorPdv.get(item.id) ?? null}
              onPress={() => irParaCheckin(item)}
            />
          )}
        />
      )}

      {query.isSuccess && pontosVenda.length > 0 && modo === 'mapa' && (
        <MapaPontosVenda pontosVenda={pontosVenda} onSelecionar={irParaCheckin} />
      )}
    </View>
  );
}

function MapaPontosVenda({
  pontosVenda,
  onSelecionar,
}: {
  pontosVenda: PontoVenda[];
  onSelecionar: (pontoVenda: PontoVenda) => void;
}) {
  const regiaoInicial = useMemo(() => calcularRegiao(pontosVenda), [pontosVenda]);

  return (
    <MapView style={styles.mapa} initialRegion={regiaoInicial}>
      {pontosVenda.map((pontoVenda) => (
        <Marker
          key={pontoVenda.id}
          coordinate={{ latitude: pontoVenda.latitude, longitude: pontoVenda.longitude }}
          title={pontoVenda.fantasia}
          description={pontoVenda.bairro ?? undefined}
          onPress={() => onSelecionar(pontoVenda)}
        />
      ))}
    </MapView>
  );
}

// Enquadra todos os PDVs visíveis de uma vez — centro geográfico + folga de 50% sobre a maior
// dimensão (nunca menor que ~2km) pra não ficar colado nas bordas do mapa.
function calcularRegiao(pontosVenda: PontoVenda[]) {
  const latitudes = pontosVenda.map((p) => p.latitude);
  const longitudes = pontosVenda.map((p) => p.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLong = Math.min(...longitudes);
  const maxLong = Math.max(...longitudes);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLong + maxLong) / 2,
    latitudeDelta: Math.max(maxLat - minLat, 0.02) * 1.5,
    longitudeDelta: Math.max(maxLong - minLong, 0.02) * 1.5,
  };
}

function PontoVendaCard({
  pontoVenda,
  pendencia,
  onPress,
}: {
  pontoVenda: PontoVenda;
  pendencia: OrdemServico | null;
  onPress: () => void;
}) {
  const endereco = [pontoVenda.bairro, pontoVenda.cidade].filter(Boolean).join(' · ');
  // Usa a cor do tipo de visita quando definida — mesma tag colorida do admin web, ver
  // docs/10-AGENDA-VISITA.md. Sem tipo, cai no amarelo padrão de "Pendência".
  const corBadge = pendencia?.tipo_visita?.cor;

  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.cardPressionado]} onPress={onPress}>
      <View style={styles.cardTopo}>
        <Text style={styles.cardFantasia}>{pontoVenda.fantasia}</Text>
        {pendencia && (
          <View style={[styles.badgePendencia, corBadge ? { backgroundColor: corBadge } : null]}>
            <Text style={[styles.badgePendenciaTexto, corBadge ? { color: '#ffffff' } : null]}>
              {pendencia.tipo_visita?.descricao ?? 'Pendência'}
            </Text>
          </View>
        )}
      </View>
      <Text style={styles.cardRazaoSocial}>{pontoVenda.razao_social}</Text>
      {!!endereco && <Text style={styles.cardEndereco}>{endereco}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  banner: {
    backgroundColor: '#eff6ff',
    borderBottomWidth: 1,
    borderBottomColor: '#bfdbfe',
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 48,
    justifyContent: 'center',
  },
  bannerPressionado: {
    backgroundColor: '#dbeafe',
  },
  bannerTexto: {
    color: '#1d4ed8',
    fontSize: 14,
    fontWeight: '600',
  },
  busca: {
    marginHorizontal: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 16,
    minHeight: 48,
    fontSize: 16,
    backgroundColor: '#ffffff',
    color: '#111827',
  },
  toggleRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    padding: 4,
    gap: 4,
  },
  toggleBotao: {
    flex: 1,
    minHeight: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleBotaoAtivo: {
    backgroundColor: '#ffffff',
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  toggleTexto: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
  },
  toggleTextoAtivo: {
    color: '#111827',
  },
  mapa: {
    flex: 1,
    marginTop: 12,
  },
  lista: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 12,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    minHeight: 48,
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
  cardFantasia: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  badgePendencia: {
    backgroundColor: '#fef3c7',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgePendenciaTexto: {
    color: '#92400e',
    fontSize: 11,
    fontWeight: '700',
  },
  cardRazaoSocial: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 2,
  },
  cardEndereco: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 6,
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
