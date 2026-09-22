import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BotaoNotificacoes } from '../components/BotaoNotificacoes';
import { PlanogramaDetalheScreen } from '../screens/PlanogramaDetalheScreen';
import { PlanogramasListScreen } from '../screens/PlanogramasListScreen';

// Aba solta, fora do fluxo de visita — o promotor consulta como material de apoio a qualquer
// momento, mesmo fora da loja. Ver docs/22-PLANOGRAMA.md.
export type PlanogramasStackParamList = {
  PlanogramasLista: undefined;
  PlanogramaDetalhe: { planogramaId: string };
};

const Stack = createNativeStackNavigator<PlanogramasStackParamList>();

export function PlanogramasStack() {
  return (
    <Stack.Navigator screenOptions={{ headerTitleStyle: { fontWeight: '700' } }}>
      <Stack.Screen
        name="PlanogramasLista"
        component={PlanogramasListScreen}
        options={{ title: 'Planogramas', headerRight: () => <BotaoNotificacoes /> }}
      />
      <Stack.Screen name="PlanogramaDetalhe" component={PlanogramaDetalheScreen} options={{ title: 'Planograma' }} />
    </Stack.Navigator>
  );
}
