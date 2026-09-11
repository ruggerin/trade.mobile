import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { cancelarOrdemServico, listarOrdensServicoAgenda } from '../lib/api/ordensServico';
import { listarPontosVenda } from '../lib/api/pontosVenda';
import type { AgendaStackParamList } from '../navigation/AgendaStack';
import type { OrdemServico, StatusOrdemServico } from '../types/api';

type Props = NativeStackScreenProps<AgendaStackParamList, 'AgendaLista'>;
type Aba = 'hoje' | 'semana';

function paraDataISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function maisDias(baseISO: string, dias: number): string {
  const d = new Date(`${baseISO}T00:00:00`);
  d.setDate(d.getDate() + dias);
  return paraDataISO(d);
}

interface Grupo {
  titulo: string;
  itens: OrdemServico[];
}

function agrupar(ordensServico: OrdemServico[], aba: Aba): Grupo[] {
  const ordenados = [...ordensServico].sort((a, b) => a.prazo_fim.localeCompare(b.prazo_fim));

  if (aba === 'hoje') {
    return ordenados.length > 0 ? [{ titulo: 'Hoje', itens: ordenados }] : [];
  }

  const porDia = new Map<string, OrdemServico[]>();
  for (const os of ordenados) {
    const dia = os.prazo_fim.slice(0, 10);
    if (!porDia.has(dia)) porDia.set(dia, []);
    porDia.get(dia)!.push(os);
  }

  return [...porDia.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dia, itens]) => ({
      titulo: new Date(`${dia}T00:00:00`).toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
      }),
      itens,
    }));
}

const STATUS_INFO: Record<StatusOrdemServico, { label: string; cor: string } | null> = {
  PENDENTE: null, // sem selo — só o quadrado colorido, item futuro normal
  EM_ANDAMENTO: { label: 'Em andamento', cor: '#2563eb' },
  CONCLUIDA: { label: 'Realizada', cor: '#16a34a' },
  CANCELADA: { label: 'Cancelada', cor: '#6b7280' },
  AGUARDANDO_APROVACAO: { label: 'Aguardando aprovação', cor: '#d97706' },
  REAGENDAMENTO_SOLICITADO: { label: 'Reagendamento solicitado', cor: '#d97706' },
  CANCELAMENTO_SOLICITADO: { label: 'Cancelamento solicitado', cor: '#d97706' },
};

// "Atrasada" nunca é gravado — é PENDENTE + prazo_fim no passado, calculado aqui na exibição,
// mesmo padrão do admin web. Ver docs/07-ORDEM-DE-SERVICO.md.
function statusExibicao(os: OrdemServico): { label: string; cor: string } | null {
  if (os.status === 'PENDENTE' && os.prazo_fim < new Date().toISOString()) {
    return { label: 'Atrasada', cor: '#dc2626' };
  }
  return STATUS_INFO[os.status];
}

