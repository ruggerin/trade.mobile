import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ComentariosRegistroModal } from '../components/ComentariosRegistroModal';
import { ImagemAutenticada } from '../components/ImagemAutenticada';
import { buscarNaoLidos } from '../lib/api/comentarios';
import { buscarVisita, cancelarRegistro } from '../lib/api/visitas';
import { buscarCancelamentoRegistroPermitido } from '../lib/api/parametros';
import type { StatusVisita, Visita, VisitaRegistro } from '../types/api';
import { amber, cores, espaco, indigo, neutro, raio, sombraCard, tipografia, vermelho } from '../theme';

// Tipo mínimo dos params, não importado de HistoricoStackParamList — esta tela é registrada em
// mais de uma stack (Histórico, Lojas, Agenda — ver PontosVendaStack.tsx/AgendaStack.tsx) pra
// que "voltar" respeite de onde o promotor veio, em vez de sempre cair no índice do Histórico.
export type VisitaDetalheParams = { visitaId: string; visita?: Visita; abrirRegistroId?: string };
type Props = NativeStackScreenProps<{ VisitaDetalhe: VisitaDetalheParams }, 'VisitaDetalhe'>;

const STATUS_INFO: Record<StatusVisita, { label: string; bg: string; texto: string }> = {
  ABERTA: { label: 'Aberta', bg: cores.primariaClara, texto: cores.primariaEscura },
  FINALIZADA: { label: 'Finalizada', bg: cores.sucessoFundo, texto: cores.sucesso },
  CANCELADA: { label: 'Cancelada', bg: cores.divisor, texto: cores.textoSecundario },
};

type Filtro = 'todos' | 'ruptura' | 'comentarios';

function formatarDuracao(inicioISO: string, fimISO: string): string {
  const seg = Math.max(0, Math.floor((new Date(fimISO).getTime() - new Date(inicioISO).getTime()) / 1000));
  const h = Math.floor(seg / 3600);
  const min = Math.floor(seg / 60) % 60;
  return h > 0 ? `${h}h ${String(min).padStart(2, '0')}min` : `${min}min`;
}

