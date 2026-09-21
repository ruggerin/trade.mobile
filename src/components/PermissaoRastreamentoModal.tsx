import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { cores, espaco, raio, sombraFlutuante, tipografia } from '../theme';

/**
 * Explicação ANTES de pedir a permissão "Sempre permitir" da localização (docs/11 §4) — Android
 * e iOS penalizam pedir uma permissão tão sensível sem contexto, e o promotor merece saber o
 * que está aceitando. Só dispara o pedido de verdade quando ele toca em "Entendi, permitir".
 */
export function PermissaoRastreamentoModal({
  visible,
  enviando,
  onPermitir,
  onAgoraNao,
}: {
  visible: boolean;
  enviando: boolean;
  onPermitir: () => void;
  onAgoraNao: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onAgoraNao}>
      <View style={styles.fundo}>
        <View style={styles.cartao}>
          <View style={styles.icone}>
            <MaterialCommunityIcons name="map-marker-path" size={30} color={cores.primaria} />
          </View>
          <Text style={styles.titulo}>Compartilhar sua localização</Text>
          <Text style={styles.texto}>
            Sua empresa acompanha a rota dos promotores durante o expediente. Pra isso o app envia sua
            posição ao seu gestor, inclusive com o app fechado ou a tela apagada.
          </Text>
          <Text style={styles.texto}>
            Na próxima tela, escolha <Text style={styles.destaque}>“Permitir o tempo todo”</Text>. Você
            pode pausar quando quiser no seu Perfil, e uma notificação fica visível enquanto o
            compartilhamento estiver ativo.
          </Text>

          <Pressable
            style={({ pressed }) => [styles.botaoPrimario, pressed && styles.pressionado]}
            onPress={onPermitir}
            disabled={enviando}
          >
            {enviando ? (
              <ActivityIndicator color={cores.onPrimaria} />
            ) : (
              <Text style={styles.botaoPrimarioTexto}>Entendi, permitir</Text>
            )}
          </Pressable>
          <Pressable style={styles.botaoSecundario} onPress={onAgoraNao} disabled={enviando}>
            <Text style={styles.botaoSecundarioTexto}>Agora não</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fundo: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: espaco.xl,
  },
  cartao: {
    width: '100%',
    backgroundColor: cores.fundoCard,
    borderRadius: raio.xl,
    padding: espaco.xl,
    gap: espaco.md,
    ...sombraFlutuante,
  },
  icone: {
    width: 56,
    height: 56,
    borderRadius: raio.lg,
    backgroundColor: cores.primariaClara,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  titulo: { ...tipografia.titulo, color: cores.texto, textAlign: 'center' },
  texto: { fontSize: 14, color: cores.textoSecundario, lineHeight: 20 },
  destaque: { fontWeight: '700', color: cores.texto },
  botaoPrimario: {
    minHeight: 52,
    borderRadius: raio.md,
    backgroundColor: cores.primaria,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: espaco.sm,
  },
  botaoPrimarioTexto: { ...tipografia.botao, color: cores.onPrimaria },
  botaoSecundario: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  botaoSecundarioTexto: { color: cores.textoSecundario, fontSize: 14, fontWeight: '600' },
  pressionado: { opacity: 0.85 },
});
