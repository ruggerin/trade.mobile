import { MaterialCommunityIcons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AppState, StyleSheet, type AppStateStatus } from 'react-native';
import { PermissaoRastreamentoModal } from '../components/PermissaoRastreamentoModal';
import { useAuth } from '../lib/auth/AuthContext';
import { buscarNaoLidos } from '../lib/api/comentarios';
import { processarFilaEnvio } from '../lib/filaEnvio';
import { aoReconectar } from '../lib/network';
import { useAoServidorMudarPelaFila } from '../lib/useFilaEnvioAtualizada';
import { useRastreamento } from '../lib/useRastreamento';
import { sincronizarSeNecessario } from '../lib/sync';
import { PerfilScreen } from '../screens/PerfilScreen';
import { cores, neutro } from '../theme';
import { AgendaStack } from './AgendaStack';
import { HistoricoStack } from './HistoricoStack';
import { PlanogramasStack } from './PlanogramasStack';
import { PontosVendaStack } from './PontosVendaStack';

type IconeMdi = keyof typeof MaterialCommunityIcons.glyphMap;

const ICONES_TAB: Record<keyof MainTabsParamList, IconeMdi> = {
  Agenda: 'calendar-check-outline',
  PontosVenda: 'storefront-outline',
  Planogramas: 'view-grid-outline',
  Historico: 'clock-time-four-outline',
  Perfil: 'account-circle-outline',
};

// Bottom tab bar: Agenda, Lojas, Planogramas, Histórico, Perfil — "Agenda" (Hoje/Semana) e
// "Lojas" são os nomes/formato do protótipo discutido, ver
// docs/13-AGENDA-MOBILE-E-AUTONOMIA.md. Substitui o desenho original de
// docs/05-APP-MOBILE-UX.md §2 (Pontos de Venda, Pendências). "Planogramas" é consulta livre,
// fora do fluxo de visita — ver docs/22-PLANOGRAMA.md.
export type MainTabsParamList = {
  Agenda: undefined;
  PontosVenda: undefined;
  Planogramas: undefined;
  Historico: undefined;
  Perfil: undefined;
};

const Tab = createBottomTabNavigator<MainTabsParamList>();