// docs/05-APP-MOBILE-UX.md §3.7 — mesmos dados da tela de visita em andamento, mas sem
// nenhuma ação (só leitura): sem "Registro geral", sem "Finalizar visita". Chegada por dois
// caminhos (docs/29-NOTIFICACOES-MOBILE.md): do Histórico, que já tem o objeto `Visita` inteiro
// (`visita` no param, usado como `initialData` — sem round-trip); ou de uma notificação, que só
// tem `visitaId` e busca do zero, com `abrirRegistroId` pra já abrir a conversa certa.
export function VisitaDetalheScreen({ route }: Props) {
  const { visitaId, visita: visitaInicial, abrirRegistroId } = route.params;
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);
  // Feedback do gestor (docs/28 §3) — registro aberto no modal + quais têm resposta não lida.
  const [feedbackRegistro, setFeedbackRegistro] = useState<VisitaRegistro | null>(null);
  // Ficha de detalhe (fotos em tamanho grande + todos os campos) — toque no card abre.
  const [registroExpandido, setRegistroExpandido] = useState<VisitaRegistro | null>(null);
  const naoLidosQuery = useQuery({ queryKey: ['comentarios-nao-lidos'], queryFn: buscarNaoLidos, retry: false });
  const registrosComNaoLido = useMemo(
    () => new Set((naoLidosQuery.data?.registros ?? []).map((r) => r.registro_id)),
    [naoLidosQuery.data],
  );

  const query = useQuery({
    queryKey: ['visita', visitaId],
    queryFn: () => buscarVisita(visitaId),
    initialData: visitaInicial,
  });

  // Abre a conversa direto ao chegar de uma notificação — só uma vez (o ref evita reabrir depois
  // que o promotor fecha o modal e a query revalida por outro motivo).
  const abriuAutomaticoRef = useRef(false);
  useEffect(() => {
    if (abriuAutomaticoRef.current || !abrirRegistroId || !query.data?.registros) return;
    const registro = query.data.registros.find((r) => r.id === abrirRegistroId);
    if (registro) {
      abriuAutomaticoRef.current = true;
      setFeedbackRegistro(registro);
    }
  }, [abrirRegistroId, query.data]);

  const cancelamentoPermitidoQuery = useQuery({
    queryKey: ['cancelamento-registro-permitido'],
    queryFn: buscarCancelamentoRegistroPermitido,
  });
  const cancelamentoPermitido = cancelamentoPermitidoQuery.data ?? false;

  const cancelarMutation = useMutation({
    mutationFn: (registroId: string) => cancelarRegistro(visitaId, registroId),
    onSuccess: () => {
      setErro(null);
      void queryClient.invalidateQueries({ queryKey: ['visita', visitaId] });
    },
    onError: () => setErro('Não foi possível cancelar o registro agora. Tente de novo.'),
  });

  function confirmarCancelamento(registro: VisitaRegistro) {
    Alert.alert('Cancelar registro', 'Tem certeza? Essa ação não pode ser desfeita.', [
      { text: 'Voltar', style: 'cancel' },
      { text: 'Cancelar registro', style: 'destructive', onPress: () => cancelarMutation.mutate(registro.id) },
    ]);
  }

  const visita = query.data;
  // Cancelado é soft no servidor (mantém rastro histórico), mas some da lista igual qualquer
  // "cancelar" — mesmo raciocínio do filtro de DESCARTADO na visita em andamento.
  const registrosValidos = useMemo(() => (visita?.registros ?? []).filter((r) => !r.cancelado_em), [visita?.registros]);
  const [filtro, setFiltro] = useState<Filtro>('todos');

  const registroComNovaResposta = useMemo(
    () => registrosValidos.find((r) => registrosComNaoLido.has(r.id)) ?? null,
    [registrosValidos, registrosComNaoLido],
  );

  const registros = useMemo(() => {
    if (filtro === 'ruptura') return registrosValidos.filter((r) => r.ruptura);
    if (filtro === 'comentarios') return registrosValidos.filter((r) => (r.comentarios_count ?? 0) > 0);
    return registrosValidos;
  }, [registrosValidos, filtro]);

  const pontuados = registrosValidos.filter((r) => r.pontuacao !== null);
  const compliance = pontuados.length
    ? `${Math.round(pontuados.reduce((soma, r) => soma + (r.pontuacao ?? 0), 0) / pontuados.length)}%`
    : '—';
  const nRupturas = registrosValidos.filter((r) => r.ruptura).length;
  const nComComentarios = registrosValidos.filter((r) => (r.comentarios_count ?? 0) > 0).length;

  // Sem initialData (chegada por notificação, só com `visitaId`) o primeiro render não tem
  // `visita` ainda — diferente de antes, quando o objeto vinha sempre pronto do Histórico.
  if (!visita) {
    return (
      <View style={[styles.container, styles.centro]}>
        <ActivityIndicator color={cores.primaria} />
      </View>
    );
  }

  const status = STATUS_INFO[visita.status];
  const inicio = new Date(visita.inicio_data);
  const fim = visita.fim_data ? new Date(visita.fim_data) : null;

  const filtros: { chave: Filtro; label: string; n: number }[] = [
    { chave: 'todos', label: 'Todos', n: registrosValidos.length },
    { chave: 'ruptura', label: 'Rupturas', n: nRupturas },
    { chave: 'comentarios', label: 'Com comentários', n: nComComentarios },
  ];

  return (
    <View style={styles.container}>
      <FlatList
        data={registros}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.lista}
        ListHeaderComponent={
          <>
            <View style={styles.cabecalho}>
              <View style={[styles.badge, styles.badgeTopo, { backgroundColor: status.bg }]}>
                <Text style={[styles.badgeTexto, { color: status.texto }]}>{status.label}</Text>
              </View>
              <Text style={styles.pdvNome}>{visita.ponto_venda?.fantasia}</Text>

              <View style={styles.timelineCard}>
                <View style={styles.timelineLado}>
                  <Text style={styles.timelineRotulo}>Check-in</Text>
                  <Text style={styles.timelineHora}>
                    {inicio.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                  <Text style={styles.timelineData}>{inicio.toLocaleDateString('pt-BR')}</Text>
                </View>
                <View style={styles.timelineMeio}>
                  {fim && <Text style={styles.timelineDuracao}>{formatarDuracao(visita.inicio_data, visita.fim_data!)}</Text>}
                  <View style={styles.timelineLinha}>
                    <View style={styles.timelinePonto} />
                    <View style={styles.timelineTraco} />
                    <View style={styles.timelinePonto} />
                  </View>
                </View>
                <View style={[styles.timelineLado, styles.timelineLadoDireita]}>
                  <Text style={styles.timelineRotulo}>Check-out</Text>
                  <Text style={styles.timelineHora}>
                    {fim ? fim.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </Text>
                  <Text style={styles.timelineData}>{fim ? fim.toLocaleDateString('pt-BR') : ''}</Text>
                </View>
              </View>

              <View style={styles.statsLinha}>
                <View style={styles.statCard}>
                  <Text style={styles.statNumero}>{registrosValidos.length}</Text>
                  <Text style={styles.statLabel}>Registros</Text>
                </View>
                <View style={[styles.statCard, styles.statCardCompliance]}>
                  <Text style={[styles.statNumero, styles.statNumeroCompliance]}>{compliance}</Text>
                  <Text style={[styles.statLabel, styles.statLabelCompliance]}>Compliance</Text>
                </View>
                <View style={[styles.statCard, styles.statCardRuptura]}>
                  <Text style={[styles.statNumero, styles.statNumeroRuptura]}>{nRupturas}</Text>
                  <Text style={[styles.statLabel, styles.statLabelRuptura]}>Rupturas</Text>
                </View>
              </View>

              {registroComNovaResposta && (
                <Pressable style={styles.novaRespostaBox} onPress={() => setFeedbackRegistro(registroComNovaResposta)}>
                  <View style={styles.novaRespostaIcone}>
                    <MaterialCommunityIcons name="message-reply-text-outline" size={18} color={cores.branco} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.novaRespostaTitulo}>Nova resposta do gestor</Text>
                    <Text style={styles.novaRespostaTexto} numberOfLines={1}>
                      em{' '}
                      {registroComNovaResposta.produto_auditoria?.descricao ??
                        registroComNovaResposta.tipo_registro.descricao}
                    </Text>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={20} color={indigo[600]} />
                </Pressable>
              )}

              {erro && (
                <View style={styles.erroBox}>
                  <Text style={styles.erroBoxTexto}>{erro}</Text>
                </View>
              )}

              <View style={styles.secaoTopo}>
                <Text style={styles.secaoTitulo}>Registros</Text>
              </View>
              <FlatList
                horizontal
                data={filtros}
                keyExtractor={(f) => f.chave}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filtrosConteudo}
                renderItem={({ item: f }) => (
                  <Pressable
                    style={[styles.filtroChip, filtro === f.chave && styles.filtroChipAtivo]}
                    onPress={() => setFiltro(f.chave)}
                  >
                    <Text style={[styles.filtroChipTexto, filtro === f.chave && styles.filtroChipTextoAtivo]}>
                      {f.label}
                    </Text>
                    <Text style={[styles.filtroChipContagem, filtro === f.chave && styles.filtroChipTextoAtivo]}>
                      {f.n}
                    </Text>
                  </Pressable>
                )}
              />
            </View>
          </>
        }
        ListEmptyComponent={
          <View style={styles.centro}>
            <Text style={styles.vazioTexto}>Nenhum registro nesse filtro.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <RegistroCard
            registro={item}
            podeCancelar={cancelamentoPermitido}
            cancelando={cancelarMutation.isPending && cancelarMutation.variables === item.id}
            onCancelar={() => confirmarCancelamento(item)}
            naoLido={registrosComNaoLido.has(item.id)}
            onFeedback={() => setFeedbackRegistro(item)}
            onAbrir={() => setRegistroExpandido(item)}
          />
        )}
      />

      <RegistroExpandidoModal
        registro={registroExpandido}
        naoLido={registroExpandido ? registrosComNaoLido.has(registroExpandido.id) : false}
        onClose={() => setRegistroExpandido(null)}
        onFeedback={() => {
          setFeedbackRegistro(registroExpandido);
          setRegistroExpandido(null);
        }}
      />

      <ComentariosRegistroModal
        visible={feedbackRegistro !== null}
        visitaUuid={visitaId}
        registroUuid={feedbackRegistro?.id ?? null}
        titulo={feedbackRegistro?.produto_auditoria?.descricao ?? feedbackRegistro?.tipo_registro.descricao ?? 'Registro'}
        onClose={() => setFeedbackRegistro(null)}
      />
    </View>
  );
}

