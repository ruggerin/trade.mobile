import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { PontoVendaCheckinScreen } from '../screens/PontoVendaCheckinScreen';
import { PontosVendaListScreen } from '../screens/PontosVendaListScreen';
import { ReagendarCompromissoScreen } from '../screens/ReagendarCompromissoScreen';
import { VisitaAndamentoScreen } from '../screens/VisitaAndamentoScreen';
import { PedidoVendaScreen, type PedidoVendaParams } from '../screens/PedidoVendaScreen';
import { VisitaDetalheScreen, type VisitaDetalheParams } from '../screens/VisitaDetalheScreen';
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
  // Mesma tela de VisitaDetalheScreen, registrada aqui também (e em AgendaStack) além de
  // HistoricoStack — "Últimas visitas" (HistoricoLojaPanel) abre isso a partir do check-in/da
  // visita em andamento, e sem a tela existir NESTA stack o "voltar" pulava pro índice do
  // Histórico em vez de voltar pra loja/visita que o promotor estava vendo.
  VisitaDetalhe: VisitaDetalheParams;
  // Pedido de Venda a partir da visita ("Tirar pedido") — mesma tela da aba Pedidos, ver
  // PedidosStack.tsx e docs/38-PEDIDO-VENDEDOR.md §8.
  PedidoVenda: PedidoVendaParams | undefined;
};

const Stack = createNativeStackNavigator<PontosVendaStackParamList>();

export function PontosVendaStack() {
  return (
    <Stack.Navigator screenOptions={{ headerTitleStyle: { fontWeight: '700' } }}>
      {/* Header nativo escondido: a própria tela já tem cabeçalho (título + sino), ver
          PontosVendaListScreen.tsx — deixar os dois juntos duplicava o sino de notificações. */}
      <Stack.Screen name="PontosVendaLista" component={PontosVendaListScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="PontoVendaCheckin"
        component={PontoVendaCheckinScreen}
        options={{ title: 'Check-in' }}
      />
      <Stack.Screen name="ReagendarCompromisso" component={ReagendarCompromissoScreen} options={{ title: 'Reagendar' }} />
      {/* Header nativo escondido: mesmo motivo do AgendaStack.tsx — ver comentário lá. */}
      <Stack.Screen name="VisitaAndamento" component={VisitaAndamentoScreen} options={{ headerShown: false }} />
      <Stack.Screen name="VisitaDetalhe" component={VisitaDetalheScreen} options={{ title: 'Detalhe da visita' }} />
      <Stack.Screen name="PedidoVenda" component={PedidoVendaScreen} options={{ title: 'Pedido' }} />
    </Stack.Navigator>
  );
}
