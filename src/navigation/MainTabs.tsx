import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useEffect, useRef } from 'react';
import { AppState, StyleSheet, type AppStateStatus } from 'react-native';
import { useAuth } from '../lib/auth/AuthContext';
import { processarFilaEnvio } from '../lib/filaEnvio';
import { aoReconectar } from '../lib/network';
import { sincronizarSeNecessario } from '../lib/sync';
import { PerfilScreen } from '../screens/PerfilScreen';
import { AgendaStack } from './AgendaStack';
import { HistoricoStack } from './HistoricoStack';
import { PontosVendaStack } from './PontosVendaStack';

// Bottom tab bar: Agenda, Lojas, Histórico, Perfil — "Agenda" (Hoje/Semana) e "Lojas" são os
// nomes/formato do protótipo discutido, ver docs/13-AGENDA-MOBILE-E-AUTONOMIA.md. Substitui o
// desenho original de docs/05-APP-MOBILE-UX.md §2 (Pontos de Venda, Pendências).
export type MainTabsParamList = {
  Agenda: undefined;
  PontosVenda: undefined;
  Historico: undefined;
  Perfil: undefined;
};

const Tab = createBottomTabNavigator<MainTabsParamList>();

export function MainTabs() {
  const { usuario } = useAuth();

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

    void processarFilaEnvio(usuario.id);

    const listenerAppState = (proximoEstado: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && proximoEstado === 'active') {
        void processarFilaEnvio(usuario.id);
      }
    };
    const subscriptionAppState = AppState.addEventListener('change', listenerAppState);
    const pararDeEscutarReconexao = aoReconectar(() => void processarFilaEnvio(usuario.id));

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
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: '#2563eb',
        tabBarInactiveTintColor: '#9ca3af',
        headerTitleStyle: styles.headerTitulo,
      }}
    >
      <Tab.Screen name="Agenda" component={AgendaStack} options={{ title: 'Agenda', headerShown: false }} />
      <Tab.Screen
        name="PontosVenda"
        component={PontosVendaStack}
        options={{ title: 'Lojas', headerShown: false }}
      />
      <Tab.Screen
        name="Historico"
        component={HistoricoStack}
        options={{ title: 'Histórico', headerShown: false }}
      />
      <Tab.Screen name="Perfil" component={PerfilScreen} options={{ title: 'Perfil' }} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  headerTitulo: {
    fontWeight: '700',
  },
});
