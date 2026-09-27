import { MaterialCommunityIcons } from '@expo/vector-icons';
import { type NavigationProp, useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BotaoNotificacoes } from '../components/BotaoNotificacoes';
import { obterUltimaSincronizacao } from '../lib/db/database';
import { listarOrdensServicoAgenda } from '../lib/api/ordensServico';
import { buscarPontoVenda, listarPontosVenda } from '../lib/api/pontosVenda';
import { useAuth } from '../lib/auth/AuthContext';
import { useEstaOnline } from '../lib/network';
import { buscarVisitaEmAndamento } from '../lib/visitaLocal';
import type { AgendaStackParamList } from '../navigation/AgendaStack';
import type { MainTabsParamList } from '../navigation/MainTabs';
import type { OrdemServico, StatusOrdemServico } from '../types/api';
import { amber, cores, espaco, indigo, neutro, raio, sombraCard, tipografia, verde, vermelho } from '../theme';

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

function saudacao(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function iniciaisDe(nome: string): string {
  return nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

// Prazo de hoje pro chip "em X min"/"atrasada há X min" do card de destaque — usa o horário
// combinado com a data de hoje quando existe (mais preciso que o prazo_fim, que é o fim da
// janela do dia inteiro), senão cai pro próprio prazo_fim.
function alvoDoCompromisso(os: OrdemServico): Date {
  if (os.horario_previsto) {
    const [h, m] = os.horario_previsto.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  }
  return new Date(os.prazo_fim);
}

function tempoRelativo(alvo: Date): { label: string; atrasado: boolean } {
  const diffMin = Math.round((alvo.getTime() - Date.now()) / 60_000);
  if (diffMin < -1) {
    const min = -diffMin;
    return { label: min < 60 ? `atrasada há ${min} min` : `atrasada há ${Math.floor(min / 60)}h`, atrasado: true };
  }
  if (diffMin <= 1) return { label: 'agora', atrasado: false };
  return { label: diffMin < 60 ? `em ${diffMin} min` : `em ${Math.floor(diffMin / 60)}h`, atrasado: false };
}

// docs/13-AGENDA-MOBILE-E-AUTONOMIA.md — painel do dia (saudação, sincronização, próxima visita
// em destaque, progresso do dia, atalhos) seguido da lista Hoje/Semana (Realizada, Atrasada,
// Aguardando aprovação, ou só o quadrado colorido pra pendente futura). Visual: protótipo Claude
// Design "Home.dc.html" (índigo/âmbar) — ver docs/Trade.mobile app review-handoff.
export function AgendaScreen({ navigation }: Props) {
  const { usuario } = useAuth();
  const online = useEstaOnline();
  // Header nativo desligado nesta tela (ver AgendaStack.tsx) — sem ele, ninguém mais protege o
  // topo do notch/barra de status, então o cabeçalho próprio precisa do inset manualmente.
  const insets = useSafeAreaInsets();
  const [aba, setAba] = useState<Aba>('hoje');
  const [ultimaSincronizacao, setUltimaSincronizacao] = useState<string | null>(null);

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
  // em outra aba, e a lista guardada ainda mostraria "Em andamento". Também atualiza o horário de
  // sincronização mostrado no topo (lido do cache local, não pede rede — ver lib/db/database.ts).
  const { refetch: recarregarAgenda } = agendaQuery;
  useFocusEffect(
    useCallback(() => {
      void recarregarAgenda();
      void obterUltimaSincronizacao().then(setUltimaSincronizacao);
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

  async function abrirCompromisso(os: OrdemServico) {
    // Já existe visita em andamento nesta loja? Vai direto pra ela — passar pelo check-in de novo
    // obrigava o promotor a "iniciar" outra vez algo que já estava aberto.
    const emAndamento = usuario ? await buscarVisitaEmAndamento(usuario.id) : null;
    if (emAndamento && emAndamento.pontoVenda.id === os.ponto_venda.id) {
      navigation.navigate('VisitaAndamento', { visitaLocalId: emAndamento.id });
      return;
    }

    // O mapa pode não ter a loja ainda (lista carregando no primeiro toque, ou uma loja nova
    // desde a última sincronização) — busca ela direto antes de desistir.
    let pontoVenda = pontosVendaPorId.get(os.ponto_venda.id);
    if (!pontoVenda) {
      pontoVenda = await buscarPontoVenda(os.ponto_venda.id).catch(() => undefined);
    }
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

  // Painel do dia — sempre sobre HOJE, independente da aba Hoje/Semana escolhida pra lista de
  // baixo: quando a aba é "semana" a resposta já inclui hoje, só filtra aqui; quando é "hoje" já
  // É a resposta inteira. Evita uma segunda chamada de rede só pra isso.
  const ordensDeHoje = useMemo(
    () => (aba === 'hoje' ? (agendaQuery.data ?? []) : (agendaQuery.data ?? []).filter((os) => os.prazo_fim.slice(0, 10) === hoje)),
    [agendaQuery.data, aba, hoje],
  );
  const proximaOS = useMemo(() => {
    const candidatas = ordensDeHoje.filter((os) => os.status === 'EM_ANDAMENTO' || os.status === 'PENDENTE');
    const emAndamento = candidatas.find((os) => os.status === 'EM_ANDAMENTO');
    if (emAndamento) return emAndamento;
    return [...candidatas].sort((a, b) => alvoDoCompromisso(a).getTime() - alvoDoCompromisso(b).getTime())[0] ?? null;
  }, [ordensDeHoje]);
  const totalHoje = ordensDeHoje.filter((os) => os.status !== 'CANCELADA').length;
  const feitasHoje = ordensDeHoje.filter((os) => os.status === 'CONCLUIDA').length;
  const atrasadasHoje = ordensDeHoje.filter((os) => os.status === 'PENDENTE' && os.prazo_fim < new Date().toISOString()).length;
  const aFazerHoje = Math.max(0, totalHoje - feitasHoje - atrasadasHoje);
  const pctHoje = totalHoje > 0 ? Math.round((feitasHoje / totalHoje) * 100) : 0;

  const navegacaoAbas = navigation.getParent<NavigationProp<MainTabsParamList>>();

  return (
    <View style={styles.container}>
      {agendaQuery.isLoading ? (
        <View style={styles.centro}>
          <ActivityIndicator size="large" color={cores.primaria} />
        </View>
      ) : (
        <FlatList
          data={grupos}
          keyExtractor={(grupo) => grupo.titulo}
          contentContainerStyle={styles.listaConteudo}
          ListHeaderComponent={
            <>
              <View style={[styles.cabecalho, { paddingTop: insets.top + espaco.sm }]}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarTexto}>{usuario ? iniciaisDe(usuario.nome) : ''}</Text>
                </View>
                <View style={styles.cabecalhoTexto}>
                  <Text style={styles.dataHoje}>
                    {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </Text>
                  <Text style={styles.saudacao} numberOfLines={1}>
                    {saudacao()}
                    {usuario ? `, ${usuario.nome.split(' ')[0]}` : ''}
                  </Text>
                </View>
                <BotaoNotificacoes />
              </View>

              <View style={styles.syncLinha}>
                {online ? (
                  <View style={styles.syncPill}>
                    <View style={styles.syncPonto} />
                    <Text style={styles.syncTexto}>
                      {ultimaSincronizacao
                        ? `Sincronizado às ${new Date(ultimaSincronizacao).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                        : 'Sincronizado'}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.offlineBox}>
                    <MaterialCommunityIcons name="wifi-off" size={16} color={amber[700]} />
                    <Text style={styles.offlineTexto}>
                      Você está offline. O que for coletado fica salvo no aparelho e envia sozinho.
                    </Text>
                  </View>
                )}
              </View>

              {proximaOS ? (
                <ProximaVisitaCard ordemServico={proximaOS} onAbrir={() => void abrirCompromisso(proximaOS)} />
              ) : (
                totalHoje === 0 &&
                agendaQuery.isSuccess && (
                  <View style={styles.semCompromissoBox}>
                    <MaterialCommunityIcons name="calendar-check-outline" size={22} color={cores.textoTerciario} />
                    <Text style={styles.semCompromissoTexto}>Nada agendado pra hoje.</Text>
                  </View>
                )
              )}

              {totalHoje > 0 && (
                <View style={styles.progressoCard}>
                  <View style={styles.progressoTopo}>
                    <Text style={styles.progressoTitulo}>Progresso do dia</Text>
                    <Text style={styles.progressoFracao}>
                      <Text style={styles.progressoFracaoNumero}>{feitasHoje}</Text> de {totalHoje} visitas
                    </Text>
                  </View>
                  <View style={styles.progressoTrilho}>
                    <View style={[styles.progressoPreenchido, { width: `${pctHoje}%` }]} />
                  </View>
                  <View style={styles.progressoLegenda}>
                    <LegendaItem cor={verde[600]} texto={`${feitasHoje} realizadas`} />
                    <LegendaItem cor={neutro[300]} texto={`${aFazerHoje} a fazer`} />
                    {atrasadasHoje > 0 && (
                      <LegendaItem cor={vermelho[600]} texto={`${atrasadasHoje} atrasada${atrasadasHoje > 1 ? 's' : ''}`} destaque />
                    )}
                  </View>
                </View>
              )}

              <View style={styles.atalhosLinha}>
                <AtalhoBotao
                  icone="plus"
                  label="Compromisso"
                  onPress={() => navigation.navigate('NovoCompromisso')}
                />
                <AtalhoBotao icone="storefront-outline" label="Lojas" onPress={() => navegacaoAbas?.navigate('PontosVenda')} />
                <AtalhoBotao
                  icone="view-grid-outline"
                  label="Planogramas"
                  onPress={() => navegacaoAbas?.navigate('Planogramas')}
                />
              </View>

              <View style={styles.secaoTopo}>
                <Text style={styles.secaoTituloGrande}>{aba === 'hoje' ? 'Agenda de hoje' : 'Agenda da semana'}</Text>
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
              </View>

              {agendaQuery.isError && (
                <View style={styles.centroInline}>
                  <Text style={styles.erroTexto}>Não foi possível carregar sua agenda.</Text>
                  <Pressable style={styles.botaoRetry} onPress={() => void agendaQuery.refetch()}>
                    <Text style={styles.botaoRetryTexto}>Tentar novamente</Text>
                  </Pressable>
                </View>
              )}

              {agendaQuery.isSuccess && grupos.length === 0 && (
                <Text style={styles.vazioTexto}>
                  {aba === 'hoje' ? 'Nada mais agendado pra hoje.' : 'Nada agendado pra essa semana.'}
                </Text>
              )}
            </>
          }
          renderItem={({ item: grupo }) => (
            <View style={styles.secao}>
              {aba === 'semana' && <Text style={styles.secaoTitulo}>{grupo.titulo}</Text>}
              {grupo.itens.map((os) => (
                <CompromissoCard key={os.id} ordemServico={os} onPress={() => void abrirCompromisso(os)} />
              ))}
            </View>
          )}
        />
      )}
    </View>
  );
}

function LegendaItem({ cor, texto, destaque }: { cor: string; texto: string; destaque?: boolean }) {
  return (
    <View style={styles.legendaItem}>
      <View style={[styles.legendaPonto, { backgroundColor: cor }]} />
      <Text style={[styles.legendaTexto, destaque && { color: vermelho[700], fontWeight: '700' }]}>{texto}</Text>
    </View>
  );
}

function AtalhoBotao({
  icone,
  label,
  onPress,
}: {
  icone: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.atalhoBotao, pressed && styles.atalhoBotaoPressionado]} onPress={onPress}>
      <View style={styles.atalhoIcone}>
        <MaterialCommunityIcons name={icone} size={20} color={cores.primaria} />
      </View>
      <Text style={styles.atalhoTexto}>{label}</Text>
    </Pressable>
  );
}

// Card de destaque com o próximo compromisso do dia (o mais urgente: em andamento, senão o
// pendente mais próximo) — fundo em degradê índigo, CTA em âmbar (mesmo par de cores do resto do
// app, aqui invertido pro botão ficar em primeiro plano sobre o card cheio).
function ProximaVisitaCard({ ordemServico: os, onAbrir }: { ordemServico: OrdemServico; onAbrir: () => void }) {
  const relativo = useMemo(() => tempoRelativo(alvoDoCompromisso(os)), [os]);
  const endereco = [os.ponto_venda.endereco, os.ponto_venda.bairro].filter(Boolean).join(' — ');
  const emAndamento = os.status === 'EM_ANDAMENTO';

  return (
    <View style={styles.heroCard}>
      <View style={styles.heroTopo}>
        <Text style={styles.heroRotulo}>{emAndamento ? 'Em andamento' : 'Próxima visita'}</Text>
        <View style={[styles.heroChip, relativo.atrasado && styles.heroChipAtrasado]}>
          <MaterialCommunityIcons name="clock-outline" size={13} color={relativo.atrasado ? vermelho[100] : amber[300]} />
          <Text style={styles.heroChipTexto}>{relativo.label}</Text>
        </View>
      </View>
      <Text style={styles.heroFantasia} numberOfLines={1}>
        {os.ponto_venda.fantasia}
      </Text>
      {!!endereco && (
        <Text style={styles.heroEndereco} numberOfLines={1}>
          {endereco}
        </Text>
      )}
      <View style={styles.heroTagsLinha}>
        {!!os.horario_previsto && (
          <View style={styles.heroTag}>
            <MaterialCommunityIcons name="calendar-outline" size={13} color={cores.branco} />
            <Text style={styles.heroTagTexto}>{os.horario_previsto}</Text>
          </View>
        )}
        {!!os.tipo_visita && (
          <View style={styles.heroTag}>
            <View style={[styles.heroTagPonto, { backgroundColor: os.tipo_visita.cor }]} />
            <Text style={styles.heroTagTexto}>{os.tipo_visita.descricao}</Text>
          </View>
        )}
      </View>
      <Pressable style={({ pressed }) => [styles.heroBotao, pressed && { opacity: 0.9 }]} onPress={onAbrir}>
        <MaterialCommunityIcons name={emAndamento ? 'arrow-right-circle-outline' : 'map-marker-check-outline'} size={19} color={cores.texto} />
        <Text style={styles.heroBotaoTexto}>{emAndamento ? 'Continuar visita' : 'Fazer check-in'}</Text>
      </Pressable>
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
  listaConteudo: {
    paddingBottom: espaco.xl,
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingHorizontal: espaco.lg,
    paddingTop: espaco.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: cores.primariaMedia,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTexto: {
    color: cores.primariaEscura,
    fontWeight: '700',
    fontSize: 15,
  },
  cabecalhoTexto: {
    flex: 1,
    minWidth: 0,
  },
  dataHoje: {
    fontSize: 13,
    color: cores.textoSecundario,
    textTransform: 'capitalize',
  },
  saudacao: {
    ...tipografia.titulo,
    color: cores.texto,
  },
  syncLinha: {
    paddingHorizontal: espaco.lg,
    marginTop: espaco.md,
  },
  syncPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    height: 26,
    paddingHorizontal: espaco.md,
    borderRadius: raio.pill,
    backgroundColor: cores.sucessoFundo,
  },
  syncPonto: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: verde[600],
  },
  syncTexto: {
    fontSize: 12,
    fontWeight: '600',
    color: cores.sucessoTexto,
  },
  offlineBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm,
    padding: espaco.sm + 2,
    borderRadius: raio.md,
    backgroundColor: cores.acentoClaro,
    borderWidth: 1,
    borderColor: cores.acentoBorda,
  },
  offlineTexto: {
    flex: 1,
    fontSize: 12,
    color: amber[800],
    fontWeight: '600',
  },
  semCompromissoBox: {
    marginHorizontal: espaco.lg,
    marginTop: espaco.md,
    borderRadius: raio.lg,
    borderWidth: 1,
    borderColor: cores.borda,
    backgroundColor: cores.fundoCard,
    padding: espaco.xl,
    alignItems: 'center',
    gap: espaco.sm,
  },
  semCompromissoTexto: {
    fontSize: 14,
    color: cores.textoSecundario,
  },
  heroCard: {
    marginHorizontal: espaco.lg,
    marginTop: espaco.md,
    borderRadius: raio.xl,
    backgroundColor: cores.primaria,
    padding: espaco.lg,
    gap: espaco.md,
    ...sombraCard,
    shadowColor: indigo[800],
    shadowOpacity: 0.35,
    shadowRadius: 16,
  },
  heroTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroRotulo: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: indigo[200],
  },
  heroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: espaco.sm + 2,
    paddingVertical: 4,
    borderRadius: raio.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  heroChipAtrasado: {
    backgroundColor: 'rgba(220,38,38,0.35)',
  },
  heroChipTexto: {
    fontSize: 12,
    fontWeight: '700',
    color: cores.branco,
  },
  heroFantasia: {
    ...tipografia.tituloGrande,
    color: cores.branco,
  },
  heroEndereco: {
    fontSize: 14,
    color: indigo[200],
    marginTop: -8,
  },
  heroTagsLinha: {
    flexDirection: 'row',
    gap: espaco.sm,
    flexWrap: 'wrap',
  },
  heroTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: espaco.sm + 2,
    paddingVertical: 6,
    borderRadius: raio.sm,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  heroTagPonto: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  heroTagTexto: {
    fontSize: 13,
    fontWeight: '600',
    color: cores.branco,
  },
  heroBotao: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: espaco.sm,
    minHeight: 50,
    borderRadius: raio.md,
    backgroundColor: cores.acento,
  },
  heroBotaoTexto: {
    fontSize: 16,
    fontWeight: '700',
    color: cores.texto,
  },
  progressoCard: {
    marginHorizontal: espaco.lg,
    marginTop: espaco.lg,
    borderRadius: raio.lg,
    borderWidth: 1,
    borderColor: cores.borda,
    backgroundColor: cores.fundoCard,
    padding: espaco.lg,
    gap: espaco.sm + 2,
    ...sombraCard,
  },
  progressoTopo: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  progressoTitulo: {
    fontSize: 15,
    fontWeight: '700',
    color: cores.texto,
  },
  progressoFracao: {
    fontSize: 13,
    color: cores.textoSecundario,
  },
  progressoFracaoNumero: {
    fontSize: 17,
    fontWeight: '800',
    color: cores.texto,
  },
  progressoTrilho: {
    height: 8,
    borderRadius: raio.pill,
    backgroundColor: cores.primariaClara,
    overflow: 'hidden',
  },
  progressoPreenchido: {
    height: '100%',
    borderRadius: raio.pill,
    backgroundColor: cores.primaria,
  },
  progressoLegenda: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: espaco.md,
  },
  legendaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendaPonto: {
    width: 8,
    height: 8,
    borderRadius: 3,
  },
  legendaTexto: {
    fontSize: 12,
    color: neutro[600],
  },
  atalhosLinha: {
    flexDirection: 'row',
    gap: espaco.sm,
    paddingHorizontal: espaco.lg,
    marginTop: espaco.lg,
  },
  atalhoBotao: {
    flex: 1,
    minHeight: 76,
    borderWidth: 1,
    borderColor: cores.borda,
    backgroundColor: cores.fundoCard,
    borderRadius: raio.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: espaco.sm,
    paddingVertical: espaco.sm + 2,
  },
  atalhoBotaoPressionado: {
    backgroundColor: cores.primariaClara,
    borderColor: cores.primariaBorda,
  },
  atalhoIcone: {
    width: 40,
    height: 40,
    borderRadius: raio.md,
    backgroundColor: cores.primariaClara,
    alignItems: 'center',
    justifyContent: 'center',
  },
  atalhoTexto: {
    fontSize: 12,
    fontWeight: '600',
    color: neutro[700],
  },
  secaoTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: espaco.lg,
    marginTop: espaco.xl,
    marginBottom: espaco.sm,
  },
  secaoTituloGrande: {
    ...tipografia.subtitulo,
    color: cores.texto,
  },
  segmentado: {
    flexDirection: 'row',
    backgroundColor: neutro[100],
    borderRadius: raio.md,
    padding: 3,
  },
  segmento: {
    paddingVertical: 6,
    paddingHorizontal: espaco.md,
    borderRadius: raio.sm,
  },
  segmentoAtivo: {
    backgroundColor: cores.primaria,
  },
  segmentoTexto: {
    fontSize: 13,
    fontWeight: '600',
    color: cores.textoSecundario,
  },
  segmentoTextoAtivo: {
    color: cores.onPrimaria,
  },
  centro: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centroInline: {
    alignItems: 'center',
    paddingHorizontal: espaco.xxl,
    paddingTop: espaco.xl,
  },
  erroTexto: {
    fontSize: 15,
    color: cores.erro,
    textAlign: 'center',
    marginBottom: espaco.lg,
  },
  vazioTexto: {
    fontSize: 14,
    color: cores.textoSecundario,
    textAlign: 'center',
    paddingHorizontal: espaco.lg,
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
  secao: {
    gap: espaco.sm,
    paddingHorizontal: espaco.lg,
    marginBottom: espaco.lg,
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
});
