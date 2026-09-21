import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { buscarPlanograma } from '../lib/api/planogramas';
import type { PlanogramasStackParamList } from '../navigation/PlanogramasStack';
import type { PlanogramaBloco, PlanogramaPrateleira } from '../types/api';
import { cores, espaco, neutro, raio, sombraCard } from '../theme';

// Altura fixa do andar (só a largura de cada produto é proporcional, ver resolverSegmentos) —
// mesmo raciocínio de docs/22-PLANOGRAMA.md §2 decisão 14 (admin): largura estica pra preencher
// o espaço, altura fica fixa, senão um produto com pouca largura relativa também ficaria baixo
// demais.
const ALTURA_ANDAR = 96;
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;

type Props = NativeStackScreenProps<PlanogramasStackParamList, 'PlanogramaDetalhe'>;

interface Segmento {
  posicao: number;
  largura: number;
  percentual: number;
  bloco: PlanogramaBloco | undefined;
}

// Mesma varredura "posição a posição" que já existia aqui (e existe separadamente no editor
// admin) — a única mudança é devolver o percentual da largura em vez de pixel fixo, ver
// docs/22-PLANOGRAMA.md §9.3. Célula vazia conta como largura 1, os percentuais de uma
// prateleira sempre somam 100% porque os segmentos cobrem `quantidade_blocos` inteiro sem
// sobrepor (mesma regra já validada no cadastro).
function resolverSegmentos(prateleira: PlanogramaPrateleira): Segmento[] {
  const segmentos: Segmento[] = [];
  let posicao = 0;
  while (posicao < prateleira.quantidade_blocos) {
    const bloco = prateleira.blocos.find((b) => b.posicao_inicio === posicao);
    const largura = bloco?.largura ?? 1;
    segmentos.push({ posicao, largura, percentual: (largura / prateleira.quantidade_blocos) * 100, bloco });
    posicao += largura;
  }
  return segmentos;
}

// Só consulta — nenhuma interação de edição aqui (isso é feito no admin web). Ver
// docs/22-PLANOGRAMA.md.
export function PlanogramaDetalheScreen({ route }: Props) {
  const query = useQuery({
    queryKey: ['planogramas', route.params.planogramaId],
    queryFn: () => buscarPlanograma(route.params.planogramaId),
  });

  if (query.isLoading) {
    return (
      <View style={styles.centro}>
        <ActivityIndicator size="large" color={cores.primaria} />
      </View>
    );
  }

  if (query.isError || !query.data) {
    return (
      <View style={styles.centro}>
        <Text style={styles.erroTexto}>Não foi possível carregar este planograma.</Text>
      </View>
    );
  }

  return <PlanogramaCanvas prateleiras={query.data.prateleiras} />;
}

