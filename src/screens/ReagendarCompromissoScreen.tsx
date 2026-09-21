import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { reagendarOrdemServico } from '../lib/api/ordensServico';
import type { AgendaStackParamList } from '../navigation/AgendaStack';
import { DIAS_RAPIDOS, prazoDoDia } from '../lib/prazoAgenda';
import { cores, espaco, neutro, raio, sombraFlutuante } from '../theme';

type Props = NativeStackScreenProps<AgendaStackParamList, 'ReagendarCompromisso'>;

// docs/13-AGENDA-MOBILE-E-AUTONOMIA.md §4.3 — propõe um novo prazo pra uma OS própria já
// PENDENTE. Em modo autônomo aplica na hora; se a empresa exigir aprovação, vira
// REAGENDAMENTO_SOLICITADO (o prazo atual não muda até o gestor decidir) — a tela não precisa
// saber qual dos dois modos está ativo, só mostra a resposta que a API já devolve.
export function ReagendarCompromissoScreen({ route, navigation }: Props) {
  const { ordemServico } = route.params;
  const queryClient = useQueryClient();
  const [diaOffset, setDiaOffset] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar() {
    setEnviando(true);
    setErro(null);

    const { prazo_inicio, prazo_fim } = prazoDoDia(diaOffset);

    try {
      const atualizada = await reagendarOrdemServico(ordemServico.id, {
        prazo_inicio,
        prazo_fim,
      });

      void queryClient.invalidateQueries({ queryKey: ['ordens-servico-agenda'] });

      Alert.alert(
        atualizada.status === 'REAGENDAMENTO_SOLICITADO' ? 'Reagendamento enviado' : 'Reagendado',
        atualizada.status === 'REAGENDAMENTO_SOLICITADO'
          ? 'Sua empresa exige aprovação do gestor — o prazo atual continua valendo até ele decidir.'
          : 'O novo prazo já está valendo.',
        [{ text: 'OK', onPress: () => navigation.popToTop() }],
      );
    } catch {
      setErro('Não foi possível reagendar agora. Tente novamente.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.titulo}>{ordemServico.ponto_venda.fantasia}</Text>
      <Text style={styles.subtitulo}>
        Prazo atual: {new Date(ordemServico.prazo_fim).toLocaleDateString('pt-BR')}
      </Text>

      <Text style={styles.secaoLabel}>Novo dia</Text>
      <View style={styles.chipsLinha}>
        {DIAS_RAPIDOS.map((d) => (
          <Pressable
            key={d.offset}
            style={[styles.chip, diaOffset === d.offset && styles.chipSelecionado]}
            onPress={() => setDiaOffset(d.offset)}
          >
            <Text style={[styles.chipTexto, diaOffset === d.offset && styles.chipTextoSelecionado]}>{d.rotulo}</Text>
          </Pressable>
        ))}
      </View>

      {erro && <Text style={styles.erroTexto}>{erro}</Text>}

      <Pressable
        style={({ pressed }) => [styles.botaoPrimario, pressed && styles.botaoPressionado]}
        onPress={() => void confirmar()}
        disabled={enviando}
      >
        {enviando ? (
          <ActivityIndicator color={cores.onPrimaria} />
        ) : (
          <Text style={styles.botaoPrimarioTexto}>Confirmar reagendamento</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: cores.fundoCard,
    padding: espaco.xl,
  },
  titulo: {
    fontSize: 18,
    fontWeight: '700',
    color: cores.texto,
  },
  subtitulo: {
    fontSize: 14,
    color: cores.textoSecundario,
    marginTop: 4,
  },
  secaoLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: neutro[700],
    marginTop: espaco.xl,
    marginBottom: espaco.sm,
  },
  chipsLinha: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: espaco.sm,
  },
  chip: {
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
  },
  chipSelecionado: {
    backgroundColor: cores.primaria,
    borderColor: cores.primaria,
  },
  chipTexto: {
    fontSize: 13,
    fontWeight: '600',
    color: neutro[700],
  },
  chipTextoSelecionado: {
    color: cores.onPrimaria,
  },
  erroTexto: {
    color: cores.erro,
    fontSize: 13,
    marginTop: espaco.lg,
  },
  botaoPrimario: {
    backgroundColor: cores.primaria,
    borderRadius: raio.md,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: espaco.xxl,
    ...sombraFlutuante,
    shadowColor: cores.primaria,
    shadowOpacity: 0.3,
  },
  botaoPressionado: {
    opacity: 0.85,
  },
  botaoPrimarioTexto: {
    color: cores.onPrimaria,
    fontSize: 16,
    fontWeight: '700',
  },
});
