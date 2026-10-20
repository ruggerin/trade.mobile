import { MaterialCommunityIcons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View, type AppStateStatus } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BotaoNotificacoes } from '../components/BotaoNotificacoes';
import { OfertaBiometriaModal } from '../components/OfertaBiometriaModal';
import { PermissaoRastreamentoModal } from '../components/PermissaoRastreamentoModal';
import { AvisoRastreamento, BloqueioRastreamento } from '../components/RastreamentoExigencia';
import { useAuth } from '../lib/auth/AuthContext';
import { podeTirarPedido } from '../lib/pedidoVenda';
import { listarVisitasLocaisPendentesOuRejeitadas } from '../lib/db/filaVisitas';
import { desligarRetentativaAutomatica, ligarRetentativaAutomatica, processarFilaEnvio } from '../lib/filaEnvio';
import { aoReconectar } from '../lib/network';
import { useAoServidorMudarPelaFila } from '../lib/useFilaEnvioAtualizada';
import { useRastreamento } from '../lib/useRastreamento';
import { sincronizarSeNecessario } from '../lib/sync';
import { PerfilScreen } from '../screens/PerfilScreen';
import { cores, neutro } from '../theme';
import { AgendaStack, type AgendaStackParamList } from './AgendaStack';
import { HistoricoStack, type HistoricoStackParamList } from './HistoricoStack';
import { PlanogramasStack } from './PlanogramasStack';
import { PedidosStack } from './PedidosStack';
import { PontosVendaStack } from './PontosVendaStack';

type IconeMdi = keyof typeof MaterialCommunityIcons.glyphMap;

const ICONES_TAB: Record<keyof MainTabsParamList, IconeMdi> = {
  Agenda: 'calendar-check-outline',
  PontosVenda: 'storefront-outline',
  Pedidos: 'cart-outline',
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
  // Aninhado: o Perfil abre "Minha pontuação" dentro desta aba (régua de XP, docs/88 §12).
  Agenda: NavigatorScreenParams<AgendaStackParamList> | undefined;
  PontosVenda: undefined;
  // Só existe no "modo Vendedor" (perfil com pedidos_venda.criar), ver docs/38-PEDIDO-VENDEDOR.md §4.
  Pedidos: undefined;
  Planogramas: undefined;
  // Aninhado (não `undefined`) desde que o sino de notificações passou a navegar direto pra
  // dentro desta aba de qualquer lugar do app — ver components/BotaoNotificacoes.tsx e
  // docs/29-NOTIFICACOES-MOBILE.md §4.
  Historico: NavigatorScreenParams<HistoricoStackParamList>;
  Perfil: undefined;
};

const Tab = createBottomTabNavigator<MainTabsParamList>();

