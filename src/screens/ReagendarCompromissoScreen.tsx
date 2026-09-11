import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { reagendarOrdemServico } from '../lib/api/ordensServico';
import type { AgendaStackParamList } from '../navigation/AgendaStack';
import { DIAS_RAPIDOS, prazoDoDia } from '../lib/prazoAgenda';

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
        [{ text: 'OK', onPress: () => navigation.goBack() }],
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
        {enviando ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.botaoPrimarioTexto}>Confirmar reagendamento</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    padding: 20,
  },
  titulo: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  subtitulo: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  secaoLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
    marginTop: 24,
    marginBottom: 8,
  },
  chipsLinha: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipSelecionado: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  chipTexto: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  chipTextoSelecionado: {
    color: '#ffffff',
  },
  erroTexto: {
    color: '#b91c1c',
    fontSize: 13,
    marginTop: 16,
  },
  botaoPrimario: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
  },
  botaoPressionado: {
    opacity: 0.8,
  },
  botaoPrimarioTexto: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
