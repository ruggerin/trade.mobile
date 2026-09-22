import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BotaoNotificacoes } from '../components/BotaoNotificacoes';
import { PontoVendaCheckinScreen } from '../screens/PontoVendaCheckinScreen';
import { PontosVendaListScreen } from '../screens/PontosVendaListScreen';
import { ReagendarCompromissoScreen } from '../screens/ReagendarCompromissoScreen';
import { VisitaAndamentoScreen } from '../screens/VisitaAndamentoScreen';
import type { OrdemServico, PontoVenda } from '../types/api';

// docs/05-APP-MOBILE-UX.md §2 — "Visita em Andamento" é uma pilha aberta a partir de Pontos
// de Venda, por isso essa aba vira sua própria stack em vez de uma tela solta na tab bar.
export type PontosVendaStackParamList = {
  PontosVendaLista: undefined;
  // ordemServico presente quando o check-in nasce de uma OS direcionada (badge nesta tela ou
  // vindo da aba Agenda, ver AgendaStack) — ausente pra check-in espontâneo, que continua o
  // fluxo comum. Ver docs/07-ORDEM-DE-SERVICO.md.
  PontoVendaCheckin: { pontoVenda: PontoVenda; ordemServico?: OrdemServico };
  // Aberto a partir das ações do compromisso dentro da tela da loja (AcoesCompromisso).
  ReagendarCompromisso: { ordemServico: OrdemServico };
  // Só o id local (fila_visitas) — a visita nasce e vive na fila de envio até o checkout ser
  // confirmado pelo servidor, nunca chega aqui como um objeto Visita "de servidor" (ver
  // lib/visitaLocal.ts e docs/04-APP-MOBILE.md "Fila offline de envio").
  VisitaAndamento: { visitaLocalId: string };
};

const Stack = createNativeStackNavigator<PontosVendaStackParamList>();

export function PontosVendaStack() {
  return (
    <Stack.Navigator screenOptions={{ headerTitleStyle: { fontWeight: '700' } }}>
      <Stack.Screen
        name="PontosVendaLista"
        component={PontosVendaListScreen}
        options={{ title: 'Lojas', headerRight: () => <BotaoNotificacoes /> }}
      />
      <Stack.Screen
        name="PontoVendaCheckin"
        component={PontoVendaCheckinScreen}
        options={{ title: 'Check-in' }}
      />
      <Stack.Screen name="ReagendarCompromisso" component={ReagendarCompromissoScreen} options={{ title: 'Reagendar' }} />
      <Stack.Screen
        name="VisitaAndamento"
        component={VisitaAndamentoScreen}
        options={{ title: 'Visita em andamento' }}
      />
    </Stack.Navigator>
  );
}
