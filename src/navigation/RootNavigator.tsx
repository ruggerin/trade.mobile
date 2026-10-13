import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../lib/auth/AuthContext';
import { AceiteTermosScreen } from '../screens/AceiteTermosScreen';
import { AtualizarAppScreen, DesbloqueioScreen } from '../screens/BloqueioScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { SplashScreen } from '../screens/SplashScreen';
import { MainTabs } from './MainTabs';

// docs/05-APP-MOBILE-UX.md §2 — Splash (checa sessão) → Login (sem sessão) | Tabs (com
// sessão). Login e Splash ficam fora das tabs, como o mapa de navegação pede.
const Stack = createNativeStackNavigator();

export function RootNavigator() {
  const { isLoading, isAuthenticated, appDesatualizado, bloqueadoPorBiometria, usuario } = useAuth();
  // docs/58 §6 — Termos/Política com versão vigente sem aceite: a tela de aceite vem antes das abas.
  const aceitePendente = (usuario?.documentos_pendentes?.length ?? 0) > 0;

  return (
    <NavigationContainer>
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
        ) : isAuthenticated ? (
          <Stack.Screen name="Main" component={MainTabs} />
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