export function MainTabs() {
  const { usuario } = useAuth();
  // Rastreamento em tempo real (docs/11-RASTREAMENTO-TEMPO-REAL.md) — só PROMOTOR. Mantém a
  // tarefa em segundo plano viva e mostra a explicação antes de pedir a permissão "Sempre".
  const rastreamento = useRastreamento(usuario?.user_type === 'PROMOTOR');

  // Feedback do gestor não lido (docs/28 §3) — badge na aba Histórico, por polling (sem push).
  // Falha silenciosa: offline o badge só não atualiza.
  const naoLidosQuery = useQuery({
    queryKey: ['comentarios-nao-lidos'],
    queryFn: buscarNaoLidos,
    enabled: usuario?.user_type === 'PROMOTOR',
    refetchInterval: 60_000,
    retry: false,
  });
  const totalNaoLidos = naoLidosQuery.data?.total ?? 0;

  // Visita finalizada/registro enviado pela fila: Agenda, pendências, Histórico e o histórico da loja
  // vêm do servidor e ficavam mostrando "Em andamento" até o app ser reaberto.
  const queryClient = useQueryClient();
  useAoServidorMudarPelaFila(() => {
    for (const chave of ['ordens-servico-agenda', 'ordens-servico', 'visitas', 'historico-loja', 'pedidos-loja', 'comentarios-nao-lidos']) {
      void queryClient.invalidateQueries({ queryKey: [chave] });
    }
  });

  // Sincronização automática silenciosa de LEITURA (Fase 1, docs/07-ORDEM-DE-SERVICO.md) — ao
  // entrar nas tabs (sessão válida) e sempre que o app volta de background, compara a última
  // sincronização com SYNC_INTERVALO_HORAS e busca novidade se estiver desatualizado. Nunca
  // bloqueia a UI nem mostra erro — é só uma tentativa de antecipar dado novo (badge de
  // pendências, parâmetro alterado), as telas já caem pro cache sozinhas se a rede falhar na hora.
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    void sincronizarSeNecessario();

    const listener = (proximoEstado: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && proximoEstado === 'active') {
        void sincronizarSeNecessario();
      }
      appState.current = proximoEstado;
    };

    const subscription = AppState.addEventListener('change', listener);
    return () => subscription.remove();
  }, []);

  // Fila de ENVIO (check-in/registros/checkout coletados offline, ver lib/filaEnvio.ts e
  // docs/04-APP-MOBILE.md "Fila offline de envio") — dispara em três momentos: ao entrar nas
  // tabs, sempre que o app volta de background, e assim que o aparelho reconecta de verdade
  // (NetInfo, mais imediato que esperar o próximo AppState). `processarFilaEnvio` é idempotente
  // e não faz nada se já estiver rodando, então sobrepor os três gatilhos é seguro.
  useEffect(() => {
    if (!usuario) return;

    // `.catch()` aqui é cinto e suspensório — processarFilaEnvio já não rejeita mais sozinha
    // (tem seu próprio catch interno agora, ver lib/filaEnvio.ts), mas esses três disparos
    // (`void ...`, sem ninguém esperando a promise) não têm handler nenhum por padrão; qualquer
    // rejeição escapando por aqui vira promise sem handler, e é esse tipo de erro não tratado
    // que derruba o app sozinho num build de produção.
    void processarFilaEnvio(usuario.id).catch(() => {});

    const listenerAppState = (proximoEstado: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && proximoEstado === 'active') {
        void processarFilaEnvio(usuario.id).catch(() => {});
      }
    };
    const subscriptionAppState = AppState.addEventListener('change', listenerAppState);
    const pararDeEscutarReconexao = aoReconectar(() => void processarFilaEnvio(usuario.id).catch(() => {}));

    return () => {
      subscriptionAppState.remove();
      pararDeEscutarReconexao();
    };
    // Depende só do id (valor primitivo), não do objeto `usuario` inteiro — uma referência nova
    // em algum re-render que não seja login/logout de verdade (ex.: refetch de /auth/me
    // devolvendo um objeto novo com os mesmos dados) não precisa desmontar e remontar os
    // listeners de AppState/reconexão à toa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario?.id]);

  return (
    <>
    <PermissaoRastreamentoModal
      visible={rastreamento.explicando}
      enviando={rastreamento.pedindo}
      onPermitir={() => void rastreamento.permitir()}
      onAgoraNao={() => void rastreamento.agoraNao()}
    />
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarActiveTintColor: cores.primaria,
        tabBarInactiveTintColor: neutro[400],
        tabBarLabelStyle: styles.tabLabel,
        tabBarStyle: styles.tabBar,
        tabBarIcon: ({ color, size }) => (
          <MaterialCommunityIcons name={ICONES_TAB[route.name]} size={size} color={color} />
        ),
        headerTitleStyle: styles.headerTitulo,
      })}
    >
      <Tab.Screen name="Agenda" component={AgendaStack} options={{ title: 'Agenda', headerShown: false }} />
      <Tab.Screen
        name="PontosVenda"
        component={PontosVendaStack}
        options={{ title: 'Lojas', headerShown: false }}
      />
      <Tab.Screen
        name="Planogramas"
        component={PlanogramasStack}
        options={{ title: 'Planogramas', headerShown: false }}
      />
      <Tab.Screen
        name="Historico"
        component={HistoricoStack}
        options={{ title: 'Histórico', headerShown: false, tabBarBadge: totalNaoLidos > 0 ? totalNaoLidos : undefined }}
      />
      <Tab.Screen name="Perfil" component={PerfilScreen} options={{ title: 'Perfil' }} />
    </Tab.Navigator>
    </>
  );
}

const styles = StyleSheet.create({
  headerTitulo: {
    fontWeight: '700',
  },
  tabBar: {
    borderTopColor: neutro[100],
    height: 62,
    paddingBottom: 8,
    paddingTop: 6,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
});
