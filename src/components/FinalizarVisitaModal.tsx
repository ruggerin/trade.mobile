import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { amber, cores, espaco, neutro, raio, vermelho } from '../theme';

interface FinalizarVisitaModalProps {
  visible: boolean;
  cronometroTexto: string;
  nRegistros: number;
  feitasObrigatorias: number;
  totalObrigatorias: number;
  nRupturas: number;
  faltando: string[];
  enviando: boolean;
  sucesso: boolean;
  mensagemSucesso: string;
  onCancelar: () => void;
  onConfirmar: () => void;
  onVoltarInicio: () => void;
}

// Bottom sheet de confirmação de "Finalizar visita" — protótipo Claude Design (Visita
// Andamento.dc.html, `finalizarAberto`) mostra os números da visita antes de confirmar em vez de
// um Alert do sistema genérico, e uma tela de sucesso própria em vez de fechar direto. Ver
// docs/Trade.mobile app review-handoff.
export function FinalizarVisitaModal({
  visible,
  cronometroTexto,
  nRegistros,
  feitasObrigatorias,
  totalObrigatorias,
  nRupturas,
  faltando,
  enviando,
  sucesso,
  mensagemSucesso,
  onCancelar,
  onConfirmar,
  onVoltarInicio,
}: FinalizarVisitaModalProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={sucesso ? onVoltarInicio : onCancelar}>
      <View style={styles.backdropContainer}>
        <Pressable style={styles.backdrop} onPress={sucesso ? onVoltarInicio : onCancelar} />
        <View style={[styles.sheet, { paddingBottom: espaco.xl + insets.bottom }]}>
          <View style={styles.alcaWrap}>
            <View style={styles.alca} />
          </View>

          {sucesso ? (
            <View style={styles.sucessoBox}>
              <View style={styles.sucessoIconeCirculo}>
                <MaterialCommunityIcons name="check" size={32} color={cores.sucesso} />
              </View>
              <Text style={styles.sucessoTitulo}>Visita finalizada</Text>
              <Text style={styles.sucessoTexto}>{mensagemSucesso}</Text>
              <Pressable style={({ pressed }) => [styles.botaoPrimario, pressed && { opacity: 0.9 }]} onPress={onVoltarInicio}>
                <Text style={styles.botaoPrimarioTexto}>Voltar ao início</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.conteudo}>
              <View>
                <Text style={styles.titulo}>Finalizar visita?</Text>
                <Text style={styles.subtitulo}>{cronometroTexto} na loja · o check-out usa sua localização atual.</Text>
              </View>

              <View style={styles.statsLinha}>
                <View style={styles.statCard}>
                  <Text style={styles.statNumero}>{nRegistros}</Text>
                  <Text style={styles.statLabel}>Registros</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statNumero}>
                    {feitasObrigatorias}/{totalObrigatorias}
                  </Text>
                  <Text style={styles.statLabel}>Obrigatórias</Text>
                </View>
                <View style={[styles.statCard, nRupturas > 0 && styles.statCardRuptura]}>
                  <Text style={[styles.statNumero, nRupturas > 0 && styles.statNumeroRuptura]}>{nRupturas}</Text>
                  <Text style={[styles.statLabel, nRupturas > 0 && styles.statLabelRuptura]}>Rupturas</Text>
                </View>
              </View>

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

              <View style={styles.botoesLinha}>
                <Pressable
                  style={({ pressed }) => [styles.botaoSecundario, pressed && { opacity: 0.85 }]}
                  onPress={onCancelar}
                  disabled={enviando}
                >
                  <Text style={styles.botaoSecundarioTexto}>Voltar</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.botaoPrimario, styles.botaoPrimarioFlex, pressed && { opacity: 0.9 }]}
                  onPress={onConfirmar}
                  disabled={enviando}
                >
                  {enviando ? (
                    <ActivityIndicator color={cores.branco} />
                  ) : (
                    <Text style={styles.botaoPrimarioTexto}>{faltando.length > 0 ? 'Finalizar mesmo assim' : 'Finalizar visita'}</Text>
                  )}
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdropContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(17,24,39,0.45)',
  },
  sheet: {
    backgroundColor: cores.fundoCard,
    borderTopLeftRadius: raio.xl,
    borderTopRightRadius: raio.xl,
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
  conteudo: {
    padding: espaco.lg,
    gap: espaco.lg,
  },
  titulo: {
    fontSize: 20,
    fontWeight: '800',
    color: cores.texto,
  },
  subtitulo: {
    fontSize: 14,
    color: cores.textoSecundario,
    marginTop: 2,
  },
  statsLinha: {
    flexDirection: 'row',
    gap: espaco.sm,
  },
  statCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.lg,
    padding: espaco.sm + 2,
  },
  statCardRuptura: {
    borderColor: vermelho[200],
    backgroundColor: vermelho[50],
  },
  statNumero: {
    fontSize: 20,
    fontWeight: '800',
    color: cores.texto,
  },
  statNumeroRuptura: {
    color: vermelho[700],
  },
  statLabel: {
    fontSize: 12,
    color: cores.textoSecundario,
  },
  statLabelRuptura: {
    color: vermelho[700],
  },
  faltandoBox: {
    gap: 6,
    padding: espaco.md,
    borderRadius: raio.lg,
    backgroundColor: amber[50],
    borderWidth: 1,
    borderColor: amber[200],
  },
  faltandoTitulo: {
    fontSize: 14,
    fontWeight: '700',
    color: amber[800],
  },
  faltandoLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm,
  },
  faltandoPonto: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: amber[600],
  },
  faltandoTexto: {
    fontSize: 13,
    color: amber[800],
    flexShrink: 1,
  },
  botoesLinha: {
    flexDirection: 'row',
    gap: espaco.sm,
  },
  botaoSecundario: {
    flex: 1,
    minHeight: 52,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.borda,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoSecundarioTexto: {
    color: neutro[700],
    fontSize: 15,
    fontWeight: '700',
  },
  botaoPrimario: {
    minHeight: 52,
    borderRadius: raio.md,
    backgroundColor: cores.primaria,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: espaco.lg,
  },
  botaoPrimarioFlex: {
    flex: 1.4,
  },
  botaoPrimarioTexto: {
    color: cores.branco,
    fontSize: 15,
    fontWeight: '700',
  },
  sucessoBox: {
    alignItems: 'center',
    gap: espaco.sm,
    padding: espaco.xl,
    paddingTop: espaco.md,
  },
  sucessoIconeCirculo: {
    width: 64,
    height: 64,
    borderRadius: raio.pill,
    backgroundColor: cores.sucessoFundo,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: espaco.sm,
  },
  sucessoTitulo: {
    fontSize: 20,
    fontWeight: '800',
    color: cores.texto,
  },
  sucessoTexto: {
    fontSize: 14,
    color: cores.textoSecundario,
    textAlign: 'center',
    maxWidth: 290,
    marginBottom: espaco.sm,
  },
});
