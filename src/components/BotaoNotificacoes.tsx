import { MaterialCommunityIcons } from '@expo/vector-icons';
import { type NavigationProp, useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { buscarNaoLidos } from '../lib/api/comentarios';
import type { MainTabsParamList } from '../navigation/MainTabs';
import { cores, neutro } from '../theme';

// Sino de notificações — estilo Instagram/Facebook, no cabeçalho de cada uma das 5 abas em vez
// de virar uma 6ª aba (docs/29-NOTIFICACOES-MOBILE.md §2/§3). Sempre navega pra dentro da aba
// Histórico (onde mora a tela de Notificações e o VisitaDetalhe que ela abre) — o `navigate`
// aninhado troca de aba sozinho quando necessário, sem precisar de getParent().
export function BotaoNotificacoes() {
  const navigation = useNavigation<NavigationProp<MainTabsParamList>>();
  const naoLidosQuery = useQuery({ queryKey: ['comentarios-nao-lidos'], queryFn: buscarNaoLidos, retry: false });
  const total = naoLidosQuery.data?.total ?? 0;

  return (
    <Pressable
      onPress={() => navigation.navigate('Historico', { screen: 'Notificacoes' })}
      hitSlop={10}
      style={styles.botao}
    >
      <MaterialCommunityIcons name="bell-outline" size={22} color={cores.texto} />
      {total > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeTexto}>{total > 99 ? '99+' : total}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  botao: {
    marginRight: 12,
    padding: 4,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -4,
    backgroundColor: cores.erro,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: neutro[0],
  },
  badgeTexto: {
    color: cores.branco,
    fontSize: 9,
    fontWeight: '700',
  },
});
