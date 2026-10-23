import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth/AuthContext';
import { avaliarPreparo, preparoCompleto } from '../lib/preparoAparelho';
import { navegacaoRef } from '../lib/push';
import { AceiteTermosScreen } from '../screens/AceiteTermosScreen';
import { AtualizarAppScreen, DesbloqueioScreen } from '../screens/BloqueioScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { PrepararAparelhoScreen } from '../screens/PrepararAparelhoScreen';
import { SplashScreen } from '../screens/SplashScreen';
import { MainTabs } from './MainTabs';

// docs/05-APP-MOBILE-UX.md §2 — Splash (checa sessão) → Login (sem sessão) | Tabs (com
// sessão). Login e Splash ficam fora das tabs, como o mapa de navegação pede.
const Stack = createNativeStackNavigator();

export function RootNavigator() {
  const { isLoading, isAuthenticated, appDesatualizado, bloqueadoPorBiometria, usuario } = useAuth();
  // docs/58 §6 — Termos/Política com versão vigente sem aceite: a tela de aceite vem antes das abas.
  const aceitePendente = (usuario?.documentos_pendentes?.length ?? 0) > 0;
  const preparo = usePreparoPendente(isAuthenticated && !bloqueadoPorBiometria && !aceitePendente);

  return (
    <NavigationContainer ref={navegacaoRef}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {appDesatualizado ? (
          // docs/67 Fase 2: API recusou a versão (426) — nada funciona até atualizar.
          <Stack.Screen name="AtualizarApp" component={AtualizarAppScreen} />
        ) : isLoading ? (
          <Stack.Screen name="Splash" component={SplashScreen} />
        ) : isAuthenticated && bloqueadoPorBiometria ? (
          <Stack.Screen name="Desbloqueio" component={DesbloqueioScreen} />
        ) : isAuthenticated && aceitePendente ? (
          <Stack.Screen name="AceiteTermos" component={AceiteTermosScreen} />
        ) : isAuthenticated && preparo.pendente === null ? (
          // Lendo as permissões (milissegundos) — evita piscar as abas antes do checklist.
          <Stack.Screen name="Splash" component={SplashScreen} />
        ) : isAuthenticated && preparo.pendente ? (
          <Stack.Screen name="PrepararAparelho">{() => <PrepararAparelhoScreen onConcluir={preparo.concluir} />}</Stack.Screen>
        ) : isAuthenticated ? (
          <Stack.Screen name="Main" component={MainTabs} />
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

/**
 * Checklist de permissões do primeiro acesso (lib/preparoAparelho.ts). Conferido UMA vez por
 * entrada (ao abrir o app ou ao logar) e nunca de novo no meio do uso — perder uma permissão com o
 * app aberto não arranca o promotor da visita. Aparece só se falta algum obrigatório: celular
 * entregue pela TI já liberado vai direto pras abas.
 */
function usePreparoPendente(ativo: boolean): { pendente: boolean | null; concluir: () => void } {
  const { usuario, biometria } = useAuth();
  const [pendente, setPendente] = useState<boolean | null>(null);
  const usuarioId = usuario?.id;
  // A biometria é lida do aparelho em paralelo (AuthContext); espera ela pra não montar a lista sem o item.
  const biometriaPronta = biometria !== null;

  useEffect(() => {
    if (!ativo || !usuarioId) {
      setPendente(null);
      return;
    }
    if (!biometriaPronta) return;
    let cancelado = false;
    void avaliarPreparo({
      promotor: usuario?.user_type === 'PROMOTOR',
      biometria: biometria?.disponivel ? { ativa: biometria.ativa, perguntar: biometria.perguntar } : null,
    })
      .then((itens) => !cancelado && setPendente(!preparoCompleto(itens)))
      // Falha lendo permissão nunca pode trancar o app: segue pras abas (cada tela ainda pede o que precisa).
      .catch(() => !cancelado && setPendente(false));
    return () => {
      cancelado = true;
    };
    // Só na entrada: de propósito sem depender das permissões/biometria mudando depois.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, usuarioId, biometriaPronta]);

  return { pendente, concluir: () => setPendente(false) };
}

