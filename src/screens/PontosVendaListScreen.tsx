import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { escolherOrdemDaLoja, listarOrdensServicoPendentes } from '../lib/api/ordensServico';
import { listarPontosVenda } from '../lib/api/pontosVenda';
import { BotaoNotificacoes } from '../components/BotaoNotificacoes';
import { useAuth } from '../lib/auth/AuthContext';
import { calcularDistanciaMetros } from '../lib/location/distancia';
import { useLocalizacaoAtual } from '../lib/location/useLocalizacaoAtual';
import { listarVisitasLocaisAbertas } from '../lib/visitaLocal';
import { useAoAtualizarFilaEnvio } from '../lib/useFilaEnvioAtualizada';
import { useRecarregarAoFocar } from '../lib/useRecarregarAoFocar';
import type { PontosVendaStackParamList } from '../navigation/PontosVendaStack';
import type { OrdemServico, PontoVenda } from '../types/api';
import { cores, espaco, indigo, neutro, raio, tipografia } from '../theme';

type Props = NativeStackScreenProps<PontosVendaStackParamList, 'PontosVendaLista'>;
type ModoExibicao = 'lista' | 'mapa';
type Filtro = 'todas' | 'pendencia' | 'perto';

const RAIO_PERTO_METROS = 1500;

function formatarDistancia(metros: number): string {
  return `${(metros / 1000).toFixed(1).replace('.', ',')} km`;
}

// "32 min" / "1h 12min" — mesmo formato do cronômetro da Visita em Andamento, só calculado uma
// vez (aqui é lista, não precisa recalcular por segundo).
function duracaoDesde(inicioISO: string): string {
  const seg = Math.max(0, Math.floor((Date.now() - new Date(inicioISO).getTime()) / 1000));
  const h = Math.floor(seg / 3600);
  const min = Math.floor(seg / 60) % 60;
  return h > 0 ? `${h}h ${String(min).padStart(2, '0')}min` : `${min} min`;
}

interface DefinicaoFiltro {
  chave: Filtro;
  label: string;
  aplica: (p: PontoVenda, temPendencia: boolean, distanciaMetros: number | null) => boolean;
}

const FILTRO_TODAS: DefinicaoFiltro = { chave: 'todas', label: 'Todas', aplica: () => true };
const FILTRO_PENDENCIA: DefinicaoFiltro = {
  chave: 'pendencia',
  label: 'Com pendência',
  aplica: (_p, temPendencia) => temPendencia,
};
// Só entra na lista de chips quando há localização — ver FILTROS no componente.
const FILTRO_PERTO: DefinicaoFiltro = {
  chave: 'perto',
  label: 'Até 1,5 km',
  aplica: (_p, _temPendencia, distanciaMetros) => distanciaMetros !== null && distanciaMetros <= RAIO_PERTO_METROS,
};
const FILTROS_BASE: DefinicaoFiltro[] = [FILTRO_TODAS, FILTRO_PENDENCIA];

