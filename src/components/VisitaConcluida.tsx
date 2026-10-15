import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listarOrdensServicoAgenda } from '../lib/api/ordensServico';
import { buscarPontoVenda, listarPontosVenda } from '../lib/api/pontosVenda';
import { useAuth } from '../lib/auth/AuthContext';
import { exigeSequencia, filaDoDia } from '../lib/rotaObrigatoria';
import type { OrdemServico, PontoVenda } from '../types/api';
import { amber, cores, espaco, indigo, neutro, raio, verde } from '../theme';

/** Números da visita guardados na hora do check-out — depois de enviada, a visita some do aparelho. */
export interface ResumoVisita {
  lojaNome: string;
  ordemServicoId: string | null;
  minutos: number;
  nRegistros: number;
  nRupturas: number;
  feitasObrigatorias: number;
  totalObrigatorias: number;
  nFaltando: number;
}

interface Props {
  /** null quando a tela abriu numa visita já finalizada antes (sem os números do check-out). */
  resumo: ResumoVisita | null;
  /** Fila já confirmou check-out no servidor. */
  enviado: boolean;
  online: boolean;
  onVoltarAgenda: () => void;
  onIrParaLoja: (pontoVenda: PontoVenda, ordemServico: OrdemServico) => void;
}

// Tela depois do check-out (protótipo "Finalizar Visita Horus" aprovado em 14/10/2026). Substitui
// o "Visita finalizada / Voltar" de antes e a tela de sucesso dentro do FinalizarVisitaModal — as
// duas existiam porque online a visita sai do aparelho na hora e offline continua. A comemoração é
// completa só quando nada ficou pendente: o promotor sente a diferença.
export function VisitaConcluida({ resumo, enviado, online, onVoltarAgenda, onIrParaLoja }: Props) {
  const { usuario } = useAuth();
  const insets = useSafeAreaInsets();
  const completa = resumo ? resumo.nFaltando === 0 : true;
  const reduzirMovimento = useReduzirMovimento();

  // Mesma consulta (e chave) do painel da Agenda — volta do cache quando a Agenda já carregou hoje.
  const hoje = useMemo(() => paraDataISO(new Date()), []);
  const janela = useMemo(() => ({ prazoDe: hoje, prazoAte: hoje }), [hoje]);
  const agendaQuery = useQuery({
    queryKey: ['ordens-servico-agenda', janela],
    queryFn: () => listarOrdensServicoAgenda(janela),
    retry: false,
  });

  const dia = useMemo(() => {
    const ordens = (agendaQuery.data ?? []).filter((os) => os.status !== 'CANCELADA');
    if (ordens.length === 0) return null;
    const idAtual = resumo?.ordemServicoId ?? null;
    // A OS desta visita pode ainda constar em andamento no servidor (fila não enviou) — já conta como feita.
    const feitas = ordens.filter((os) => os.status === 'CONCLUIDA' || os.id === idAtual).length;
    const restantes = ordens.filter((os) => os.id !== idAtual && (os.status === 'PENDENTE' || os.status === 'EM_ANDAMENTO'));
    // Com sequência obrigatória (docs/74) a próxima é a primeira da fila; sem, a de horário mais cedo.
    const proxima =
      usuario && exigeSequencia(usuario)
        ? (filaDoDia(restantes, usuario.id, hoje)[0] ?? null)
        : ([...restantes].sort((a, b) => alvo(a) - alvo(b))[0] ?? null);
    return { total: ordens.length, feitas, proxima };
  }, [agendaQuery.data, resumo?.ordemServicoId, usuario, hoje]);

  const [abrindoProxima, setAbrindoProxima] = useState(false);
  async function irParaProxima(os: OrdemServico) {
    setAbrindoProxima(true);
    try {
      // Lista da carteira cai pro cache offline; o detalhe é só online, último recurso.
      const lista = await listarPontosVenda().catch(() => null);
      const pontoVenda =
        lista?.pontos_venda.find((p) => p.id === os.ponto_venda.id) ??
        (await buscarPontoVenda(os.ponto_venda.id).catch(() => undefined));
      if (!pontoVenda) {
        Alert.alert('Loja não encontrada', 'Não achamos os dados desta loja no aparelho. Abra pela Agenda quando tiver sinal.');
        return;
      }
      onIrParaLoja(pontoVenda, os);
    } finally {
      setAbrindoProxima(false);
    }
  }

  // Coreografia: selo entra (0–0,7 s), confete solta, textos sobem em cascata.
  const selo = useRef(new Animated.Value(0)).current;
  const onda = useRef(new Animated.Value(0)).current;
  const subida = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (reduzirMovimento === null) return;
    if (reduzirMovimento) {
      selo.setValue(1);
      onda.setValue(1);
      subida.forEach((v) => v.setValue(1));
      return;
    }
    Animated.parallel([
      Animated.spring(selo, { toValue: 1, friction: 5, tension: 70, delay: 150, useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(550),
        Animated.loop(Animated.timing(onda, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }), {
          iterations: completa ? 3 : 1,
        }),
      ]),
      Animated.stagger(
        90,
        subida.map((v) => Animated.timing(v, { toValue: 1, duration: 450, delay: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true })),
      ),
    ]).start();
  }, [reduzirMovimento, completa, selo, onda, subida]);

  const sobe = (i: number) => ({
    opacity: subida[i],
    transform: [{ translateY: subida[i].interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
  });

  const primeiroNome = usuario?.nome.split(' ')[0];
  const titulo = completa ? 'Visita concluída!' : 'Visita finalizada';
  const mensagem = !resumo
    ? 'O check-out desta visita já foi feito.'
    : completa
      ? `Mandou bem${primeiroNome ? `, ${primeiroNome}` : ''}. Todas as tarefas do ${resumo.lojaNome} foram feitas.`
      : `${resumo.nFaltando === 1 ? 'Ficou 1 item' : `Ficaram ${resumo.nFaltando} itens`} para trás no ${resumo.lojaNome}. Na próxima, feche tudo.`;
  const envio = enviado
    ? { icone: 'cloud-check-outline' as const, texto: 'Enviada ao servidor' }
    : online
      ? { icone: 'cloud-upload-outline' as const, texto: 'Enviando… pode fechar o app' }
      : { icone: 'cloud-off-outline' as const, texto: 'Sem sinal: enviamos assim que voltar' };

  const pctObrigatorias = resumo && resumo.totalObrigatorias > 0 ? Math.round((resumo.feitasObrigatorias / resumo.totalObrigatorias) * 100) : null;

  return (
    <View style={[styles.tela, !completa && styles.telaParcial]}>
      <StatusBar style="light" />
      {/* Brilho atrás do selo — o app não tem gradiente, um círculo grande faz o papel. */}
      <View style={[styles.brilho, !completa && styles.brilhoParcial]} pointerEvents="none" />
      <ScrollView contentContainerStyle={[styles.conteudo, { paddingTop: insets.top + espaco.xxl }]} showsVerticalScrollIndicator={false}>
        <View style={styles.seloArea}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.onda,
              {
                opacity: onda.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
                transform: [{ scale: onda.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }],
              },
            ]}
          />
          <Animated.View style={[styles.selo, { opacity: selo.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }), transform: [{ scale: selo }] }]}>
            <MaterialCommunityIcons name="check-bold" size={52} color={cores.branco} />
          </Animated.View>
        </View>

        <Animated.View style={[styles.textos, sobe(0)]}>
          <Text style={styles.titulo} accessibilityRole="header">
            {titulo}
          </Text>
          <Text style={styles.mensagem}>{mensagem}</Text>
          <View style={styles.envioPill}>
            <MaterialCommunityIcons name={envio.icone} size={14} color={cores.branco} />
            <Text style={styles.envioTexto}>{envio.texto}</Text>
          </View>
        </Animated.View>

        {resumo && (
          <Animated.View style={[styles.stats, sobe(1)]}>
            <Stat valor={resumo.minutos} rotulo="min na loja" animar={reduzirMovimento === false} />
            <Stat valor={resumo.nRegistros} rotulo={resumo.nRegistros === 1 ? 'registro' : 'registros'} animar={reduzirMovimento === false} />
            {pctObrigatorias !== null ? (
              <Stat valor={pctObrigatorias} sufixo="%" rotulo="obrigatórias" animar={reduzirMovimento === false} />
            ) : (
              <Stat valor={resumo.nRupturas} rotulo={resumo.nRupturas === 1 ? 'ruptura' : 'rupturas'} animar={reduzirMovimento === false} />
            )}
          </Animated.View>
        )}

        {dia && (
          <Animated.View style={[styles.dia, sobe(2)]}>
            <View style={styles.diaTopo}>
              <Text style={styles.diaRotulo}>Seu dia</Text>
              <Text style={styles.diaValor}>
                {dia.feitas} de {dia.total} {dia.total === 1 ? 'visita' : 'visitas'}
              </Text>
            </View>
            <View style={styles.diaBarras}>
              {Array.from({ length: Math.min(dia.total, 12) }, (_, i) => (
                <View
                  key={i}
                  style={[styles.diaBarra, i < dia.feitas && styles.diaBarraFeita, i === dia.feitas - 1 && styles.diaBarraAgora]}
                />
              ))}
            </View>
          </Animated.View>
        )}

        <Animated.View style={[styles.acoes, sobe(3)]}>
          {dia?.proxima && (
            <>
              <View style={styles.proxCard}>
                <View style={styles.proxIcone}>
                  <MaterialCommunityIcons name="storefront-outline" size={22} color={cores.primaria} />
                </View>
                <View style={styles.proxTextos}>
                  <Text style={styles.proxRotulo}>
                    Próxima visita{dia.proxima.horario_previsto ? ` · ${dia.proxima.horario_previsto.slice(0, 5)}` : ''}
                  </Text>
                  <Text style={styles.proxNome} numberOfLines={1}>
                    {dia.proxima.ponto_venda.fantasia}
                  </Text>
                </View>
              </View>
              <Pressable
                style={({ pressed }) => [styles.botaoProxima, pressed && styles.pressionado]}
                onPress={() => void irParaProxima(dia.proxima!)}
                disabled={abrindoProxima}
              >
                {abrindoProxima ? (
                  <ActivityIndicator color={neutro[900]} />
                ) : (
                  <Text style={styles.botaoProximaTexto}>Ir para a próxima loja</Text>
                )}
              </Pressable>
            </>
          )}
          <Pressable
            style={({ pressed }) => [dia?.proxima ? styles.botaoAgenda : styles.botaoAgendaCheio, pressed && styles.pressionado]}
            onPress={onVoltarAgenda}
          >
            <Text style={dia?.proxima ? styles.botaoAgendaTexto : styles.botaoAgendaCheioTexto}>Voltar para a agenda</Text>
          </Pressable>
        </Animated.View>
      </ScrollView>
      {/* Por cima de tudo, saindo do centro do selo (topo do conteúdo + metade do selo). */}
      {reduzirMovimento === false && (
        <View style={[styles.confeteOrigem, { top: insets.top + espaco.xxl + 56 }]} pointerEvents="none">
          <Confete cheio={completa} />
        </View>
      )}
    </View>
  );
}