// docs/13-AGENDA-MOBILE-E-AUTONOMIA.md — Hoje/Semana, um card por OrdemServico (Realizada,
// Atrasada, Aguardando aprovação, ou só o quadrado colorido pra pendente futura), Reagendar/
// Cancelar num item PENDENTE, "+ Compromisso" pro promotor se auto-agendar.
export function AgendaScreen({ navigation }: Props) {
  const queryClient = useQueryClient();
  const [aba, setAba] = useState<Aba>('hoje');

  const hoje = useMemo(() => paraDataISO(new Date()), []);
  const janela = useMemo(
    () => (aba === 'hoje' ? { prazoDe: hoje, prazoAte: hoje } : { prazoDe: hoje, prazoAte: maisDias(hoje, 6) }),
    [aba, hoje],
  );

  const agendaQuery = useQuery({
    queryKey: ['ordens-servico-agenda', janela],
    queryFn: () => listarOrdensServicoAgenda(janela),
  });

  // Precisa do PontoVenda inteiro (mapa/distância) pra abrir o check-in — OrdemServico só traz
  // um resumo do PDV. Reaproveita o cache já sincronizado pela aba Lojas.
  const pontosVendaQuery = useQuery({
    queryKey: ['pontos-venda', undefined],
    queryFn: () => listarPontosVenda(),
  });
  const pontosVendaPorId = useMemo(() => {
    const mapa = new Map((pontosVendaQuery.data?.pontos_venda ?? []).map((p) => [p.id, p]));
    return mapa;
  }, [pontosVendaQuery.data]);

  const cancelarCompromisso = (os: OrdemServico) => {
    Alert.alert('Cancelar compromisso', `Cancelar a visita em "${os.ponto_venda.fantasia}"?`, [
      { text: 'Voltar', style: 'cancel' },
      {
        text: 'Cancelar compromisso',
        style: 'destructive',
        onPress: async () => {
          try {
            await cancelarOrdemServico(os.id);
            void queryClient.invalidateQueries({ queryKey: ['ordens-servico-agenda'] });
          } catch {
            Alert.alert('Erro', 'Não foi possível cancelar agora. Tente novamente.');
          }
        },
      },
    ]);
  };

  function abrirCompromisso(os: OrdemServico) {
    const pontoVenda = pontosVendaPorId.get(os.ponto_venda.id);
    if (!pontoVenda) {
      Alert.alert(
        'PDV não encontrado',
        'Não achamos os dados completos deste ponto de venda no aparelho. Abra a aba "Lojas" pra sincronizar e tente de novo.',
      );
      return;
    }
    navigation.navigate('PontoVendaCheckin', { pontoVenda, ordemServico: os });
  }

  const grupos = agrupar(agendaQuery.data ?? [], aba);

  return (
    <View style={styles.container}>
      <View style={styles.topo}>
        <View style={styles.segmentado}>
          <Pressable
            style={[styles.segmento, aba === 'hoje' && styles.segmentoAtivo]}
            onPress={() => setAba('hoje')}
          >
            <Text style={[styles.segmentoTexto, aba === 'hoje' && styles.segmentoTextoAtivo]}>Hoje</Text>
          </Pressable>
          <Pressable
            style={[styles.segmento, aba === 'semana' && styles.segmentoAtivo]}
            onPress={() => setAba('semana')}
          >
            <Text style={[styles.segmentoTexto, aba === 'semana' && styles.segmentoTextoAtivo]}>Semana</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => navigation.navigate('NovoCompromisso')}>
          <Text style={styles.linkCompromisso}>+ Compromisso</Text>
        </Pressable>
      </View>

      {agendaQuery.isLoading && (
        <View style={styles.centro}>
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      )}

      {agendaQuery.isError && (
        <View style={styles.centro}>
          <Text style={styles.erroTexto}>Não foi possível carregar sua agenda.</Text>
          <Pressable style={styles.botaoRetry} onPress={() => void agendaQuery.refetch()}>
            <Text style={styles.botaoRetryTexto}>Tentar novamente</Text>
          </Pressable>
        </View>
      )}

      {agendaQuery.isSuccess && grupos.length === 0 && (
        <View style={styles.centro}>
          <Text style={styles.vazioTexto}>
            {aba === 'hoje' ? 'Nada agendado pra hoje.' : 'Nada agendado pra essa semana.'}
          </Text>
        </View>
      )}

      {agendaQuery.isSuccess && grupos.length > 0 && (
        <FlatList
          data={grupos}
          keyExtractor={(grupo) => grupo.titulo}
          contentContainerStyle={styles.lista}
          renderItem={({ item: grupo }) => (
            <View style={styles.secao}>
              {aba === 'semana' && <Text style={styles.secaoTitulo}>{grupo.titulo}</Text>}
              {grupo.itens.map((os) => (
                <CompromissoCard
                  key={os.id}
                  ordemServico={os}
                  onPress={() => abrirCompromisso(os)}
                  onReagendar={() => navigation.navigate('ReagendarCompromisso', { ordemServico: os })}
                  onCancelar={() => cancelarCompromisso(os)}
                />
              ))}
            </View>
          )}
        />
      )}
    </View>
  );
}