// docs/05-APP-MOBILE-UX.md §3.3 — card com fantasia/razão social/bairro, busca, estados
// carregando/vazio/busca-sem-resultado/erro-com-retry, banner de visita em aberto, alternância
// lista↔mapa. O doc pede "mapa com clusters de PDVs" — implementado sem cluster de propósito
// (nenhuma lib de clustering instalada ainda); com poucas dezenas de PDVs por empresa isso não
// costuma virar problema visual, mas é uma simplificação consciente, não um esquecimento.
export function PontosVendaListScreen({ navigation }: Props) {
  const { usuario } = useAuth();
  const queryClient = useQueryClient();
  // Header nativo desligado nesta tela (ver PontosVendaStack.tsx) — o cabeçalho próprio precisa
  // do inset do topo manualmente, sem ele o texto entra embaixo da barra de status/notch.
  const insets = useSafeAreaInsets();
  const [busca, setBusca] = useState('');
  const [modo, setModo] = useState<ModoExibicao>('lista');
  const [filtro, setFiltro] = useState<Filtro>('todas');

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

  // Distância só aparece quando a localização está disponível — a lista funciona igual sem ela
  // (offline-first), nunca trava esperando o GPS nem mostra permissão negada aqui (diferente do
  // check-in, onde a localização é obrigatória pra confirmar presença na loja).
  const localizacao = useLocalizacaoAtual();
  const distanciaPorPdv = useMemo(() => {
    const mapa = new Map<string, number>();
    if (!localizacao.coords) return mapa;
    for (const p of pontosVenda) {
      mapa.set(p.id, calcularDistanciaMetros(localizacao.coords.latitude, localizacao.coords.longitude, p.latitude, p.longitude));
    }
    return mapa;
  }, [pontosVenda, localizacao.coords]);
  const FILTROS = useMemo(
    () => (localizacao.coords ? [FILTRO_TODAS, FILTRO_PENDENCIA, FILTRO_PERTO] : FILTROS_BASE),
    [localizacao.coords],
  );

  // Badge "Pendência" no card do PDV (docs/07-ORDEM-DE-SERVICO.md §4) — quando existe mais de
  // uma OS pendente pro mesmo PDV, usa a primeira só pra decidir qual vincular automaticamente
  // no check-in (raro na prática, mas evita a tela travar esperando o promotor escolher).
  const pendenciasQuery = useQuery({
    queryKey: ['ordens-servico', 'pendentes'],
    queryFn: listarOrdensServicoPendentes,
  });

  // Voltar pra aba recarrega lojas + badge de pendência (loja/OS alterada no admin só aparecia
  // reabrindo o app) — ver lib/useRecarregarAoFocar.ts.
  const { atualizando: puxandoParaAtualizar, puxarParaAtualizar } = useRecarregarAoFocar(query.refetch, pendenciasQuery.refetch);
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

  // Contagem de cada filtro sobre a busca atual — mostrada ao lado do rótulo do chip, mesmo
  // padrão do protótipo ("Com pendência 2"), pra dar uma prévia sem precisar tocar.
  const contagemFiltro = (chave: Filtro) => {
    const def = FILTROS.find((f) => f.chave === chave)!;
    return pontosVenda.filter((p) => def.aplica(p, pendenciaPorPdv.has(p.id), distanciaPorPdv.get(p.id) ?? null)).length;
  };
  // Se o filtro "Até 1,5 km" estava ativo e a localização some depois (GPS desligado, permissão
  // revogada), esse chip deixa de existir em FILTROS — cai pra "Todas" em vez de quebrar o find.
  const filtroAtivo = FILTROS.find((f) => f.chave === filtro) ?? FILTROS_BASE[0];
  const pontosVendaFiltrados = pontosVenda
    .filter((p) => filtroAtivo.aplica(p, pendenciaPorPdv.has(p.id), distanciaPorPdv.get(p.id) ?? null))
    // Mais perto primeiro, quando a localização está disponível — sem ela, mantém a ordem que a
    // API já devolveu (mesmo comportamento de antes desta mudança).
    .sort((a, b) =>
      localizacao.coords ? (distanciaPorPdv.get(a.id) ?? Infinity) - (distanciaPorPdv.get(b.id) ?? Infinity) : 0,
    );
  const nComPendencia = pontosVenda.filter((p) => pendenciaPorPdv.has(p.id)).length;

  return (
    <View style={styles.container}>
      <View style={[styles.cabecalho, { paddingTop: insets.top + espaco.sm }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.tituloTela}>Lojas</Text>
          <Text style={styles.resumoTexto}>
            {pontosVenda.length} loja(s) na sua carteira
            {nComPendencia > 0 ? ` · ${nComPendencia} com pendência` : ''}
          </Text>
        </View>
        <BotaoNotificacoes />
      </View>

      {visitaAberta && (
        <Pressable
          style={({ pressed }) => [styles.banner, pressed && styles.bannerPressionado]}
          onPress={() => navigation.navigate('VisitaAndamento', { visitaLocalId: visitaAberta.id })}
        >
          <View style={styles.bannerIconeCirculo}>
            <MaterialCommunityIcons name="clock-outline" size={18} color={cores.branco} />
          </View>
          <View style={styles.bannerTextos}>
            <Text style={styles.bannerRotulo}>
              {visitaAberta.status === 'FINALIZADA_LOCAL'
                ? 'Finalizada · aguardando envio'
                : `Em andamento · ${duracaoDesde(visitaAberta.inicioEm)}`}
            </Text>
            <Text style={styles.bannerNome} numberOfLines={1}>
              {visitaAberta.pontoVenda.fantasia}
            </Text>
          </View>
          <Text style={styles.bannerLink}>{visitaAberta.status === 'FINALIZADA_LOCAL' ? 'Ver' : 'Continuar'}</Text>
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

      {/* Fileira que QUEBRA linha em vez de rolar de lado — com "Até 1,5 km" entrando às vezes
          (4 chips), uma lista horizontal cortava o último chip na borda da tela; sem rolagem,
          nada fica escondido/cortado, só ocupa uma segunda linha quando não cabe numa só. */}
      <View style={styles.filtrosLinha}>
        {FILTROS.map((f) => {
          const ativo = filtro === f.chave;
          return (
            <Pressable
              key={f.chave}
              style={[styles.filtroChip, ativo && styles.filtroChipAtivo]}
              onPress={() => setFiltro(f.chave)}
            >
              <Text style={[styles.filtroChipTexto, ativo && styles.filtroChipTextoAtivo]}>{f.label}</Text>
              <Text style={[styles.filtroChipContagem, ativo && styles.filtroChipTextoAtivo]}>{contagemFiltro(f.chave)}</Text>
            </Pressable>
          );
        })}
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

      {query.isSuccess && pontosVenda.length > 0 && pontosVendaFiltrados.length === 0 && (
        <View style={styles.centro}>
          <Text style={styles.vazioTexto}>Nenhuma loja nesse filtro.</Text>
        </View>
      )}

      {query.isSuccess && pontosVendaFiltrados.length > 0 && modo === 'lista' && (
        <FlatList
          data={pontosVendaFiltrados}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.lista}
          refreshControl={
            <RefreshControl refreshing={puxandoParaAtualizar} onRefresh={puxarParaAtualizar} colors={[cores.primaria]} />
          }
          renderItem={({ item }) => (
            <PontoVendaCard
              pontoVenda={item}
              pendencia={pendenciaPorPdv.get(item.id) ?? null}
              distanciaMetros={distanciaPorPdv.get(item.id) ?? null}
              onPress={() => irParaCheckin(item)}
            />
          )}
        />
      )}

      {query.isSuccess && pontosVendaFiltrados.length > 0 && modo === 'mapa' && (
        <MapaPontosVenda pontosVenda={pontosVendaFiltrados} onSelecionar={irParaCheckin} />
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
  distanciaMetros,
  onPress,
}: {
  pontoVenda: PontoVenda;
  pendencia: OrdemServico | null;
  distanciaMetros: number | null;
  onPress: () => void;
}) {
  const endereco = [pontoVenda.bairro, pontoVenda.cidade].filter(Boolean).join(' · ');
  const iniciais = pontoVenda.fantasia
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
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
        <Text style={styles.cardIconeTexto}>{iniciais}</Text>
      </View>
      <View style={styles.cardConteudo}>
        <View style={styles.cardTopo}>
          <Text style={styles.cardFantasia} numberOfLines={1}>
            {pontoVenda.fantasia}
          </Text>
          {distanciaMetros !== null && <Text style={styles.cardDistancia}>{formatarDistancia(distanciaMetros)}</Text>}
        </View>
        <Text style={styles.cardRazaoSocial} numberOfLines={1}>
          {pontoVenda.razao_social}
        </Text>
        {!!endereco && (
          <Text style={styles.cardEndereco} numberOfLines={1}>
            {endereco}
          </Text>
        )}
        {(pendencia || pontoVenda.tem_contrato_ativo) && (
          <View style={styles.tagsLinha}>
            {pendencia && (
              <View style={[styles.badgePendencia, corBadge ? { backgroundColor: corBadge } : null]}>
                <View style={[styles.badgePendenciaPonto, corBadge ? { backgroundColor: cores.branco } : null]} />
                <Text style={[styles.badgePendenciaTexto, corBadge ? { color: cores.branco } : null]}>
                  {pendencia.tipo_visita?.descricao ?? 'Pendência'}
                </Text>
              </View>
            )}
            {pontoVenda.tem_contrato_ativo && (
              <View style={styles.badgeContrato}>
                <MaterialCommunityIcons name="handshake-outline" size={12} color={cores.primaria} />
                <Text style={styles.badgeContratoTexto}>Comodato ativo</Text>
              </View>
            )}
          </View>
        )}
        {!!contexto && (
          <Text style={styles.cardContexto} numberOfLines={1}>
            {contexto}
          </Text>
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
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: espaco.lg,
    paddingTop: espaco.md,
    paddingBottom: 2,
    backgroundColor: cores.fundo,
  },
  tituloTela: {
    ...tipografia.tituloGrande,
    color: cores.texto,
  },
  resumoTexto: {
    fontSize: 13,
    color: cores.textoSecundario,
    marginTop: 2,
  },
  filtrosLinha: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: espaco.sm,
    paddingHorizontal: espaco.lg,
    marginTop: espaco.md,
  },
  filtroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: espaco.md,
    borderRadius: raio.pill,
    borderWidth: 1,
    borderColor: cores.borda,
    backgroundColor: cores.fundoCard,
  },
  filtroChipAtivo: {
    backgroundColor: cores.primaria,
    borderColor: cores.primaria,
  },
  filtroChipTexto: {
    fontSize: 13,
    fontWeight: '600',
    color: neutro[700],
  },
  filtroChipContagem: {
    fontSize: 12,
    fontWeight: '700',
    color: neutro[500],
  },
  filtroChipTextoAtivo: {
    color: cores.onPrimaria,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    backgroundColor: cores.primaria,
    borderRadius: raio.lg,
    marginHorizontal: espaco.lg,
    marginTop: espaco.md,
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm + 2,
    minHeight: 60,
  },
  bannerPressionado: {
    opacity: 0.9,
  },
  bannerIconeCirculo: {
    width: 38,
    height: 38,
    borderRadius: raio.md,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerTextos: {
    flex: 1,
    minWidth: 0,
  },
  bannerRotulo: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: indigo[200],
  },
  bannerNome: {
    fontSize: 15,
    fontWeight: '700',
    color: cores.branco,
    marginTop: 1,
  },
  bannerLink: {
    fontSize: 14,
    fontWeight: '700',
    color: cores.branco,
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
    paddingTop: espaco.md,
    paddingBottom: espaco.xl,
    gap: espaco.sm,
  },
  // Sem sombra de propósito — só borda 1px. Card "flat", normalizado com o mesmo padding/raio/gap
  // do card da lista de Histórico (HistoricoScreen.tsx).
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm,
    backgroundColor: cores.fundoCard,
    borderRadius: raio.md,
    padding: 10,
    borderWidth: 1,
    borderColor: cores.borda,
    minHeight: 48,
  },
  cardPressionado: {
    backgroundColor: neutro[100],
  },
  cardIcone: {
    width: 40,
    height: 40,
    borderRadius: raio.md,
    backgroundColor: cores.primariaClara,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIconeTexto: {
    fontSize: 15,
    fontWeight: '800',
    color: cores.primariaEscura,
  },
  cardConteudo: {
    flex: 1,
  },
  cardTopo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: espaco.sm,
  },
  cardFantasia: {
    ...tipografia.destaque,
    flex: 1,
    fontSize: 16,
    color: cores.texto,
  },
  cardDistancia: {
    fontSize: 13,
    fontWeight: '700',
    color: cores.textoSecundario,
  },
  badgePendencia: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
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
  tagsLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: espaco.xs,
    marginTop: espaco.xs,
  },
  badgePendenciaPonto: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: cores.acentoTexto,
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
