import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BotaoNotificacoes } from '../components/BotaoNotificacoes';
import { AgendaScreen } from '../screens/AgendaScreen';
import { NovoCompromissoScreen } from '../screens/NovoCompromissoScreen';
import { PontoVendaCheckinScreen } from '../screens/PontoVendaCheckinScreen';
import { ReagendarCompromissoScreen } from '../screens/ReagendarCompromissoScreen';
import { VisitaAndamentoScreen } from '../screens/VisitaAndamentoScreen';
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
};

const Stack = createNativeStackNavigator<AgendaStackParamList>();

export function AgendaStack() {
  return (
    <Stack.Navigator screenOptions={{ headerTitleStyle: { fontWeight: '700' } }}>
      <Stack.Screen
        name="AgendaLista"
        component={AgendaScreen}
        options={{ title: 'Agenda', headerRight: () => <BotaoNotificacoes /> }}
      />
      <Stack.Screen name="NovoCompromisso" component={NovoCompromissoScreen} options={{ title: 'Novo compromisso' }} />
      <Stack.Screen
        name="ReagendarCompromisso"
        component={ReagendarCompromissoScreen}
        options={{ title: 'Reagendar' }}
      />
      <Stack.Screen name="PontoVendaCheckin" component={PontoVendaCheckinScreen} options={{ title: 'Check-in' }} />
      <Stack.Screen
        name="VisitaAndamento"
        component={VisitaAndamentoScreen}
        options={{ title: 'Visita em andamento' }}
      />
    </Stack.Navigator>
  );
}