function CompromissoCard({
  ordemServico,
  onPress,
  onReagendar,
  onCancelar,
}: {
  ordemServico: OrdemServico;
  onPress: () => void;
  onReagendar: () => void;
  onCancelar: () => void;
}) {
  const status = statusExibicao(ordemServico);
  const podeReagendarOuCancelar = ordemServico.status === 'PENDENTE';
  const corQuadrado = ordemServico.tipo_visita?.cor ?? '#9ca3af';
  const endereco = [ordemServico.ponto_venda.endereco, ordemServico.ponto_venda.bairro].filter(Boolean).join(' — ');

  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.cardPressionado]} onPress={onPress}>
      <View style={styles.cardTopo}>
        <View style={[styles.quadrado, { backgroundColor: corQuadrado }]} />
        <Text style={styles.cardFantasia} numberOfLines={1}>
          {ordemServico.ponto_venda.fantasia}
        </Text>
        {!!ordemServico.horario_previsto && <Text style={styles.cardHorario}>{ordemServico.horario_previsto}</Text>}
      </View>
      {!!endereco && <Text style={styles.cardEndereco}>{endereco}</Text>}

      <View style={styles.cardLinhaInferior}>
        {status && (
          <View style={[styles.badge, { backgroundColor: `${status.cor}1A`, borderColor: status.cor }]}>
            <Text style={[styles.badgeTexto, { color: status.cor }]}>{status.label}</Text>
          </View>
        )}
        {!!ordemServico.objetivo_visita && (
          <Text style={styles.cardObjetivo}>Objetivo: {ordemServico.objetivo_visita.descricao}</Text>
        )}
      </View>

      {/* Fica visível mesmo depois do status voltar pra PENDENTE — sem isso o promotor não
          teria como saber que um pedido dele foi negado. Ver docs/13-AGENDA-MOBILE-E-AUTONOMIA.md. */}
      {ordemServico.status === 'PENDENTE' && !!ordemServico.motivo_rejeicao && (
        <Text style={styles.cardMotivoRejeicao}>Rejeitado: {ordemServico.motivo_rejeicao}</Text>
      )}

      {podeReagendarOuCancelar && (
        <View style={styles.acoes}>
          <Pressable style={styles.botaoSecundario} onPress={onReagendar}>
            <Text style={styles.botaoSecundarioTexto}>Reagendar</Text>
          </Pressable>
          <Pressable style={styles.botaoDestrutivo} onPress={onCancelar}>
            <Text style={styles.botaoDestrutivoTexto}>Cancelar</Text>
          </Pressable>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  topo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  segmentado: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    padding: 3,
  },
  segmento: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  segmentoAtivo: {
    backgroundColor: '#2563eb',
  },
  segmentoTexto: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
  },
  segmentoTextoAtivo: {
    color: '#ffffff',
  },
  linkCompromisso: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2563eb',
  },
  centro: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 48,
  },
  erroTexto: {
    fontSize: 15,
    color: '#b91c1c',
    textAlign: 'center',
    marginBottom: 16,
  },
  vazioTexto: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
  },
  botaoRetry: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingHorizontal: 20,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoRetryTexto: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
  lista: {
    padding: 16,
    gap: 20,
  },
  secao: {
    gap: 10,
  },
  secaoTitulo: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'capitalize',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    minHeight: 48,
    gap: 4,
  },
  cardPressionado: {
    backgroundColor: '#f3f4f6',
  },
  cardTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  quadrado: {
    width: 12,
    height: 12,
    borderRadius: 3,
  },
  cardFantasia: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  cardHorario: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  cardEndereco: {
    fontSize: 13,
    color: '#6b7280',
    marginLeft: 20,
  },
  cardLinhaInferior: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
    marginLeft: 20,
  },
  badge: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeTexto: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardObjetivo: {
    fontSize: 12,
    color: '#6b7280',
  },
  cardMotivoRejeicao: {
    fontSize: 12,
    color: '#b91c1c',
    marginLeft: 20,
    marginTop: 4,
  },
  acoes: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    marginLeft: 20,
  },
  botaoSecundario: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoSecundarioTexto: {
    color: '#374151',
    fontWeight: '600',
    fontSize: 14,
  },
  botaoDestrutivo: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fecaca',
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoDestrutivoTexto: {
    color: '#b91c1c',
    fontWeight: '600',
    fontSize: 14,
  },
});
