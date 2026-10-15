import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { cores, espaco, raio, sombraFlutuante, tipografia } from '../theme';

/**
 * Pergunta única depois do login: "Entrar com biometria?" (padrão de mercado, lib/auth/biometria.ts).
 * "Ativar" abre o prompt do sistema e só liga se passar; "Agora não" guarda a recusa. Nos dois casos
 * a opção continua no Perfil.
 */
export function OfertaBiometriaModal({
  visible,
  onResponder,
}: {
  visible: boolean;
  onResponder: (ativar: boolean) => Promise<unknown>;
}) {
  const [enviando, setEnviando] = useState(false);

  async function responder(ativar: boolean) {
    setEnviando(true);
    try {
      await onResponder(ativar);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => void responder(false)}>
      <View style={styles.fundo}>
        <View style={styles.cartao}>
          <View style={styles.icone}>
            <MaterialCommunityIcons name="fingerprint" size={32} color={cores.primaria} />
          </View>
          <Text style={styles.titulo}>Entrar com biometria?</Text>
          <Text style={styles.texto}>
            Da próxima vez que abrir o Horus, use a biometria do seu celular em vez de digitar e-mail e senha.
          </Text>
          <Text style={styles.textoMenor}>Você pode mudar isso quando quiser no seu Perfil.</Text>

          <Pressable
            style={({ pressed }) => [styles.botaoPrimario, pressed && styles.pressionado]}
            onPress={() => void responder(true)}
            disabled={enviando}
          >
            {enviando ? (
              <ActivityIndicator color={cores.onPrimaria} />
            ) : (
              <Text style={styles.botaoPrimarioTexto}>Ativar biometria</Text>
            )}
          </Pressable>
          <Pressable style={styles.botaoSecundario} onPress={() => void responder(false)} disabled={enviando}>
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
    width: 64,
    height: 64,
    borderRadius: raio.pill,
    backgroundColor: cores.primariaClara,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  titulo: { ...tipografia.titulo, color: cores.texto, textAlign: 'center' },
  texto: { fontSize: 14, color: cores.textoSecundario, lineHeight: 20, textAlign: 'center' },
  textoMenor: { fontSize: 12, color: cores.textoTerciario, textAlign: 'center' },
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
