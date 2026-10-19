import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { amber, cores, espaco, neutro, raio, verde, vermelho } from '../theme';

interface FinalizarVisitaModalProps {
  visible: boolean;
  cronometroTexto: string;
  nRegistros: number;
  feitasObrigatorias: number;
  totalObrigatorias: number;
  nRupturas: number;
  faltando: string[];
  /** Obrigatórios que travam o check-out (DIRECIONAMENTO_BLOQUEIA_CHECKOUT). Com algum, não dá pra finalizar. */
  bloqueados?: string[];
  enviando: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}

const TEMPO_SEGURAR_MS = 800;

// Bottom sheet de confirmação de "Finalizar visita" — mostra os números da visita antes de
// confirmar em vez de um Alert genérico. Versão do protótipo "Finalizar Visita Horus" (14/10/2026):
// um botão único de segurar (evita check-out por toque sem querer e não espreme o texto como os
// dois botões lado a lado de antes). O sucesso não mora mais aqui: é a VisitaConcluida, em tela cheia.
export function FinalizarVisitaModal({
  visible,
  cronometroTexto,
  nRegistros,
  feitasObrigatorias,
  totalObrigatorias,
  nRupturas,
  faltando,
  bloqueados = [],
  enviando,
  onCancelar,
  onConfirmar,
}: FinalizarVisitaModalProps) {
  const insets = useSafeAreaInsets();
  const bloqueado = bloqueados.length > 0;
  const pendente = faltando.length > 0 || bloqueado;
  const progresso = useRef(new Animated.Value(0)).current;
  const [larguraBotao, setLarguraBotao] = useState(400);

  useEffect(() => {
    if (!visible) progresso.setValue(0);
  }, [visible, progresso]);

  function comecarASegurar() {
    if (enviando) return;
    Animated.timing(progresso, { toValue: 1, duration: TEMPO_SEGURAR_MS, easing: Easing.linear, useNativeDriver: true }).start(
      ({ finished }) => {
        if (finished) onConfirmar();
      },
    );
  }

  function soltar() {
    if (enviando) return;
    progresso.stopAnimation((valor) => {
      if (valor < 1) Animated.timing(progresso, { toValue: 0, duration: 180, useNativeDriver: true }).start();
    });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancelar}>
      <View style={styles.backdropContainer}>
        <Pressable style={styles.backdrop} onPress={enviando ? undefined : onCancelar} />
        <View style={[styles.sheet, { paddingBottom: espaco.lg + insets.bottom }]}>
          <View style={styles.alca} />

          <View>
            <Text style={styles.titulo}>
              {bloqueado ? 'Responda antes de finalizar' : pendente ? 'Finalizar com pendências?' : 'Tudo pronto por aqui'}
            </Text>
            <Text style={styles.subtitulo}>{cronometroTexto} na loja · o check-out usa sua localização atual</Text>
          </View>

          <View style={styles.resumo}>
            {totalObrigatorias > 0 && (
              <View style={styles.obrigatoriasLinha}>
                <Text style={styles.resumoRotulo}>Obrigatórias</Text>
                <Text style={[styles.obrigatoriasValor, { color: pendente ? amber[700] : verde[700] }]}>
                  {feitasObrigatorias === totalObrigatorias ? 'Todas concluídas' : `${feitasObrigatorias} de ${totalObrigatorias}`}
                </Text>
              </View>
            )}
            {totalObrigatorias > 0 && (
              <View style={styles.segmentos}>
                {Array.from({ length: totalObrigatorias }, (_, i) => (
                  <View
                    key={i}
                    style={[styles.segmento, i < feitasObrigatorias && { backgroundColor: pendente ? amber[500] : verde[600] }]}
                  />
                ))}
              </View>
            )}
            <View style={styles.minis}>
              <View style={styles.mini}>
                <MaterialCommunityIcons name="clipboard-text-outline" size={15} color={neutro[500]} />
                <Text style={styles.miniTexto}>
                  <Text style={styles.miniNumero}>{nRegistros}</Text> {nRegistros === 1 ? 'registro' : 'registros'}
                </Text>
              </View>
              <View style={styles.mini}>
                <MaterialCommunityIcons name="package-variant-remove" size={15} color={nRupturas > 0 ? vermelho[700] : neutro[500]} />
                <Text style={styles.miniTexto}>
                  <Text style={[styles.miniNumero, nRupturas > 0 && { color: vermelho[700] }]}>{nRupturas}</Text>{' '}
                  {nRupturas === 1 ? 'ruptura' : 'rupturas'}
                </Text>
              </View>
            </View>
          </View>

          {bloqueado && (
            <View style={styles.bloqueadoBox}>
              <View style={styles.bloqueadoCabecalho}>
                <MaterialCommunityIcons name="lock-outline" size={16} color={vermelho[800]} />
                <Text style={styles.bloqueadoTitulo}>Obrigatório para finalizar</Text>
              </View>
              <Text style={styles.bloqueadoTexto}>A empresa exige estes formulários antes do check-out:</Text>
              {bloqueados.map((item) => (
                <View key={item} style={styles.faltandoLinha}>
                  <View style={[styles.faltandoPonto, { backgroundColor: vermelho[600] }]} />
                  <Text style={[styles.faltandoTexto, { color: vermelho[800] }]}>{item}</Text>
                </View>
              ))}
            </View>
          )}

          {faltando.length > 0 && (
            <View style={styles.faltandoBox}>
              <Text style={styles.faltandoTitulo}>Ainda falta</Text>
              {faltando.map((item) => (
                <View key={item} style={styles.faltandoLinha}>
                  <View style={styles.faltandoPonto} />
                  <Text style={styles.faltandoTexto}>{item}</Text>
                </View>
              ))}
            </View>
          )}

          {bloqueado ? (
            <Pressable style={styles.botaoSegurar} onPress={onCancelar} accessibilityRole="button">
              <Text style={styles.botaoSegurarTexto}>Voltar e responder</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.botaoSegurar, pendente && styles.botaoSegurarPendente]}
              onLayout={(e) => setLarguraBotao(e.nativeEvent.layout.width)}
              onPressIn={comecarASegurar}
              onPressOut={soltar}
              disabled={enviando}
              accessibilityRole="button"
              accessibilityLabel={pendente ? 'Finalizar visita com pendências' : 'Finalizar visita'}
              accessibilityHint="Segure até a barra encher"
              accessibilityActions={[{ name: 'activate' }]}
              onAccessibilityAction={() => onConfirmar()}
            >
              <Animated.View
                style={[
                  styles.botaoSegurarFill,
                  {
                    transform: [
                      { translateX: progresso.interpolate({ inputRange: [0, 1], outputRange: [-larguraBotao, 0] }) },
                    ],
                  },
                ]}
              />
              {enviando ? (
                <ActivityIndicator color={cores.branco} />
              ) : (
                <Text style={styles.botaoSegurarTexto}>{pendente ? 'Segure para finalizar assim' : 'Segure para finalizar'}</Text>
              )}
            </Pressable>
          )}
          {!bloqueado && (
            <Pressable style={styles.botaoVoltar} onPress={onCancelar} disabled={enviando}>
              <Text style={styles.botaoVoltarTexto}>Voltar para a visita</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdropContainer: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(17,24,39,0.45)' },
  sheet: {
    backgroundColor: cores.fundoCard,
    borderTopLeftRadius: raio.xl,
    borderTopRightRadius: raio.xl,
    paddingHorizontal: espaco.lg,
    paddingTop: espaco.sm,
    gap: espaco.lg,
  },
  alca: { width: 40, height: 5, borderRadius: raio.pill, backgroundColor: neutro[300], alignSelf: 'center' },
  titulo: { fontSize: 21, fontWeight: '800', color: cores.texto },
  subtitulo: { fontSize: 13, color: cores.textoSecundario, marginTop: 3 },
  resumo: { gap: espaco.sm, padding: espaco.md, borderRadius: raio.lg, backgroundColor: cores.fundo, borderWidth: 1, borderColor: cores.borda },
  resumoRotulo: { fontSize: 13, color: cores.textoSecundario },
  obrigatoriasLinha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  obrigatoriasValor: { fontSize: 16, fontWeight: '800' },
  segmentos: { flexDirection: 'row', gap: 4 },
  segmento: { flex: 1, height: 8, borderRadius: raio.pill, backgroundColor: neutro[200] },
  minis: { flexDirection: 'row', gap: espaco.lg, marginTop: 2 },
  mini: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  miniTexto: { fontSize: 13, color: neutro[700] },
  miniNumero: { fontWeight: '800', color: cores.texto },
  faltandoBox: { gap: 6, padding: espaco.md, borderRadius: raio.lg, backgroundColor: amber[50], borderWidth: 1, borderColor: amber[200] },
  faltandoTitulo: { fontSize: 14, fontWeight: '700', color: amber[800] },
  faltandoLinha: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm },
  faltandoPonto: { width: 5, height: 5, borderRadius: 3, backgroundColor: amber[600] },
  faltandoTexto: { fontSize: 13, color: amber[800], flexShrink: 1 },
  bloqueadoBox: { gap: 6, padding: espaco.md, borderRadius: raio.lg, backgroundColor: vermelho[50], borderWidth: 1, borderColor: vermelho[200] },
  bloqueadoCabecalho: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bloqueadoTitulo: { fontSize: 14, fontWeight: '700', color: vermelho[800] },
  bloqueadoTexto: { fontSize: 13, color: vermelho[800] },
  botaoSegurar: {
    minHeight: 56,
    borderRadius: raio.lg,
    backgroundColor: cores.primaria,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  botaoSegurarPendente: { backgroundColor: amber[600] },
  // Barra que enche da esquerda: começa fora do botão e desliza pra dentro (transform nativo).
  botaoSegurarFill: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(255,255,255,0.25)' },
  botaoSegurarTexto: { color: cores.branco, fontSize: 16, fontWeight: '700' },
  botaoVoltar: { minHeight: 40, alignItems: 'center', justifyContent: 'center', marginTop: -espaco.sm },
  botaoVoltarTexto: { color: cores.textoSecundario, fontSize: 14, fontWeight: '600' },
});
