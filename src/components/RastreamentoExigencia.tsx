import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SituacaoRastreamento } from '../lib/rastreamento';
import { textoSituacao } from '../lib/textosRastreamento';
import { cores, espaco, raio, sombraFlutuante, tipografia } from '../theme';

// Faixa de aviso e tela de bloqueio do rastreamento obrigatório — docs/47-RASTREAMENTO-EXIGENCIA.md
// §5.2. A faixa (AVISO, ou OBRIGATÓRIO com visita em andamento) flutua acima da barra de abas e
// não trava nada; o bloqueio (OBRIGATÓRIO) cobre o app inteiro até resolver — a fila de envio
// continua mandando por trás (§5.3).

export function AvisoRastreamento({
  situacao,
  visitaEmAndamento,
  obrigatorio,
  resolvendo,
  onResolver,
}: {
  situacao: SituacaoRastreamento | null;
  visitaEmAndamento: boolean;
  obrigatorio: boolean;
  resolvendo: boolean;
  onResolver: () => void;
}) {
  const insets = useSafeAreaInsets();
  const texto = textoSituacao(situacao);

  return (
    <View pointerEvents="box-none" style={[styles.avisoContainer, { bottom: 56 + insets.bottom + espaco.sm }]}>
      <View style={styles.aviso}>
        <MaterialCommunityIcons name="map-marker-off-outline" size={22} color={cores.acentoTexto} />
        <View style={styles.avisoTextos}>
          <Text style={styles.avisoTitulo}>{texto.titulo}</Text>
          <Text style={styles.avisoSub}>
            {obrigatorio && visitaEmAndamento
              ? 'Termine a visita atual — a próxima só começa com a localização ativa.'
              : 'Seu gestor é avisado enquanto a localização estiver desativada.'}
          </Text>
        </View>
        {texto.acao && (
          <Pressable style={({ pressed }) => [styles.avisoBotao, pressed && styles.pressionado]} onPress={onResolver} disabled={resolvendo}>
            {resolvendo ? <ActivityIndicator size="small" color={cores.onPrimaria} /> : <Text style={styles.avisoBotaoTexto}>Resolver</Text>}
          </Pressable>
        )}
      </View>
    </View>
  );
}

export function BloqueioRastreamento({
  visible,
  situacao,
  detalhe,
  enviosPendentes,
  resolvendo,
  onResolver,
  onSair,
}: {
  visible: boolean;
  situacao: SituacaoRastreamento | null;
  detalhe: string | null;
  enviosPendentes: number;
  resolvendo: boolean;
  onResolver: () => void;
  onSair: () => void;
}) {
  const insets = useSafeAreaInsets();
  const texto = textoSituacao(situacao);

  return (
    // onRequestClose sem efeito: o botão voltar do Android não fecha o bloqueio.
    <Modal visible={visible} animationType="fade" onRequestClose={() => {}} statusBarTranslucent>
      <View style={[styles.bloqueio, { paddingTop: insets.top + espaco.xxl, paddingBottom: insets.bottom + espaco.xl }]}>
        <View style={styles.bloqueioConteudo}>
          <View style={styles.bloqueioIcone}>
            <MaterialCommunityIcons name="map-marker-alert-outline" size={40} color={cores.primaria} />
          </View>
          <Text style={styles.bloqueioTitulo}>{texto.titulo}</Text>
          <Text style={styles.bloqueioTexto}>{texto.explicacao}</Text>
          <Text style={styles.bloqueioTexto}>
            Sua empresa exige a localização ativa durante o expediente. O app libera sozinho assim que estiver
            resolvido.
          </Text>
          {detalhe && situacao === 'FALHA_AO_INICIAR' && <Text style={styles.bloqueioDetalhe}>{detalhe}</Text>}
          {enviosPendentes > 0 && (
            <View style={styles.pendentes}>
              <MaterialCommunityIcons name="cloud-upload-outline" size={18} color={cores.textoSecundario} />
              <Text style={styles.pendentesTexto}>
                {enviosPendentes === 1 ? '1 visita pendente continua' : `${enviosPendentes} visitas pendentes continuam`} sendo
                enviadas normalmente.
              </Text>
            </View>
          )}
        </View>

        <View style={styles.bloqueioAcoes}>
          {texto.acao && (
            <Pressable style={({ pressed }) => [styles.botaoPrimario, pressed && styles.pressionado]} onPress={onResolver} disabled={resolvendo}>
              {resolvendo ? <ActivityIndicator color={cores.onPrimaria} /> : <Text style={styles.botaoPrimarioTexto}>{texto.acao}</Text>}
            </Pressable>
          )}
          <Pressable style={styles.botaoSecundario} onPress={onSair}>
            <Text style={styles.botaoSecundarioTexto}>Sair da conta</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  avisoContainer: { position: 'absolute', left: espaco.md, right: espaco.md },
  aviso: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    backgroundColor: cores.acentoClaro,
    borderColor: cores.acentoBorda,
    borderWidth: 1,
    borderRadius: raio.lg,
    paddingVertical: espaco.md,
    paddingHorizontal: espaco.lg,
    ...sombraFlutuante,
  },
  avisoTextos: { flex: 1, gap: 2 },
  avisoTitulo: { ...tipografia.destaque, color: cores.acentoTexto },
  avisoSub: { ...tipografia.corpoSecundario, color: cores.acentoTexto },
  avisoBotao: {
    backgroundColor: cores.primaria,
    borderRadius: raio.pill,
    paddingVertical: espaco.sm,
    paddingHorizontal: espaco.lg,
    minWidth: 88,
    alignItems: 'center',
  },
  avisoBotaoTexto: { ...tipografia.botao, color: cores.onPrimaria, fontSize: 14 },

  bloqueio: { flex: 1, backgroundColor: cores.fundo, paddingHorizontal: espaco.xl, justifyContent: 'space-between' },
  bloqueioConteudo: { alignItems: 'center', gap: espaco.lg },
  bloqueioIcone: {
    width: 80,
    height: 80,
    borderRadius: raio.xl,
    backgroundColor: cores.primariaClara,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bloqueioTitulo: { ...tipografia.titulo, color: cores.texto, textAlign: 'center' },
  bloqueioTexto: { ...tipografia.corpo, color: cores.textoSecundario, textAlign: 'center', lineHeight: 22 },
  bloqueioDetalhe: { ...tipografia.corpoSecundario, color: cores.erroTexto, textAlign: 'center' },
  pendentes: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm,
    backgroundColor: cores.fundoCard,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.borda,
    paddingVertical: espaco.sm,
    paddingHorizontal: espaco.md,
  },
  pendentesTexto: { ...tipografia.corpoSecundario, color: cores.textoSecundario, flexShrink: 1 },
  bloqueioAcoes: { gap: espaco.md },
  botaoPrimario: {
    backgroundColor: cores.primaria,
    borderRadius: raio.lg,
    paddingVertical: espaco.lg,
    alignItems: 'center',
  },
  botaoPrimarioTexto: { ...tipografia.botao, color: cores.onPrimaria },
  botaoSecundario: { paddingVertical: espaco.md, alignItems: 'center' },
  botaoSecundarioTexto: { ...tipografia.botao, color: cores.textoSecundario },
  pressionado: { opacity: 0.85 },
});
