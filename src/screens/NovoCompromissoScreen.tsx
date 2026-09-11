import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { listarObjetivosVisita } from '../lib/api/objetivosVisita';
import { criarCompromissoProprio } from '../lib/api/ordensServico';
import { listarPontosVenda } from '../lib/api/pontosVenda';
import { listarTiposVisita } from '../lib/api/tiposVisita';
import { DIAS_RAPIDOS, prazoDoDia } from '../lib/prazoAgenda';
import { useDebounce } from '../lib/useDebounce';
import type { AgendaStackParamList } from '../navigation/AgendaStack';
import type { ObjetivoVisita, PontoVenda, TipoVisita } from '../types/api';

type Props = NativeStackScreenProps<AgendaStackParamList, 'NovoCompromisso'>;

// docs/13-AGENDA-MOBILE-E-AUTONOMIA.md §4/§6.1 — o promotor agenda a própria visita. Sem
// calendário nativo (nenhuma lib de date-picker instalada ainda): a data é um atalho rápido de
// até 6 dias à frente, suficiente pra cobrir a janela "Semana" que a própria Agenda mostra.
export function NovoCompromissoScreen({ navigation }: Props) {
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState('');
  const [pontoVenda, setPontoVenda] = useState<PontoVenda | null>(null);
  const [diaOffset, setDiaOffset] = useState(0);
  const [horario, setHorario] = useState('');
  const [tipoVisita, setTipoVisita] = useState<TipoVisita | null>(null);
  const [objetivoVisita, setObjetivoVisita] = useState<ObjetivoVisita | null>(null);
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Espera o promotor parar de digitar antes de buscar — sem isso, cada tecla dispara uma
  // requisição nova.
  const buscaDebounced = useDebounce(busca, 300);
  const pontosVendaQuery = useQuery({
    queryKey: ['pontos-venda', 'busca-novo-compromisso', buscaDebounced],
    queryFn: () => listarPontosVenda(buscaDebounced || undefined),
    enabled: !pontoVenda,
  });

  const tiposVisitaQuery = useQuery({ queryKey: ['tipos-visita'], queryFn: listarTiposVisita });
  const objetivosVisitaQuery = useQuery({ queryKey: ['objetivos-visita'], queryFn: listarObjetivosVisita });

  const horarioValido = useMemo(() => !horario || /^([01]\d|2[0-3]):[0-5]\d$/.test(horario), [horario]);

  async function confirmar() {
    if (!pontoVenda) {
      setErro('Escolha o ponto de venda.');
      return;
    }
    if (!horarioValido) {
      setErro('Horário inválido — use o formato HH:mm, ex.: 14:30.');
      return;
    }
    setErro(null);
    setEnviando(true);

    const { prazo_inicio, prazo_fim } = prazoDoDia(diaOffset);

    try {
      const ordemServico = await criarCompromissoProprio({
        ponto_venda_uuid: pontoVenda.id,
        tipo_visita_uuid: tipoVisita?.id ?? null,
        objetivo_visita_uuid: objetivoVisita?.id ?? null,
        horario_previsto: horario || null,
        prazo_inicio,
        prazo_fim,
        observacao: observacao || null,
      });

      void queryClient.invalidateQueries({ queryKey: ['ordens-servico-agenda'] });

      Alert.alert(
        ordemServico.status === 'AGUARDANDO_APROVACAO' ? 'Enviado pra aprovação' : 'Compromisso criado',
        ordemServico.status === 'AGUARDANDO_APROVACAO'
          ? 'Sua empresa exige aprovação do gestor pra novos compromissos — você já vê ele na sua agenda, marcado como "Aguardando aprovação".'
          : 'Já aparece na sua agenda.',
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch {
      setErro('Não foi possível criar o compromisso agora. Tente novamente.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.conteudo} keyboardShouldPersistTaps="handled">
        <Text style={styles.secaoLabel}>Ponto de venda</Text>
        {pontoVenda ? (
          <View style={styles.pdvSelecionado}>
            <Text style={styles.pdvSelecionadoTexto} numberOfLines={1}>
              {pontoVenda.fantasia}
            </Text>
            <Pressable onPress={() => setPontoVenda(null)}>
              <Text style={styles.linkTrocar}>Trocar</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder="Buscar por nome, razão social ou bairro"
              value={busca}
              onChangeText={setBusca}
            />
            {pontosVendaQuery.isLoading ? (
              <ActivityIndicator style={{ marginTop: 12 }} color="#2563eb" />
            ) : (
              // ScrollView + nestedScrollEnabled, não FlatList — o formulário inteiro já é um
              // ScrollView (mesma direção de rolagem); duas VirtualizedList aninhadas quebram
              // windowing e o RN acusa isso como erro em runtime, mesmo o resto funcionando.
              // Mesmo padrão já usado no sub-seletor de RegistroFormModal.tsx.
              <ScrollView style={styles.listaPdv} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {(pontosVendaQuery.data?.pontos_venda ?? []).map((item) => (
                  <Pressable key={item.id} style={styles.itemPdv} onPress={() => setPontoVenda(item)}>
                    <Text style={styles.itemPdvNome}>{item.fantasia}</Text>
                    {!!item.bairro && <Text style={styles.itemPdvDetalhe}>{item.bairro}</Text>}
                  </Pressable>
                ))}
                {(pontosVendaQuery.data?.pontos_venda ?? []).length === 0 && (
                  <Text style={styles.vazioTexto}>Nenhum PDV encontrado.</Text>
                )}
              </ScrollView>
            )}
          </>
        )}

        <Text style={styles.secaoLabel}>Quando</Text>
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

        <Text style={styles.secaoLabel}>Horário (opcional)</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex.: 14:30"
          value={horario}
          onChangeText={setHorario}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
        />

        {tiposVisitaQuery.data && tiposVisitaQuery.data.length > 0 && (
          <>
            <Text style={styles.secaoLabel}>Tipo de visita (opcional)</Text>
            <View style={styles.chipsLinha}>
              {tiposVisitaQuery.data.map((t) => (
                <Pressable
                  key={t.id}
                  style={[
                    styles.chip,
                    { borderColor: t.cor },
                    tipoVisita?.id === t.id && { backgroundColor: t.cor, borderColor: t.cor },
                  ]}
                  onPress={() => setTipoVisita(tipoVisita?.id === t.id ? null : t)}
                >
                  <Text style={[styles.chipTexto, tipoVisita?.id === t.id && styles.chipTextoSelecionado]}>
                    {t.descricao}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {objetivosVisitaQuery.data && objetivosVisitaQuery.data.length > 0 && (
          <>
            <Text style={styles.secaoLabel}>Objetivo (opcional)</Text>
            <View style={styles.chipsLinha}>
              {objetivosVisitaQuery.data.map((o) => (
                <Pressable
                  key={o.id}
                  style={[styles.chip, objetivoVisita?.id === o.id && styles.chipSelecionado]}
                  onPress={() => setObjetivoVisita(objetivoVisita?.id === o.id ? null : o)}
                >
                  <Text style={[styles.chipTexto, objetivoVisita?.id === o.id && styles.chipTextoSelecionado]}>
                    {o.descricao}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Text style={styles.secaoLabel}>Observação (opcional)</Text>
        <TextInput
          style={[styles.input, styles.inputMultilinha]}
          placeholder="Alguma nota pra você lembrar"
          value={observacao}
          onChangeText={setObservacao}
          multiline
        />

        {erro && <Text style={styles.erroTexto}>{erro}</Text>}

        <Pressable
          style={({ pressed }) => [styles.botaoPrimario, pressed && styles.botaoPressionado]}
          onPress={() => void confirmar()}
          disabled={enviando}
        >
          {enviando ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.botaoPrimarioTexto}>Salvar compromisso</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  conteudo: {
    padding: 20,
    gap: 4,
  },
  secaoLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
    marginTop: 20,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 48,
    fontSize: 15,
    color: '#111827',
  },
  inputMultilinha: {
    minHeight: 80,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  pdvSelecionado: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  pdvSelecionadoTexto: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#1e40af',
  },
  linkTrocar: {
    color: '#2563eb',
    fontWeight: '700',
    fontSize: 13,
  },
  listaPdv: {
    maxHeight: 220,
    marginTop: 4,
  },
  itemPdv: {
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  itemPdvNome: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  itemPdvDetalhe: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  vazioTexto: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 12,
    textAlign: 'center',
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
    marginTop: 24,
    marginBottom: 12,
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