export function MainTabs() {
  const { usuario, logout, biometria, definirBiometria } = useAuth();
  // `height` fixo no tabBarStyle desliga o ajuste automático de safe area que o bottom-tabs faz
  // sozinho por padrão — sem somar o inset aqui, a barra fica curta e o gesto/home indicator do
  // aparelho cobre o rótulo da última linha.
  const insets = useSafeAreaInsets();
  // Rastreamento em tempo real (docs/11-RASTREAMENTO-TEMPO-REAL.md) — só PROMOTOR. Mantém a
  // tarefa em segundo plano viva e mostra a explicação antes de pedir a permissão "Sempre".
  // docs/47-RASTREAMENTO-EXIGENCIA.md: com exigência AVISO/OBRIGATÓRIO, mostra a faixa de aviso ou
  // bloqueia o app até o promotor resolver (visita em andamento → só aviso, deixa terminar).
  const rastreamento = useRastreamento(usuario?.user_type === 'PROMOTOR', true, usuario?.id);

  // Envios ainda na fila, mostrados na tela de bloqueio ("continuam sendo enviados") — só conta
  // enquanto o bloqueio está aberto.
  const [enviosPendentes, setEnviosPendentes] = useState(0);
  useEffect(() => {
    if (!rastreamento.bloquear || !usuario) return;
    const contar = () =>
      void listarVisitasLocaisPendentesOuRejeitadas(usuario.id)
        .then((v) => setEnviosPendentes(v.length))
        .catch(() => {});
    contar();
    const id = setInterval(contar, 10_000);
    return () => clearInterval(id);
  }, [rastreamento.bloquear, usuario]);

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
    // Sincronizou de verdade → as telas abertas recarregam (lojas, formulários, parâmetros...).
    const sincronizar = () =>
      void sincronizarSeNecessario().then((sincronizou) => {
        if (sincronizou) void queryClient.invalidateQueries();
      });

    sincronizar();

    const listener = (proximoEstado: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && proximoEstado === 'active') {
        sincronizar();
      }
      appState.current = proximoEstado;
    };

    const subscription = AppState.addEventListener('change', listener);
    return () => subscription.remove();
  }, [queryClient]);

  // Fila de ENVIO (check-in/registros/checkout coletados offline, ver lib/filaEnvio.ts e
  // docs/04-APP-MOBILE.md "Fila offline de envio") — ao entrar nas tabs e ao voltar de background
  // liga a retentativa automática (que já faz uma passada e repete sozinha enquanto houver
  // pendência, docs/51 Fase 1); indo pro background, desliga (nenhum timer fica vivo). Reconexão
  // dispara uma passada na hora. `processarFilaEnvio` não perde chamada concorrente.
  useEffect(() => {
    if (!usuario) return;

    ligarRetentativaAutomatica(usuario.id);

    // Estado anterior PRÓPRIO deste efeito: compartilhar o `appState` do efeito de sincronização
    // acima fazia o listener de lá marcar 'active' antes deste conferir — a fila nunca via a
    // volta do background (docs/51).
    let estadoAnterior: AppStateStatus = AppState.currentState;
    const listenerAppState = (proximoEstado: AppStateStatus) => {
      if (estadoAnterior.match(/inactive|background/) && proximoEstado === 'active') {
        ligarRetentativaAutomatica(usuario.id);
      } else if (proximoEstado === 'background') {
        desligarRetentativaAutomatica();
      }
      estadoAnterior = proximoEstado;
    };
    const subscriptionAppState = AppState.addEventListener('change', listenerAppState);
    // `.catch()` é cinto e suspensório — rejeição solta vira erro não tratado que derruba o app
    // num build de produção.
    const pararDeEscutarReconexao = aoReconectar(() => void processarFilaEnvio(usuario.id).catch(() => {}));

    return () => {
      subscriptionAppState.remove();
      pararDeEscutarReconexao();
      desligarRetentativaAutomatica();
    };
    // Depende só do id (valor primitivo), não do objeto `usuario` inteiro — uma referência nova
    // em algum re-render que não seja login/logout de verdade (ex.: refetch de /auth/me
    // devolvendo um objeto novo com os mesmos dados) não precisa desmontar e remontar os
    // listeners de AppState/reconexão à toa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario?.id]);

  return (
    <View style={styles.raiz}>
    <BloqueioRastreamento
      visible={rastreamento.bloquear}
      situacao={rastreamento.situacao}
      detalhe={rastreamento.detalhe}
      enviosPendentes={enviosPendentes}
      resolvendo={rastreamento.resolvendo}
      onResolver={() => void rastreamento.resolver()}
      onSair={() => void logout()}
    />
    <PermissaoRastreamentoModal
      visible={rastreamento.explicando}
      enviando={rastreamento.pedindo}
      onPermitir={() => void rastreamento.permitir()}
      onAgoraNao={() => void rastreamento.agoraNao()}
    />
    {/* Pergunta pós-login da biometria. Espera os avisos de localização: o iOS não abre dois
        Modals ao mesmo tempo. */}
    <OfertaBiometriaModal
      visible={Boolean(biometria?.perguntar) && !rastreamento.explicando && !rastreamento.bloquear}
      onResponder={definirBiometria}
    />
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarActiveTintColor: cores.primaria,
        tabBarInactiveTintColor: neutro[400],
        tabBarLabelStyle: styles.tabLabel,
        tabBarStyle: [styles.tabBar, { height: 56 + insets.bottom, paddingBottom: 8 + insets.bottom }],
        // Ícone ativo ganha uma "pill" de fundo (índigo claro) atrás — mesmo destaque do
        // protótipo Claude Design (Home.dc.html), só decorativo, não muda a área de toque.
        tabBarIcon: ({ color, size, focused }) => (
          <View style={focused ? styles.tabIconePill : undefined}>
            <MaterialCommunityIcons name={ICONES_TAB[route.name]} size={size} color={color} />
          </View>
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
      {/* "Modo Vendedor" (docs/38-PEDIDO-VENDEDOR.md §4) — sem UserType novo, só a permissão
          pedidos_venda.criar no perfil do promotor. */}
      {podeTirarPedido(usuario) && (
        <Tab.Screen name="Pedidos" component={PedidosStack} options={{ title: 'Pedidos', headerShown: false }} />
      )}
      <Tab.Screen
        name="Planogramas"
        component={PlanogramasStack}
        options={{ title: 'Planogramas', headerShown: false }}
      />
      <Tab.Screen name="Historico" component={HistoricoStack} options={{ title: 'Histórico', headerShown: false }} />
      <Tab.Screen
        name="Perfil"
        component={PerfilScreen}
        options={{ title: 'Perfil', headerRight: () => <BotaoNotificacoes /> }}
      />
    </Tab.Navigator>
    {rastreamento.avisar && (
      <AvisoRastreamento
        situacao={rastreamento.situacao}
        visitaEmAndamento={rastreamento.visitaEmAndamento}
        obrigatorio={rastreamento.exigencia === 'OBRIGATORIO'}
        resolvendo={rastreamento.resolvendo}
        onResolver={() => void rastreamento.resolver()}
      />
    )}
    </View>
  );
}

const styles = StyleSheet.create({
  raiz: {
    flex: 1,
  },
  headerTitulo: {
    fontWeight: '700',
  },
  tabBar: {
    borderTopColor: neutro[100],
    paddingTop: 6,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  tabIconePill: {
    width: 46,
    height: 28,
    borderRadius: 999,
    backgroundColor: cores.primariaClara,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
