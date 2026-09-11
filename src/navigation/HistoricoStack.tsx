import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HistoricoScreen } from '../screens/HistoricoScreen';
import { VisitaDetalheScreen } from '../screens/VisitaDetalheScreen';
import type { Visita } from '../types/api';

export type HistoricoStackParamList = {
  HistoricoLista: undefined;
  VisitaDetalhe: { visita: Visita };
};

const Stack = createNativeStackNavigator<HistoricoStackParamList>();

export function HistoricoStack() {
  return (
    <Stack.Navigator screenOptions={{ headerTitleStyle: { fontWeight: '700' } }}>
      <Stack.Screen name="HistoricoLista" component={HistoricoScreen} options={{ title: 'Histórico' }} />
      <Stack.Screen name="VisitaDetalhe" component={VisitaDetalheScreen} options={{ title: 'Detalhe da visita' }} />
    </Stack.Navigator>
  );
}
