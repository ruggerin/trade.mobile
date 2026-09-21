import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { listarPlanogramas } from '../lib/api/planogramas';
import { useAuth } from '../lib/auth/AuthContext';
import type { PlanogramasStackParamList } from '../navigation/PlanogramasStack';
import type { Planograma } from '../types/api';
import { cores, espaco, raio, sombraCard } from '../theme';

type Props = NativeStackScreenProps<PlanogramasStackParamList, 'PlanogramasLista'>;

// Consulta livre — não amarrada a visita/campanha nenhuma (o promotor pode olhar antes mesmo de
// chegar na loja). Ver docs/22-PLANOGRAMA.md.
export function PlanogramasListScreen({ navigation }: Props) {
  const query = useQuery({ queryKey: ['planogramas'], queryFn: listarPlanogramas });
  const planogramas = query.data ?? [];

  return (
    <View style={styles.container}>
      {query.isLoading && (
        <View style={styles.centro}>
          <ActivityIndicator size="large" color={cores.primaria} />
        </View>
      )}

      {query.isError && (
        <View style={styles.centro}>
          <Text style={styles.erroTexto}>Não foi possível carregar os planogramas.</Text>
          <Pressable style={styles.botaoRetry} onPress={() => void query.refetch()}>
            <Text style={styles.botaoRetryTexto}>Tentar novamente</Text>
          </Pressable>
        </View>
      )}

      {query.isSuccess && planogramas.length === 0 && (
        <View style={styles.centro}>
          <MaterialCommunityIcons name="view-grid-outline" size={40} color={cores.textoTerciario} />
          <Text style={styles.vazioTexto}>Nenhum planograma cadastrado ainda.</Text>
        </View>
      )}

      {query.isSuccess && planogramas.length > 0 && (
        <FlatList
          data={planogramas}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.lista}
          renderItem={({ item }) => (
            <PlanogramaCard planograma={item} onPress={() => navigation.navigate('PlanogramaDetalhe', { planogramaId: item.id })} />
          )}
        />
      )}
    </View>
  );
}

function PlanogramaCard({ planograma, onPress }: { planograma: Planograma; onPress: () => void }) {
  const { token } = useAuth();

  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.cardPressionado]} onPress={onPress}>
      <View style={styles.capa}>
        {planograma.foto_capa_url ? (
          <Image
            source={{ uri: planograma.foto_capa_url, headers: { Authorization: `Bearer ${token}` } }}
            style={styles.capaImagem}
            resizeMode="cover"
          />
        ) : (
          <MaterialCommunityIcons name="image-off-outline" size={28} color={cores.textoTerciario} />
        )}
      </View>
      <Text style={styles.cardDescricao}>{planograma.descricao}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: cores.fundo,
  },
  centro: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: espaco.xl,
    gap: espaco.md,
  },
  erroTexto: {
    fontSize: 15,
    color: cores.textoSecundario,
    textAlign: 'center',
    marginBottom: espaco.md,
  },
  vazioTexto: {
    fontSize: 15,
    color: cores.textoSecundario,
    textAlign: 'center',
  },
  botaoRetry: {
    backgroundColor: cores.primaria,
    borderRadius: raio.sm,
    paddingHorizontal: espaco.lg,
    paddingVertical: 10,
  },
  botaoRetryTexto: {
    color: cores.onPrimaria,
    fontWeight: '600',
  },
  lista: {
    padding: espaco.lg,
    gap: espaco.md,
  },
  card: {
    backgroundColor: cores.fundoCard,
    borderRadius: raio.lg,
    borderWidth: 1,
    borderColor: cores.borda,
    overflow: 'hidden',
    ...sombraCard,
  },
  cardPressionado: {
    backgroundColor: cores.divisor,
  },
  capa: {
    height: 120,
    backgroundColor: cores.divisor,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capaImagem: {
    width: '100%',
    height: '100%',
  },
  cardDescricao: {
    fontSize: 15,
    fontWeight: '600',
    color: cores.texto,
    padding: espaco.md,
  },
});
