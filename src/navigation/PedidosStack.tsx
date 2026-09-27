import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BotaoNotificacoes } from '../components/BotaoNotificacoes';
import { PedidoVendaScreen, type PedidoVendaParams } from '../screens/PedidoVendaScreen';
import { PedidosVendaListScreen } from '../screens/PedidosVendaListScreen';

// Aba "Pedidos" do "modo Vendedor" — só montada em MainTabs quando o perfil tem
// pedidos_venda.criar. Ver docs/38-PEDIDO-VENDEDOR.md §4/§8.
export type PedidosStackParamList = {
  PedidosLista: undefined;
  // Mesma tela registrada em PontosVendaStack/AgendaStack (pedido a partir da visita).
  PedidoVenda: PedidoVendaParams | undefined;
};

const Stack = createNativeStackNavigator<PedidosStackParamList>();

export function PedidosStack() {
  return (
    <Stack.Navigator screenOptions={{ headerTitleStyle: { fontWeight: '700' } }}>
      <Stack.Screen
        name="PedidosLista"
        component={PedidosVendaListScreen}
        options={{ title: 'Meus pedidos', headerRight: () => <BotaoNotificacoes /> }}
      />
      <Stack.Screen name="PedidoVenda" component={PedidoVendaScreen} options={{ title: 'Pedido' }} />
    </Stack.Navigator>
  );
}
