import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HistoricoScreen } from '../screens/HistoricoScreen';
import { NotificacoesScreen } from '../screens/NotificacoesScreen';
import { VisitaDetalheScreen, type VisitaDetalheParams } from '../screens/VisitaDetalheScreen';

export type HistoricoStackParamList = {
  HistoricoLista: undefined;
  // `visita` vem preenchido quando se navega a partir da própria lista do Histórico (evita um
  // round-trip, ela já tem o objeto inteiro); ausente quando se chega de uma notificação, que só
  // tem o id — a tela busca sozinha. `abrirRegistroId` (só da notificação) abre a conversa certa
  // assim que a visita carrega. Ver docs/29-NOTIFICACOES-MOBILE.md §4. Mesma tela também
  // registrada em PontosVendaStack/AgendaStack — ver comentário lá sobre o porquê.
  VisitaDetalhe: VisitaDetalheParams;
  Notificacoes: undefined;
};

const Stack = createNativeStackNavigator<HistoricoStackParamList>();

export function HistoricoStack() {
  return (
    <Stack.Navigator screenOptions={{ headerTitleStyle: { fontWeight: '700' } }}>
      {/* Header nativo escondido: mesmo padrão de AgendaStack/PontosVendaStack — a própria tela
          já tem cabeçalho (título + busca + sino), ver HistoricoScreen.tsx. */}
      <Stack.Screen name="HistoricoLista" component={HistoricoScreen} options={{ headerShown: false }} />
      <Stack.Screen name="VisitaDetalhe" component={VisitaDetalheScreen} options={{ title: 'Detalhe da visita' }} />
      <Stack.Screen name="Notificacoes" component={NotificacoesScreen} options={{ title: 'Notificações' }} />
    </Stack.Navigator>
  );
}
