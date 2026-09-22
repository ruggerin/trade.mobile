import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HistoricoScreen } from '../screens/HistoricoScreen';
import { NotificacoesScreen } from '../screens/NotificacoesScreen';
import { VisitaDetalheScreen } from '../screens/VisitaDetalheScreen';
import { BotaoNotificacoes } from '../components/BotaoNotificacoes';
import type { Visita } from '../types/api';

export type HistoricoStackParamList = {
  HistoricoLista: undefined;
  // `visita` vem preenchido quando se navega a partir da própria lista do Histórico (evita um
  // round-trip, ela já tem o objeto inteiro); ausente quando se chega de uma notificação, que só
  // tem o id — a tela busca sozinha. `abrirRegistroId` (só da notificação) abre a conversa certa
  // assim que a visita carrega. Ver docs/29-NOTIFICACOES-MOBILE.md §4.
  VisitaDetalhe: { visitaId: string; visita?: Visita; abrirRegistroId?: string };
  Notificacoes: undefined;
};

const Stack = createNativeStackNavigator<HistoricoStackParamList>();

export function HistoricoStack() {
  return (
    <Stack.Navigator screenOptions={{ headerTitleStyle: { fontWeight: '700' } }}>
      <Stack.Screen
        name="HistoricoLista"
        component={HistoricoScreen}
        options={{ title: 'Histórico', headerRight: () => <BotaoNotificacoes /> }}
      />
      <Stack.Screen name="VisitaDetalhe" component={VisitaDetalheScreen} options={{ title: 'Detalhe da visita' }} />
      <Stack.Screen name="Notificacoes" component={NotificacoesScreen} options={{ title: 'Notificações' }} />
    </Stack.Navigator>
  );
}
