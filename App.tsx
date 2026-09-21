import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
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