// A peça inteira (todos os andares) é UMA arte só, tipo um canva — zoom e arrastar valem pro
// conjunto de uma vez, não andar por andar. Ver docs/22-PLANOGRAMA.md §9.5 (pedido explícito do
// usuário depois da primeira versão ter feito isso errado, cada andar com zoom independente).
function PlanogramaCanvas({ prateleiras }: { prateleiras: PlanogramaPrateleira[] }) {
  const escala = useSharedValue(1);
  const escalaBase = useSharedValue(1);
  const deslocX = useSharedValue(0);
  const deslocY = useSharedValue(0);
  const deslocXBase = useSharedValue(0);
  const deslocYBase = useSharedValue(0);

  const gestoPinca = Gesture.Pinch()
    .onUpdate((evento) => {
      const nova = escalaBase.value * evento.scale;
      escala.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nova));
    })
    .onEnd(() => {
      escalaBase.value = escala.value;
    });

  // 1 dedo já basta pra arrastar — a tela inteira é o canva agora, não sobra nenhum ScrollView
  // concorrendo pelo toque (diferente da primeira versão, que exigia 2 dedos só pra não brigar
  // com a rolagem vertical de uma lista que não existe mais aqui).
  const gestoArrastar = Gesture.Pan()
    .onUpdate((evento) => {
      deslocX.value = deslocXBase.value + evento.translationX;
      deslocY.value = deslocYBase.value + evento.translationY;
    })
    .onEnd(() => {
      deslocXBase.value = deslocX.value;
      deslocYBase.value = deslocY.value;
    });

  // Duplo toque reseta — sem isso, é fácil arrastar/dar zoom demais e "perder" a arte de vista
  // sem um jeito rápido de voltar (mesmo gesto universal de visualizador de foto/mapa).
  const gestoDuploToque = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      escala.value = withTiming(1);
      escalaBase.value = 1;
      deslocX.value = withTiming(0);
      deslocY.value = withTiming(0);
      deslocXBase.value = 0;
      deslocYBase.value = 0;
    });

  const gesto = Gesture.Simultaneous(gestoPinca, gestoArrastar, gestoDuploToque);

  const estiloAnimado = useAnimatedStyle(() => ({
    transform: [
      { translateX: deslocX.value },
      { translateY: deslocY.value },
      { scale: escala.value },
    ],
  }));

  return (
    // overflow hidden = a moldura do canva; o conteúdo pode ficar maior (zoom) ou deslocado
    // (arrastar) sem vazar visualmente pro resto da tela.
    <View style={styles.tela}>
      <GestureDetector gesture={gesto}>
        <Animated.View style={[styles.canva, estiloAnimado]}>
          {prateleiras.map((prateleira) => (
            <Andar key={prateleira.id} prateleira={prateleira} />
          ))}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function Andar({ prateleira }: { prateleira: PlanogramaPrateleira }) {
  const segmentos = resolverSegmentos(prateleira);

  return (
    <View style={styles.prateleira}>
      <Text style={styles.prateleiraTitulo}>{prateleira.descricao || `Andar ${prateleira.ordem + 1}`}</Text>
      <View style={styles.grade}>
        {segmentos.map((segmento) => (
          <SegmentoProduto key={segmento.posicao} segmento={segmento} />
        ))}
      </View>
      {/* Tabuleiro — a "prateleira física" em si, uma faixa embaixo do produto (decisão 20 de
          docs/22-PLANOGRAMA.md §9). Puramente decorativo, sem dado nenhum aqui. */}
      <View style={styles.tabuleiro} />
    </View>
  );
}

function SegmentoProduto({ segmento }: { segmento: Segmento }) {
  const { bloco, percentual } = segmento;

  return (
    <View style={[styles.celula, { width: `${percentual}%` }]}>
      {bloco?.produto_auditoria?.imagem_url ? (
        <>
          <Image source={{ uri: bloco.produto_auditoria.imagem_url }} style={styles.celulaImagem} resizeMode="contain" />
          {/* Sombra achatada sob o produto — em vez de shadow nativa (inconsistente entre iOS/
              Android), uma elipse translúcida simples embaixo, mesmo efeito visual da imagem de
              referência que motivou este modo (ver docs/22-PLANOGRAMA.md §9.2 decisão 20). */}
          <View style={styles.sombraProduto} />
        </>
      ) : bloco ? (
        <Text style={styles.celulaTexto} numberOfLines={2}>
          {bloco.produto_auditoria?.descricao}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tela: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: cores.fundo,
  },
  centro: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: espaco.xl,
  },
  erroTexto: {
    fontSize: 15,
    color: cores.textoSecundario,
    textAlign: 'center',
  },
  // O canva inteiro — todos os andares empilhados, um filho só de gesto (zoom/arrastar) pra
  // tudo de uma vez, não um por andar.
  canva: {
    padding: espaco.lg,
    gap: espaco.lg,
  },
  prateleira: {
    backgroundColor: cores.fundoCard,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.borda,
    padding: espaco.md,
    ...sombraCard,
  },
  prateleiraTitulo: {
    fontSize: 14,
    fontWeight: '600',
    color: cores.texto,
    marginBottom: espaco.sm,
  },
  grade: {
    flexDirection: 'row',
    height: ALTURA_ANDAR,
    alignItems: 'flex-end',
    borderRadius: raio.sm,
    overflow: 'hidden',
    backgroundColor: neutro[50],
  },
  celula: {
    height: '100%',
    borderWidth: 1,
    borderColor: cores.borda,
    marginRight: -1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: 2,
  },
  celulaImagem: {
    width: '100%',
    height: '82%',
  },
  sombraProduto: {
    width: '70%',
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(17, 24, 39, 0.18)',
    marginTop: 2,
  },
  celulaTexto: {
    fontSize: 9,
    color: cores.textoSecundario,
    textAlign: 'center',
  },
  // Tabuleiro — faixa cinza mais escura simulando o "metal" da prateleira de verdade, mesma
  // ambientação usada entre um andar e o próximo na referência visual (decisão 20).
  tabuleiro: {
    height: 8,
    marginTop: -1,
    borderRadius: 2,
    backgroundColor: neutro[300],
    ...sombraCard,
  },
});
