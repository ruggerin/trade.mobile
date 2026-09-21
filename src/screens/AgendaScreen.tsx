import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { listarOrdensServicoAgenda } from '../lib/api/ordensServico';
import { listarPontosVenda } from '../lib/api/pontosVenda';
import type { AgendaStackParamList } from '../navigation/AgendaStack';
import type { OrdemServico, StatusOrdemServico } from '../types/api';
import { amber, cores, espaco, indigo, neutro, raio, sombraCard, verde, vermelho } from '../theme';

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
  EM_ANDAMENTO: { label: 'Em andamento', cor: indigo[600] },
  CONCLUIDA: { label: 'Realizada', cor: verde[600] },
  CANCELADA: { label: 'Cancelada', cor: neutro[500] },
  AGUARDANDO_APROVACAO: { label: 'Aguardando aprovação', cor: amber[600] },
  REAGENDAMENTO_SOLICITADO: { label: 'Reagendamento solicitado', cor: amber[600] },
  CANCELAMENTO_SOLICITADO: { label: 'Cancelamento solicitado', cor: amber[600] },
};

// "Atrasada" nunca é gravado — é PENDENTE + prazo_fim no passado, calculado aqui na exibição,
// mesmo padrão do admin web. Ver docs/07-ORDEM-DE-SERVICO.md.
function statusExibicao(os: OrdemServico): { label: string; cor: string } | null {
  if (os.status === 'PENDENTE' && os.prazo_fim < new Date().toISOString()) {
    return { label: 'Atrasada', cor: vermelho[600] };
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

  // Voltar pra aba Agenda sempre recarrega: a visita pode ter sido finalizada enquanto o promotor estava
  // em outra aba, e a lista guardada ainda mostraria "Em andamento".
  const { refetch: recarregarAgenda } = agendaQuery;
  useFocusEffect(
    useCallback(() => {
      void recarregarAgenda();
    }, [recarregarAgenda]),
  );

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
        <Pressable style={styles.linkCompromissoLinha} onPress={() => navigation.navigate('NovoCompromisso')}>
          <MaterialCommunityIcons name="plus" size={16} color={cores.primaria} />
          <Text style={styles.linkCompromisso}>Compromisso</Text>
        </Pressable>
      </View>

      {agendaQuery.isLoading && (
        <View style={styles.centro}>
          <ActivityIndicator size="large" color={cores.primaria} />
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
                />
              ))}
            </View>
          )}
        />
      )}
    </View>
  );
}

// Reagendar/Cancelar NÃO ficam mais aqui: foram pra dentro da tela da loja (AcoesCompromisso), onde o
// toque é intencional — na lista, ao lado do endereço, era fácil demais cancelar sem querer.
function CompromissoCard({ ordemServico, onPress }: { ordemServico: OrdemServico; onPress: () => void }) {
  const status = statusExibicao(ordemServico);
  const corQuadrado = ordemServico.tipo_visita?.cor ?? neutro[400];
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

    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: cores.fundo,
  },
  topo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: espaco.lg,
    paddingTop: espaco.md,
    paddingBottom: espaco.sm,
    backgroundColor: cores.fundoCard,
    borderBottomWidth: 1,
    borderBottomColor: cores.divisor,
  },
  segmentado: {
    flexDirection: 'row',
    backgroundColor: neutro[100],
    borderRadius: raio.md,
    padding: 3,
  },
  segmento: {
    paddingVertical: espaco.sm,
    paddingHorizontal: espaco.lg,
    borderRadius: raio.sm,
  },
  segmentoAtivo: {
    backgroundColor: cores.primaria,
  },
  segmentoTexto: {
    fontSize: 14,
    fontWeight: '600',
    color: cores.textoSecundario,
  },
  segmentoTextoAtivo: {
    color: cores.onPrimaria,
  },
  linkCompromissoLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  linkCompromisso: {
    fontSize: 14,
    fontWeight: '700',
    color: cores.primaria,
  },
  centro: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: espaco.xxl,
    paddingTop: espaco.xxl * 1.5,
  },
  erroTexto: {
    fontSize: 15,
    color: cores.erro,
    textAlign: 'center',
    marginBottom: espaco.lg,
  },
  vazioTexto: {
    fontSize: 15,
    color: cores.textoSecundario,
    textAlign: 'center',
  },
  botaoRetry: {
    backgroundColor: cores.primaria,
    borderRadius: raio.md,
    paddingHorizontal: espaco.lg,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoRetryTexto: {
    color: cores.onPrimaria,
    fontWeight: '700',
    fontSize: 15,
  },
  lista: {
    padding: espaco.lg,
    gap: espaco.xl,
  },
  secao: {
    gap: espaco.sm,
  },
  secaoTitulo: {
    fontSize: 13,
    fontWeight: '700',
    color: cores.textoSecundario,
    textTransform: 'capitalize',
  },
  card: {
    backgroundColor: cores.fundoCard,
    borderRadius: raio.lg,
    padding: espaco.lg,
    borderWidth: 1,
    borderColor: cores.borda,
    minHeight: 48,
    gap: 4,
    ...sombraCard,
  },
  cardPressionado: {
    backgroundColor: neutro[100],
  },
  cardTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm,
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
    color: cores.texto,
  },
  cardHorario: {
    fontSize: 14,
    fontWeight: '600',
    color: neutro[700],
  },
  cardEndereco: {
    fontSize: 13,
    color: cores.textoSecundario,
    marginLeft: 20,
  },
  cardLinhaInferior: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: espaco.sm,
    marginTop: 4,
    marginLeft: 20,
  },
  badge: {
    borderRadius: raio.sm,
    borderWidth: 1,
    paddingHorizontal: espaco.sm,
    paddingVertical: 3,
  },
  badgeTexto: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardObjetivo: {
    fontSize: 12,
    color: cores.textoSecundario,
  },
  cardMotivoRejeicao: {
    fontSize: 12,
    color: cores.erro,
    marginLeft: 20,
    marginTop: 4,
  },
  acoes: {
    flexDirection: 'row',
    gap: 10,
    marginTop: espaco.md,
    marginLeft: 20,
  },
  botaoSecundario: {
    flex: 1,
    minHeight: 44,
    borderRadius: raio.sm,
    borderWidth: 1,
    borderColor: cores.borda,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoSecundarioTexto: {
    color: neutro[700],
    fontWeight: '600',
    fontSize: 14,
  },
  botaoDestrutivo: {
    flex: 1,
    minHeight: 44,
    borderRadius: raio.sm,
    borderWidth: 1,
    borderColor: cores.erroBorda,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoDestrutivoTexto: {
    color: cores.erro,
    fontWeight: '600',
    fontSize: 14,
  },
});
