import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Updates from 'expo-updates';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { atualizacaoDisponivelNoBuild } from '../lib/atualizacao';
import { useAuth } from '../lib/auth/AuthContext';
import { buscarVisitaEmAndamento } from '../lib/visitaLocal';
import { cores, espaco, indigo } from '../theme';

/**
 * "Nova versão pronta" (docs/107 §4.5, docs/112). O update OTA baixa sozinho, mas só entrava numa
 * abertura do zero — e com o rastreamento ligado (serviço em primeiro plano) o Android quase nunca
 * encerra o processo: tirar dos recentes não basta, o promotor teria de "Forçar parada". O toque
 * aqui chama `reloadAsync`, que recarrega o código novo no mesmo processo.
 *
 * Nunca aparece com visita em andamento: recarregar no meio do check-in/formulário faz perder o
 * contexto (a visita e os rascunhos ficam no SQLite, mas a tela volta pro início).
 */
export function FaixaAtualizacao() {
  const { usuario } = useAuth();
  const { isUpdatePending } = Updates.useUpdates();
  const [reiniciando, setReiniciando] = useState(false);

  const emVisitaQuery = useQuery({
    queryKey: ['visita-em-andamento', usuario?.id],
    queryFn: () => buscarVisitaEmAndamento(usuario!.id),
    enabled: Boolean(usuario) && isUpdatePending,
  });

  if (!atualizacaoDisponivelNoBuild() || !isUpdatePending) return null;
  if (emVisitaQuery.isLoading || emVisitaQuery.data) return null;

  async function reiniciar() {
    setReiniciando(true);
    try {
      await Updates.reloadAsync();
    } catch {
      // Não conseguiu agora: a faixa continua e o update entra na próxima abertura.
      setReiniciando(false);
    }
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.faixa, pressed && styles.pressionada]}
      onPress={() => void reiniciar()}
      disabled={reiniciando}
      accessibilityRole="button"
      accessibilityLabel="Nova versão pronta. Toque para atualizar."
    >
      <MaterialCommunityIcons name="update" size={18} color={cores.onPrimaria} />
      <Text style={styles.texto}>Nova versão do Horus pronta.</Text>
      {reiniciando ? (
        <ActivityIndicator size="small" color={cores.onPrimaria} />
      ) : (
        <View style={styles.botao}>
          <Text style={styles.botaoTexto}>Atualizar</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  faixa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm,
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.sm,
    backgroundColor: indigo[600],
  },
  pressionada: { opacity: 0.9 },
  texto: { flex: 1, color: cores.onPrimaria, fontSize: 14, fontWeight: '600' },
  botao: { backgroundColor: cores.onPrimaria, borderRadius: 999, paddingHorizontal: espaco.md, paddingVertical: 4 },
  botaoTexto: { color: indigo[700], fontWeight: '700', fontSize: 13 },
});
