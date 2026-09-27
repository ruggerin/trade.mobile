import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { TelaErro } from './src/components/TelaErro';
import { instalarTratadorGlobalDeErros } from './src/lib/crashHandler';
// Efeito colateral proposital: registra a tarefa de rastreamento em segundo plano (defineTask) já
// na inicialização do módulo, antes de qualquer tela — o SO pode acordar o app só pra rodá-la.
import './src/lib/rastreamento';
import { AuthProvider } from './src/lib/auth/AuthContext';
import { RootNavigator } from './src/navigation/RootNavigator';

// No React Native o React Query não sabe sozinho quando o app volta pro primeiro plano nem quando
// a rede volta (na web ele usa o foco da janela/eventos do navegador) — sem isso, uma lista (ex.:
// Lojas) era buscada uma vez e ficava velha até fechar e abrir o app. Com isso, voltar do
// background ou reconectar refaz as consultas ativas que estão "velhas" (staleTime padrão 0).
// Padrão da própria documentação do TanStack Query pra React Native.
focusManager.setEventListener((definirFoco) => {
  const subscription = AppState.addEventListener('change', (estado) => {
    if (Platform.OS !== 'web') definirFoco(estado === 'active');
  });
  return () => subscription.remove();
});
onlineManager.setEventListener((definirOnline) =>
  NetInfo.addEventListener((estado) => {
    definirOnline(Boolean(estado.isConnected && estado.isInternetReachable !== false));
  }),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
    },
  },
});

export default function App() {
  // Erro fora do ciclo de render (useEffect, callback, módulo nativo) — o ErrorBoundary abaixo
  // não enxerga isso, só cobre erro de render. Ver lib/crashHandler.ts pro porquê disso importar
  // de verdade em build de produção/preview (sem isso, o app fecha sem nenhuma mensagem).
  const [erroFatal, setErroFatal] = useState<unknown>(null);

  useEffect(() => {
    instalarTratadorGlobalDeErros(setErroFatal);
  }, []);

  if (erroFatal) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <TelaErro erro={erroFatal} onTentarNovamente={() => setErroFatal(null)} />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    // Exigido pelo react-native-gesture-handler pra qualquer gesto (pinch-to-zoom do
    // PlanogramaDetalheScreen) funcionar — precisa envolver a árvore inteira, não só a tela que
    // usa o gesto.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <RootNavigator />
              <StatusBar style="auto" />
            </AuthProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
