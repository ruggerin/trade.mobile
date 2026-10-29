import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { buscarConfigCheckout } from '../lib/api/parametros';
import { buscarSaidaDetectada } from '../lib/api/visitas';
import { useEstaOnline } from '../lib/network';
import { buscarVisitaEmAndamento } from '../lib/visitaLocal';
import { amber, cores, espaco, raio } from '../theme';

/**
 * "Você saiu da LOJA às 10:56" fora da tela da visita (docs/92 §5, linha "volta ao app"): na Agenda
 * e na lista de lojas. Só aparece com a sugestão da saída ligada, online e com a visita aberta no
 * servidor. O toque abre a visita já no "Finalizar visita".
 */
export function FaixaSaidaDetectada({
  usuarioId,
  onFinalizar,
}: {
  usuarioId: string | undefined;
  onFinalizar: (visitaLocalId: string) => void;
}) {
  const online = useEstaOnline();
  const configQuery = useQuery({ queryKey: ['config-checkout'], queryFn: buscarConfigCheckout });
  const sugere = !!configQuery.data?.sugerirSaida;

  const visitaQuery = useQuery({
    queryKey: ['visita-em-andamento', usuarioId],
    queryFn: () => buscarVisitaEmAndamento(usuarioId!),
    enabled: sugere && !!usuarioId,
    refetchInterval: 60_000,
  });
  const visita = visitaQuery.data;
  const abertaNoServidor = !!visita?.servidorId && visita.status === 'CHECKIN_ENVIADO';

  const saidaQuery = useQuery({
    queryKey: ['saida-detectada', visita?.servidorId],
    queryFn: () => buscarSaidaDetectada(visita!.servidorId!),
    enabled: sugere && abertaNoServidor && online,
    refetchInterval: 60_000,
    retry: false,
  });
  const saida = abertaNoServidor ? (saidaQuery.data ?? null) : null;
  if (!visita || !saida) return null;

  const hora = new Date(saida.saiu_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return (
    <Pressable
      style={({ pressed }) => [styles.faixa, pressed && { opacity: 0.85 }]}
      onPress={() => onFinalizar(visita.id)}
      accessibilityRole="button"
      accessibilityLabel={`Você saiu de ${visita.pontoVenda.fantasia} às ${hora}. Finalizar visita`}
    >
      <MaterialCommunityIcons name="exit-run" size={20} color={amber[800]} />
      <View style={styles.textos}>
        <Text style={styles.titulo} numberOfLines={1}>
          Você saiu de {visita.pontoVenda.fantasia} às {hora}
        </Text>
        <Text style={styles.texto}>A visita ainda está aberta.</Text>
      </View>
      <Text style={styles.link}>Finalizar</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  faixa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm,
    minHeight: 52,
    marginHorizontal: espaco.lg,
    marginBottom: espaco.sm,
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
    borderRadius: raio.md,
    borderWidth: 1,
    backgroundColor: amber[50],
    borderColor: amber[200],
  },
  textos: { flex: 1 },
  titulo: { fontSize: 14, fontWeight: '800', color: amber[800] },
  texto: { fontSize: 13, color: amber[800] },
  link: { fontSize: 15, fontWeight: '700', color: cores.acentoEscuro },
});