function Stat({ valor, sufixo = '', rotulo, animar }: { valor: number; sufixo?: string; rotulo: string; animar: boolean }) {
  const exibido = useContagem(valor, animar, 900);
  return (
    <View style={styles.stat}>
      <Text style={styles.statValor}>
        {exibido}
        {sufixo}
      </Text>
      <Text style={styles.statRotulo}>{rotulo}</Text>
    </View>
  );
}

/** Conta de 0 até `alvo` (ease-out), começando depois de `atraso` ms. */
function useContagem(alvo: number, animar: boolean, atraso: number): number {
  const [valor, setValor] = useState(animar ? 0 : alvo);
  useEffect(() => {
    if (!animar) {
      setValor(alvo);
      return;
    }
    let quadro = 0;
    const inicio = Date.now() + atraso;
    const passo = () => {
      const p = Math.max(0, Math.min(1, (Date.now() - inicio) / 900));
      setValor(Math.round(alvo * (1 - Math.pow(1 - p, 3))));
      if (p < 1) quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [alvo, animar, atraso]);
  return valor;
}

/** null enquanto lê a preferência do sistema — evita animar e depois cortar. */
function useReduzirMovimento(): boolean | null {
  const [reduzir, setReduzir] = useState<boolean | null>(null);
  useEffect(() => {
    let ativo = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => ativo && setReduzir(v))
      .catch(() => ativo && setReduzir(false));
    return () => {
      ativo = false;
    };
  }, []);
  return reduzir;
}

const CORES_CONFETE = [amber[500], amber[200], '#22c55e', indigo[300], neutro[0], '#f472b6'];
const CORES_CONFETE_PARCIAL = [neutro[400], neutro[300], indigo[300]];

/** Explosão de confete saindo do selo — cada pedaço é uma animação nativa de 0 a 1. */
function Confete({ cheio }: { cheio: boolean }) {
  const pedacos = useMemo(() => {
    const paleta = cheio ? CORES_CONFETE : CORES_CONFETE_PARCIAL;
    return Array.from({ length: cheio ? 64 : 16 }, (_, i) => {
      const angulo = Math.random() * Math.PI * 2;
      const forca = (cheio ? 110 : 60) + Math.random() * (cheio ? 120 : 50);
      return {
        id: i,
        progresso: new Animated.Value(0),
        dx: Math.cos(angulo) * forca,
        // Sobe primeiro (mais pra cima que pros lados), depois cai bem abaixo do selo.
        pico: -Math.abs(Math.sin(angulo)) * forca - 40,
        queda: 260 + Math.random() * 260,
        giro: (Math.random() - 0.5) * 1440,
        cor: paleta[i % paleta.length],
        tamanho: 6 + Math.random() * 6,
        redondo: Math.random() < 0.3,
        duracao: 1600 + Math.random() * 900,
      };
    });
  }, [cheio]);

  useEffect(() => {
    Animated.parallel(
      pedacos.map((p) =>
        Animated.timing(p.progresso, { toValue: 1, duration: p.duracao, delay: 450, easing: Easing.linear, useNativeDriver: true }),
      ),
    ).start();
  }, [pedacos]);

  return (
    <View pointerEvents="none">
      {pedacos.map((p) => (
        <Animated.View
          key={p.id}
          style={{
            position: 'absolute',
            width: p.tamanho,
            height: p.redondo ? p.tamanho : p.tamanho / 2,
            borderRadius: p.redondo ? p.tamanho / 2 : 1,
            backgroundColor: p.cor,
            opacity: p.progresso.interpolate({ inputRange: [0, 0.05, 0.8, 1], outputRange: [0, 1, 1, 0] }),
            transform: [
              { translateX: p.progresso.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, p.dx * 0.8, p.dx] }) },
              { translateY: p.progresso.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, p.pico, p.queda], easing: Easing.inOut(Easing.quad) }) },
              { rotate: p.progresso.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.giro}deg`] }) },
            ],
          }}
        />
      ))}
    </View>
  );
}

function paraDataISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function alvo(os: OrdemServico): number {
  if (os.horario_previsto) {
    const [h, m] = os.horario_previsto.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.getTime();
  }
  return new Date(os.prazo_fim).getTime();
}

const BRANCO_10 = 'rgba(255,255,255,0.10)';
const BRANCO_15 = 'rgba(255,255,255,0.15)';

const styles = StyleSheet.create({
  tela: { flex: 1, backgroundColor: indigo[900], overflow: 'hidden' },
  telaParcial: { backgroundColor: neutro[800] },
  brilho: {
    position: 'absolute',
    top: -260,
    alignSelf: 'center',
    width: 620,
    height: 620,
    borderRadius: 310,
    backgroundColor: indigo[600],
    opacity: 0.85,
  },
  brilhoParcial: { backgroundColor: neutro[600], opacity: 0.6 },
  conteudo: { flexGrow: 1, alignItems: 'center', paddingHorizontal: espaco.xl, paddingBottom: espaco.xl, gap: espaco.lg },
  seloArea: { width: 112, height: 112, alignItems: 'center', justifyContent: 'center' },
  onda: { position: 'absolute', width: 112, height: 112, borderRadius: 56, borderWidth: 3, borderColor: '#22c55e' },
  selo: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: verde[600],
    borderWidth: 5,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confeteOrigem: { position: 'absolute', left: '50%', width: 0, height: 0 },
  textos: { alignItems: 'center', gap: espaco.sm },
  titulo: { fontSize: 28, fontWeight: '800', color: cores.branco, textAlign: 'center', letterSpacing: -0.3 },
  mensagem: { fontSize: 15, lineHeight: 21, color: 'rgba(255,255,255,0.82)', textAlign: 'center', maxWidth: 300 },
  envioPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: BRANCO_15,
    borderRadius: raio.pill,
    paddingHorizontal: espaco.md,
    paddingVertical: 5,
    marginTop: espaco.xs,
  },
  envioTexto: { fontSize: 12, fontWeight: '600', color: cores.branco },
  stats: { flexDirection: 'row', gap: espaco.sm, alignSelf: 'stretch' },
  stat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: espaco.md,
    borderRadius: raio.lg,
    backgroundColor: BRANCO_10,
    borderWidth: 1,
    borderColor: BRANCO_15,
  },
  statValor: { fontSize: 24, fontWeight: '800', color: cores.branco, fontVariant: ['tabular-nums'] },
  statRotulo: { fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  dia: { alignSelf: 'stretch', padding: espaco.md, borderRadius: raio.lg, backgroundColor: BRANCO_10, borderWidth: 1, borderColor: BRANCO_15 },
  diaTopo: { flexDirection: 'row', justifyContent: 'space-between' },
  diaRotulo: { fontSize: 13, color: cores.branco },
  diaValor: { fontSize: 13, fontWeight: '700', color: amber[200] },
  diaBarras: { flexDirection: 'row', gap: 6, marginTop: espaco.sm },
  diaBarra: { flex: 1, height: 8, borderRadius: raio.pill, backgroundColor: 'rgba(255,255,255,0.18)' },
  diaBarraFeita: { backgroundColor: '#22c55e' },
  diaBarraAgora: { backgroundColor: amber[500] },
  acoes: { alignSelf: 'stretch', gap: espaco.sm, marginTop: 'auto', paddingTop: espaco.lg },
  proxCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    backgroundColor: cores.branco,
    borderRadius: raio.lg,
    padding: espaco.md,
  },
  proxIcone: { width: 40, height: 40, borderRadius: raio.md, backgroundColor: cores.primariaClara, alignItems: 'center', justifyContent: 'center' },
  proxTextos: { flex: 1 },
  proxRotulo: { fontSize: 12, color: cores.textoSecundario },
  proxNome: { fontSize: 16, fontWeight: '700', color: cores.texto },
  botaoProxima: { minHeight: 54, borderRadius: raio.md, backgroundColor: amber[500], alignItems: 'center', justifyContent: 'center' },
  botaoProximaTexto: { fontSize: 16, fontWeight: '800', color: neutro[900] },
  botaoAgenda: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  botaoAgendaTexto: { fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  botaoAgendaCheio: { minHeight: 54, borderRadius: raio.md, backgroundColor: cores.branco, alignItems: 'center', justifyContent: 'center' },
  botaoAgendaCheioTexto: { fontSize: 16, fontWeight: '800', color: cores.primaria },
  pressionado: { opacity: 0.85 },
});
