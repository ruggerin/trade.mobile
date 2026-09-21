import { MaterialCommunityIcons } from '@expo/vector-icons';
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
import { escolherOrdemDaLoja, listarOrdensServicoPendentes } from '../lib/api/ordensServico';
import { listarPontosVenda } from '../lib/api/pontosVenda';
import { useAuth } from '../lib/auth/AuthContext';
import { listarVisitasLocaisAbertas } from '../lib/visitaLocal';
import { useAoAtualizarFilaEnvio } from '../lib/useFilaEnvioAtualizada';
import type { PontosVendaStackParamList } from '../navigation/PontosVendaStack';
import type { OrdemServico, PontoVenda } from '../types/api';
import { cores, espaco, neutro, raio, sombraCard, tipografia } from '../theme';

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
    const porLoja = new Map<string, OrdemServico[]>();
    for (const os of pendenciasQuery.data ?? []) {
      porLoja.set(os.ponto_venda.id, [...(porLoja.get(os.ponto_venda.id) ?? []), os]);
    }
    const mapa = new Map<string, OrdemServico>();
    for (const [pdv, ordens] of porLoja) {
      const escolhida = escolherOrdemDaLoja(ordens);
      if (escolhida) mapa.set(pdv, escolhida);
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
            {visitaAberta.status === 'FINALIZADA_LOCAL'
              ? `Visita em ${visitaAberta.pontoVenda.fantasia} finalizada, aguardando envio — toque para ver`
              : `Visita em andamento em ${visitaAberta.pontoVenda.fantasia} — toque para continuar`}
          </Text>
        </Pressable>
      )}

      <View style={styles.buscaContainer}>
        <MaterialCommunityIcons name="magnify" size={20} color={cores.textoTerciario} />
        <TextInput
          style={styles.busca}
          value={busca}
          onChangeText={setBusca}
          placeholder="Buscar por nome, fantasia ou bairro"
          placeholderTextColor={cores.textoTerciario}
          autoCapitalize="none"
        />
      </View>

      <View style={styles.toggleRow}>
        <Pressable
          style={[styles.toggleBotao, modo === 'lista' && styles.toggleBotaoAtivo]}
          onPress={() => setModo('lista')}
        >
          <MaterialCommunityIcons
            name="format-list-bulleted"
            size={16}
            color={modo === 'lista' ? cores.primaria : cores.textoSecundario}
          />
          <Text style={[styles.toggleTexto, modo === 'lista' && styles.toggleTextoAtivo]}>Lista</Text>
        </Pressable>
        <Pressable
          style={[styles.toggleBotao, modo === 'mapa' && styles.toggleBotaoAtivo]}
          onPress={() => setModo('mapa')}
        >
          <MaterialCommunityIcons
            name="map-marker-radius-outline"
            size={16}
            color={modo === 'mapa' ? cores.primaria : cores.textoSecundario}
          />
          <Text style={[styles.toggleTexto, modo === 'mapa' && styles.toggleTextoAtivo]}>Mapa</Text>
        </Pressable>
      </View>

      {query.isLoading && (
        <View style={styles.centro}>
          <ActivityIndicator size="large" color={cores.primaria} />
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
  // Contexto de negócio rápido, sem precisar abrir o PDV — docs/26-MELHORIAS-PRODUTIVIDADE-PROMOTOR.md
  // §2 itens 2/3: rede/ramo já vinham no endpoint, só não apareciam na lista; checkouts é sinal
  // indireto de porte da loja (quanto tempo a visita deve levar).
  const contexto = [
    pontoVenda.rede_loja?.descricao,
    pontoVenda.ramo_atividade?.descricao,
    pontoVenda.numero_checkouts ? `${pontoVenda.numero_checkouts} checkouts` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  // Usa a cor do tipo de visita quando definida — mesma tag colorida do admin web, ver
  // docs/10-AGENDA-VISITA.md. Sem tipo, cai no amarelo padrão de "Pendência".
  const corBadge = pendencia?.tipo_visita?.cor;

  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.cardPressionado]} onPress={onPress}>
      <View style={styles.cardIcone}>
        <MaterialCommunityIcons name="storefront-outline" size={22} color={cores.primaria} />
      </View>
      <View style={styles.cardConteudo}>
        <View style={styles.cardTopo}>
          <Text style={styles.cardFantasia}>{pontoVenda.fantasia}</Text>
          {pendencia && (
            <View style={[styles.badgePendencia, corBadge ? { backgroundColor: corBadge } : null]}>
              <Text style={[styles.badgePendenciaTexto, corBadge ? { color: cores.branco } : null]}>
                {pendencia.tipo_visita?.descricao ?? 'Pendência'}
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.cardRazaoSocial}>{pontoVenda.razao_social}</Text>
        {!!endereco && <Text style={styles.cardEndereco}>{endereco}</Text>}
        {!!contexto && <Text style={styles.cardContexto}>{contexto}</Text>}
        {pontoVenda.tem_contrato_ativo && (
          <View style={styles.badgeContrato}>
            <MaterialCommunityIcons name="handshake-outline" size={12} color={cores.primaria} />
            <Text style={styles.badgeContratoTexto}>Comodato ativo</Text>
          </View>
        )}
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
  banner: {
    backgroundColor: cores.primariaClara,
    borderBottomWidth: 1,
    borderBottomColor: cores.primariaBorda,
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.md,
    minHeight: 48,
    justifyContent: 'center',
  },
  bannerPressionado: {
    backgroundColor: cores.primariaMedia,
  },
  bannerTexto: {
    color: cores.primariaEscura,
    fontSize: 14,
    fontWeight: '600',
  },
  buscaContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm,
    marginHorizontal: espaco.lg,
    marginTop: espaco.lg,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.md,
    paddingHorizontal: espaco.md,
    minHeight: 48,
    backgroundColor: cores.fundoCard,
  },
  busca: {
    flex: 1,
    fontSize: 16,
    color: cores.texto,
  },
  toggleRow: {
    flexDirection: 'row',
    marginHorizontal: espaco.lg,
    marginTop: espaco.md,
    backgroundColor: neutro[100],
    borderRadius: raio.md,
    padding: 4,
    gap: 4,
  },
  toggleBotao: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 40,
    borderRadius: raio.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleBotaoAtivo: {
    backgroundColor: cores.fundoCard,
    shadowColor: neutro[900],
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  toggleTexto: {
    fontSize: 14,
    fontWeight: '600',
    color: cores.textoSecundario,
  },
  toggleTextoAtivo: {
    color: cores.texto,
  },
  mapa: {
    flex: 1,
    marginTop: espaco.md,
  },
  lista: {
    paddingHorizontal: espaco.lg,
    paddingTop: espaco.lg,
    paddingBottom: espaco.xl,
    gap: espaco.md,
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
    ...sombraCard,
  },
  cardPressionado: {
    backgroundColor: neutro[100],
  },
  cardIcone: {
    width: 44,
    height: 44,
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
  cardFantasia: {
    ...tipografia.destaque,
    flex: 1,
    fontSize: 16,
    color: cores.texto,
  },
  badgePendencia: {
    backgroundColor: cores.acentoMedio,
    borderRadius: raio.sm,
    paddingHorizontal: espaco.sm,
    paddingVertical: 3,
  },
  badgePendenciaTexto: {
    color: cores.acentoTexto,
    fontSize: 11,
    fontWeight: '700',
  },
  cardRazaoSocial: {
    fontSize: 14,
    color: cores.textoSecundario,
    marginTop: 2,
  },
  cardEndereco: {
    fontSize: 13,
    color: cores.textoTerciario,
    marginTop: espaco.xs,
  },
  cardContexto: {
    fontSize: 12,
    color: cores.textoTerciario,
    marginTop: espaco.xs,
  },
  badgeContrato: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: cores.primariaClara,
    borderRadius: raio.sm,
    paddingHorizontal: espaco.sm,
    paddingVertical: 2,
    marginTop: espaco.xs,
  },
  badgeContratoTexto: {
    color: cores.primariaEscura,
    fontSize: 11,
    fontWeight: '700',
  },
  centro: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: espaco.xxl,
    paddingTop: espaco.xxl * 1.5,
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