function RegistroCard({
  registro,
  podeCancelar,
  cancelando,
  onCancelar,
  naoLido,
  onFeedback,
  onAbrir,
}: {
  registro: VisitaRegistro;
  podeCancelar: boolean;
  cancelando: boolean;
  onCancelar: () => void;
  naoLido: boolean;
  onFeedback: () => void;
  onAbrir: () => void;
}) {
  const vinculoLabel = registro.secao?.descricao ?? registro.departamento?.descricao ?? registro.marca?.descricao;
  const tituloPrincipal = registro.produto_auditoria?.descricao ?? vinculoLabel ?? registro.tipo_registro.descricao;
  const valoresCampos = registro.valores_campos ? Object.entries(registro.valores_campos) : [];

  const comentariosLabel =
    (registro.comentarios_count ?? 0) === 0
      ? 'Comentar'
      : `${registro.comentarios_count} ${registro.comentarios_count === 1 ? 'comentário' : 'comentários'}`;

  return (
    <View style={styles.registroCardV2}>
      <Pressable style={styles.registroCorpo} onPress={onAbrir}>
        <View style={styles.registroThumb}>
          {registro.imagens.length > 0 ? (
            <>
              <ImagemAutenticada uri={registro.imagens[0].url} style={styles.registroThumbImagem} />
              {registro.imagens.length > 1 && (
                <View style={styles.registroThumbBadge}>
                  <Text style={styles.registroThumbBadgeTexto}>+{registro.imagens.length - 1}</Text>
                </View>
              )}
            </>
          ) : (
            <MaterialCommunityIcons name="image-outline" size={22} color={cores.textoTerciario} />
          )}
        </View>
        <View style={styles.registroInfo}>
          <Text style={styles.registroTipo} numberOfLines={1}>
            {tituloPrincipal}
          </Text>
          <Text style={styles.registroObservacao}>{registro.tipo_registro.descricao}</Text>
          {valoresCampos.length > 0 && (
            <Text style={styles.registroValores} numberOfLines={1}>
              {valoresCampos.map(([, valor]) => valor).join(' · ')}
            </Text>
          )}
          {!!registro.observacao && <Text style={styles.registroObservacao}>{registro.observacao}</Text>}
          <View style={styles.registroTagsLinha}>
            {registro.ruptura && <Text style={styles.badgeRuptura}>Ruptura</Text>}
            {registro.pontuacao !== null && (
              <Text style={styles.badgePontuacao}>{registro.pontuacao}% compliance</Text>
            )}
          </View>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={cores.textoTerciario} />
      </Pressable>
      <View style={styles.registroRodape}>
        <Pressable onPress={onFeedback} hitSlop={8} style={styles.linkFeedbackLinha}>
          <MaterialCommunityIcons name="message-reply-text-outline" size={16} color={cores.primaria} />
          <Text style={styles.linkFeedback}>{comentariosLabel}</Text>
          {naoLido && (
            <View style={styles.badgeNova}>
              <Text style={styles.badgeNovaTexto}>NOVA</Text>
            </View>
          )}
        </Pressable>
        {podeCancelar && (
          <Pressable onPress={onCancelar} disabled={cancelando} hitSlop={8}>
            <Text style={styles.linkCancelar}>{cancelando ? 'Cancelando...' : 'Cancelar registro'}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// Ficha de detalhe do registro — fotos em tamanho grande (com paginação) + todos os campos,
// igual ao protótipo Claude Design ("Visita Detalhe.dc.html", sc-if temAberto). Só leitura, o
// link de comentários fecha esta ficha e abre o ComentariosRegistroModal por cima.
function RegistroExpandidoModal({
  registro,
  naoLido,
  onClose,
  onFeedback,
}: {
  registro: VisitaRegistro | null;
  naoLido: boolean;
  onClose: () => void;
  onFeedback: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [fotoAtiva, setFotoAtiva] = useState(0);
  const larguraFoto = useRef(0);

  useEffect(() => {
    setFotoAtiva(0);
  }, [registro?.id]);

  if (!registro) return null;

  const vinculoLabel = registro.secao?.descricao ?? registro.departamento?.descricao ?? registro.marca?.descricao;
  const tituloPrincipal = registro.produto_auditoria?.descricao ?? vinculoLabel ?? registro.tipo_registro.descricao;
  const valoresCampos = registro.valores_campos ? Object.entries(registro.valores_campos) : [];
  const comentariosLabel =
    (registro.comentarios_count ?? 0) === 0
      ? 'Comentar'
      : `${registro.comentarios_count} ${registro.comentarios_count === 1 ? 'comentário' : 'comentários'}`;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.expandidoFundo}>
        <Pressable style={styles.expandidoBackdrop} onPress={onClose} />
        <View style={styles.expandidoSheet}>
          <View style={styles.alcaWrap}>
            <View style={styles.alca} />
          </View>
          <View style={styles.expandidoCabecalho}>
            <Text style={styles.expandidoCabecalhoTitulo}>Detalhes do registro</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.expandidoFechar}>Fechar</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={[styles.expandidoConteudo, { paddingBottom: espaco.xl + insets.bottom }]}>
            {registro.imagens.length > 0 ? (
              <>
                <ScrollView
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  onLayout={(e) => (larguraFoto.current = e.nativeEvent.layout.width)}
                  onMomentumScrollEnd={(e) => {
                    if (larguraFoto.current > 0) {
                      setFotoAtiva(Math.round(e.nativeEvent.contentOffset.x / larguraFoto.current));
                    }
                  }}
                  style={styles.expandidoCarrossel}
                >
                  {registro.imagens.map((imagem) => (
                    <ImagemAutenticada
                      key={imagem.id}
                      uri={imagem.url}
                      style={styles.expandidoFoto}
                      resizeMode="contain"
                    />
                  ))}
                </ScrollView>
                {registro.imagens.length > 1 && (
                  <View style={styles.expandidoPontos}>
                    {registro.imagens.map((imagem, i) => (
                      <View key={imagem.id} style={[styles.expandidoPonto, i === fotoAtiva && styles.expandidoPontoAtivo]} />
                    ))}
                  </View>
                )}
              </>
            ) : (
              <View style={[styles.expandidoFoto, styles.expandidoFotoVazia]}>
                <MaterialCommunityIcons name="image-outline" size={32} color={cores.textoTerciario} />
                <Text style={styles.registroObservacao}>Sem foto</Text>
              </View>
            )}

            <View style={{ gap: 2 }}>
              <Text style={styles.expandidoTitulo}>{tituloPrincipal}</Text>
              <Text style={styles.expandidoSubtitulo}>{registro.tipo_registro.descricao}</Text>
            </View>

            {(registro.ruptura || registro.pontuacao !== null) && (
              <View style={styles.registroTagsLinha}>
                {registro.ruptura && <Text style={styles.badgeRuptura}>Ruptura</Text>}
                {registro.pontuacao !== null && (
                  <Text style={styles.badgePontuacao}>{registro.pontuacao}% compliance</Text>
                )}
              </View>
            )}

            {(valoresCampos.length > 0 || !!vinculoLabel) && (
              <View style={styles.expandidoLinhasBox}>
                {!!vinculoLabel && (
                  <View style={styles.expandidoLinha}>
                    <Text style={styles.expandidoLinhaRotulo}>Vínculo</Text>
                    <Text style={styles.expandidoLinhaValor}>{vinculoLabel}</Text>
                  </View>
                )}
                {valoresCampos.map(([chave, valor], i) => (
                  <View key={chave} style={[styles.expandidoLinha, (i > 0 || !!vinculoLabel) && styles.expandidoLinhaBorda]}>
                    <Text style={styles.expandidoLinhaRotulo}>{chave}</Text>
                    <Text style={styles.expandidoLinhaValor}>{valor}</Text>
                  </View>
                ))}
              </View>
            )}

            {!!registro.observacao && (
              <View style={{ gap: 4 }}>
                <Text style={styles.expandidoRotuloSecao}>Observação</Text>
                <Text style={styles.expandidoObservacao}>{registro.observacao}</Text>
              </View>
            )}

            <Pressable style={({ pressed }) => [styles.expandidoBotaoComentar, pressed && { opacity: 0.9 }]} onPress={onFeedback}>
              <MaterialCommunityIcons name="message-reply-text-outline" size={18} color={cores.branco} />
              <Text style={styles.expandidoBotaoComentarTexto}>{comentariosLabel}</Text>
              {naoLido && (
                <View style={styles.badgeNova}>
                  <Text style={styles.badgeNovaTexto}>NOVA</Text>
                </View>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: cores.fundo,
  },
  // Sem paddingHorizontal aqui de propósito — este cabeçalho é o ListHeaderComponent do FlatList
  // de registros logo abaixo, que já aplica padding horizontal no contentContainerStyle
  // (`lista`). Repetir o padding aqui somava os dois (32px em vez de 16px) e desalinhava o
  // cabeçalho em relação aos cards da lista.
  cabecalho: {
    backgroundColor: cores.fundo,
    paddingTop: espaco.md,
    gap: espaco.md,
  },
  badgeTopo: {
    alignSelf: 'flex-start',
  },
  pdvNome: {
    ...tipografia.tituloGrande,
    color: cores.texto,
    marginTop: -4,
  },
  badge: {
    borderRadius: raio.pill,
    paddingHorizontal: espaco.sm + 2,
    paddingVertical: 4,
  },
  badgeTexto: {
    fontSize: 12,
    fontWeight: '700',
  },
  timelineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: cores.fundoCard,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.lg,
    padding: espaco.md,
    ...sombraCard,
  },
  timelineLado: {
    flex: 1,
  },
  timelineLadoDireita: {
    alignItems: 'flex-end',
  },
  timelineRotulo: {
    fontSize: 12,
    fontWeight: '600',
    color: cores.textoSecundario,
  },
  timelineHora: {
    fontSize: 19,
    fontWeight: '800',
    color: cores.texto,
  },
  timelineData: {
    fontSize: 12,
    color: cores.textoTerciario,
  },
  timelineMeio: {
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: espaco.sm,
  },
  timelineDuracao: {
    fontSize: 12,
    fontWeight: '700',
    color: indigo[700],
    backgroundColor: indigo[100],
    borderRadius: raio.pill,
    paddingHorizontal: espaco.sm,
    paddingVertical: 3,
  },
  timelineLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  timelinePonto: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: cores.primaria,
  },
  timelineTraco: {
    width: 32,
    height: 2,
    backgroundColor: indigo[200],
  },
  statsLinha: {
    flexDirection: 'row',
    gap: espaco.sm,
  },
  statCard: {
    flex: 1,
    backgroundColor: cores.fundoCard,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.md,
    padding: espaco.sm + 2,
  },
  statCardCompliance: {
    backgroundColor: amber[50],
    borderColor: amber[200],
  },
  statCardRuptura: {
    backgroundColor: vermelho[50],
    borderColor: vermelho[200],
  },
  statNumero: {
    fontSize: 20,
    fontWeight: '800',
    color: cores.texto,
  },
  statNumeroCompliance: {
    color: amber[800],
  },
  statNumeroRuptura: {
    color: vermelho[700],
  },
  statLabel: {
    fontSize: 12,
    color: cores.textoSecundario,
  },
  statLabelCompliance: {
    color: amber[800],
  },
  statLabelRuptura: {
    color: vermelho[700],
  },
  novaRespostaBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    backgroundColor: indigo[50],
    borderWidth: 1,
    borderColor: indigo[200],
    borderRadius: raio.lg,
    padding: espaco.md,
  },
  novaRespostaIcone: {
    width: 36,
    height: 36,
    borderRadius: raio.md,
    backgroundColor: cores.primaria,
    alignItems: 'center',
    justifyContent: 'center',
  },
  novaRespostaTitulo: {
    fontSize: 14,
    fontWeight: '700',
    color: indigo[900],
  },
  novaRespostaTexto: {
    fontSize: 13,
    color: indigo[700],
  },
  secaoTopo: {
    marginTop: espaco.sm,
  },
  secaoTitulo: {
    fontSize: 17,
    fontWeight: '700',
    color: cores.texto,
  },
  filtrosConteudo: {
    gap: espaco.sm,
    paddingVertical: espaco.sm,
  },
  filtroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: espaco.md,
    borderRadius: raio.pill,
    borderWidth: 1,
    borderColor: cores.borda,
    backgroundColor: cores.fundoCard,
  },
  filtroChipAtivo: {
    backgroundColor: cores.primaria,
    borderColor: cores.primaria,
  },
  filtroChipTexto: {
    fontSize: 13,
    fontWeight: '600',
    color: cores.texto,
  },
  filtroChipContagem: {
    fontSize: 12,
    fontWeight: '700',
    color: cores.textoSecundario,
  },
  filtroChipTextoAtivo: {
    color: cores.onPrimaria,
  },
  centro: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: espaco.xxl * 1.5,
  },
  vazioTexto: {
    fontSize: 15,
    color: cores.textoSecundario,
    textAlign: 'center',
  },
  lista: {
    padding: espaco.lg,
    paddingTop: 0,
    gap: espaco.md,
    flexGrow: 1,
  },
  registroCardV2: {
    backgroundColor: cores.fundoCard,
    borderRadius: raio.lg,
    borderWidth: 1,
    borderColor: cores.borda,
    overflow: 'hidden',
    ...sombraCard,
  },
  registroCorpo: {
    flexDirection: 'row',
    gap: espaco.md,
    padding: espaco.md,
  },
  registroThumb: {
    width: 64,
    height: 64,
    borderRadius: raio.md,
    backgroundColor: cores.fundo,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  registroThumbImagem: {
    width: '100%',
    height: '100%',
  },
  registroThumbBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    backgroundColor: 'rgba(17,24,39,0.72)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  registroThumbBadgeTexto: {
    color: cores.branco,
    fontSize: 11,
    fontWeight: '700',
  },
  registroInfo: {
    flex: 1,
    minWidth: 0,
  },
  registroTipo: {
    fontSize: 15,
    fontWeight: '700',
    color: cores.texto,
  },
  registroObservacao: {
    fontSize: 13,
    color: cores.textoSecundario,
    marginTop: 2,
  },
  registroValores: {
    fontSize: 13,
    color: neutro[700],
    marginTop: 2,
  },
  registroTagsLinha: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    marginTop: espaco.xs,
  },
  badgeRuptura: {
    alignSelf: 'flex-start',
    backgroundColor: cores.erroFundo,
    color: cores.erro,
    fontSize: 11,
    fontWeight: '700',
    borderRadius: raio.sm,
    paddingHorizontal: espaco.sm,
    paddingVertical: 2,
  },
  badgePontuacao: {
    alignSelf: 'flex-start',
    backgroundColor: cores.acentoClaro,
    color: cores.acentoTexto,
    fontSize: 11,
    fontWeight: '700',
    borderRadius: raio.sm,
    paddingHorizontal: espaco.sm,
    paddingVertical: 2,
  },
  registroRodape: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: espaco.md,
    height: 44,
    borderTopWidth: 1,
    borderTopColor: cores.divisor,
  },
  linkFeedbackLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  linkFeedback: {
    color: cores.primaria,
    fontSize: 13,
    fontWeight: '700',
  },
  badgeNova: {
    backgroundColor: amber[500],
    borderRadius: raio.pill,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  badgeNovaTexto: {
    fontSize: 10,
    fontWeight: '800',
    color: cores.texto,
  },
  linkCancelar: {
    fontSize: 12,
    color: cores.erro,
    fontWeight: '700',
  },
  erroBox: {
    backgroundColor: cores.erroFundo,
    borderWidth: 1,
    borderColor: cores.erroBorda,
    borderRadius: raio.md,
    padding: espaco.md,
  },
  erroBoxTexto: {
    color: cores.erro,
    fontSize: 14,
  },
  expandidoFundo: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  expandidoBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(17,24,39,0.45)',
  },
  expandidoSheet: {
    maxHeight: '90%',
    backgroundColor: cores.fundoCard,
    borderTopLeftRadius: raio.xl,
    borderTopRightRadius: raio.xl,
    overflow: 'hidden',
  },
  alcaWrap: {
    alignItems: 'center',
    paddingTop: espaco.sm,
  },
  alca: {
    width: 40,
    height: 5,
    borderRadius: raio.pill,
    backgroundColor: neutro[300],
  },
  expandidoCabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: espaco.lg,
    paddingTop: espaco.sm,
    paddingBottom: espaco.md,
    borderBottomWidth: 1,
    borderBottomColor: cores.divisor,
  },
  expandidoCabecalhoTitulo: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: cores.textoSecundario,
  },
  expandidoFechar: {
    color: cores.primaria,
    fontSize: 15,
    fontWeight: '700',
  },
  expandidoConteudo: {
    padding: espaco.lg,
    gap: espaco.md,
  },
  expandidoCarrossel: {
    height: 220,
    borderRadius: raio.lg,
    overflow: 'hidden',
  },
  expandidoFoto: {
    width: 335,
    height: 220,
    borderRadius: raio.lg,
    backgroundColor: neutro[100],
  },
  expandidoFotoVazia: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  expandidoPontos: {
    flexDirection: 'row',
    alignSelf: 'center',
    gap: 5,
    marginTop: -espaco.sm,
  },
  expandidoPonto: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: neutro[300],
  },
  expandidoPontoAtivo: {
    width: 18,
    backgroundColor: cores.primaria,
  },
  expandidoTitulo: {
    fontSize: 20,
    fontWeight: '800',
    color: cores.texto,
  },
  expandidoSubtitulo: {
    fontSize: 14,
    color: cores.textoSecundario,
  },
  expandidoLinhasBox: {
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.lg,
    overflow: 'hidden',
  },
  expandidoLinha: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: espaco.md,
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm + 2,
  },
  expandidoLinhaBorda: {
    borderTopWidth: 1,
    borderTopColor: cores.divisor,
  },
  expandidoLinhaRotulo: {
    fontSize: 13,
    color: cores.textoSecundario,
  },
  expandidoLinhaValor: {
    flex: 1,
    textAlign: 'right',
    fontSize: 14,
    fontWeight: '600',
    color: cores.texto,
  },
  expandidoRotuloSecao: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: cores.textoSecundario,
  },
  expandidoObservacao: {
    fontSize: 15,
    lineHeight: 21,
    color: cores.texto,
  },
  expandidoBotaoComentar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: espaco.sm,
    minHeight: 52,
    borderRadius: raio.md,
    backgroundColor: cores.primaria,
    marginTop: espaco.sm,
  },
  expandidoBotaoComentarTexto: {
    color: cores.branco,
    fontSize: 15,
    fontWeight: '700',
  },
});
