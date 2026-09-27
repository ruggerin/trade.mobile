import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AgendaScreen } from '../screens/AgendaScreen';
import { NovoCompromissoScreen } from '../screens/NovoCompromissoScreen';
import { PontoVendaCheckinScreen } from '../screens/PontoVendaCheckinScreen';
import { ReagendarCompromissoScreen } from '../screens/ReagendarCompromissoScreen';
import { VisitaAndamentoScreen } from '../screens/VisitaAndamentoScreen';
import { PedidoVendaScreen, type PedidoVendaParams } from '../screens/PedidoVendaScreen';
import { VisitaDetalheScreen, type VisitaDetalheParams } from '../screens/VisitaDetalheScreen';
import type { OrdemServico, PontoVenda } from '../types/api';

// Reaproveita os mesmos componentes de tela de PontosVendaStack (PontoVendaCheckin,
// VisitaAndamento) numa stack própria — mais simples que navegação cross-tab tipada, e as duas
// telas já são componentes sem estado global, então não há problema em existirem duas
// instâncias independentes (uma por tab). Ver docs/13-AGENDA-MOBILE-E-AUTONOMIA.md.
export type AgendaStackParamList = {
  AgendaLista: undefined;
  NovoCompromisso: undefined;
  ReagendarCompromisso: { ordemServico: OrdemServico };
  PontoVendaCheckin: { pontoVenda: PontoVenda; ordemServico?: OrdemServico };
  // Ver comentário equivalente em PontosVendaStack.tsx.
  VisitaAndamento: { visitaLocalId: string };
  // Ver comentário equivalente em PontosVendaStack.tsx.
  VisitaDetalhe: VisitaDetalheParams;
  // Pedido de Venda a partir da visita ("Tirar pedido") — mesma tela da aba Pedidos, ver
  // PedidosStack.tsx e docs/38-PEDIDO-VENDEDOR.md §8.
  PedidoVenda: PedidoVendaParams | undefined;
};

const Stack = createNativeStackNavigator<AgendaStackParamList>();

export function AgendaStack() {
  return (
    <Stack.Navigator screenOptions={{ headerTitleStyle: { fontWeight: '700' } }}>
      {/* Header nativo escondido: a própria tela já tem cabeçalho (saudação + sino), ver
          AgendaScreen.tsx — deixar os dois juntos duplicava o sino de notificações. */}
      <Stack.Screen name="AgendaLista" component={AgendaScreen} options={{ headerShown: false }} />
      <Stack.Screen name="NovoCompromisso" component={NovoCompromissoScreen} options={{ title: 'Novo compromisso' }} />
      <Stack.Screen
        name="ReagendarCompromisso"
        component={ReagendarCompromissoScreen}
        options={{ title: 'Reagendar' }}
      />
      <Stack.Screen name="PontoVendaCheckin" component={PontoVendaCheckinScreen} options={{ title: 'Check-in' }} />
      {/* Header nativo escondido: o protótipo (Visita Andamento.dc.html) usa uma única linha
          própria com "‹ Voltar" + cronômetro lado a lado — um header nativo em cima dela virava
          duas barras empilhadas, tela bem menos "full screen" do que o protótipo. */}
      <Stack.Screen name="VisitaAndamento" component={VisitaAndamentoScreen} options={{ headerShown: false }} />
      <Stack.Screen name="VisitaDetalhe" component={VisitaDetalheScreen} options={{ title: 'Detalhe da visita' }} />
      <Stack.Screen name="PedidoVenda" component={PedidoVendaScreen} options={{ title: 'Pedido' }} />
    </Stack.Navigator>
  );
}
