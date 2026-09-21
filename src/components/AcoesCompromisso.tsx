import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { cancelarOrdemServico } from '../lib/api/ordensServico';
import type { OrdemServico } from '../types/api';
import { cores, espaco, raio } from '../theme';

/**
 * Reagendar e Cancelar o compromisso (ordem de serviço). Ficam DENTRO da tela da loja, não nos cards
 * da lista da Agenda: são ações mais sérias (cancelar tira a visita da rotina e pode precisar de
 * aprovação do gestor) e ao lado do nome e do endereço do card um toque errado era fácil demais.
 * Aqui o promotor já abriu a loja, viu os dados e confirma de propósito.
 */
export function AcoesCompromisso({
  ordemServico,
  onReagendar,
  onCancelado,
}: {
  ordemServico: OrdemServico;
  onReagendar: () => void;
  onCancelado: () => void;
}) {
  const queryClient = useQueryClient();
  const [cancelando, setCancelando] = useState(false);

  if (ordemServico.status !== 'PENDENTE') return null;

  function confirmarCancelamento() {
    Alert.alert('Cancelar compromisso', `Cancelar a visita em "${ordemServico.ponto_venda.fantasia}"?`, [
      { text: 'Voltar', style: 'cancel' },
      {
        text: 'Cancelar compromisso',
        style: 'destructive',
        onPress: async () => {
          setCancelando(true);
          try {
            await cancelarOrdemServico(ordemServico.id);
            void queryClient.invalidateQueries({ queryKey: ['ordens-servico-agenda'] });
            void queryClient.invalidateQueries({ queryKey: ['ordens-servico'] });
            onCancelado();
          } catch {
            Alert.alert('Erro', 'Não foi possível cancelar agora. Tente novamente.');
          } finally {
            setCancelando(false);
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.caixa}>
      <Text style={styles.titulo}>Este compromisso</Text>
      <Text style={styles.texto}>Mudar a data da visita ou tirá-la da sua agenda.</Text>
      <View style={styles.linha}>
        <Pressable style={({ pressed }) => [styles.botaoSecundario, pressed && { opacity: 0.85 }]} onPress={onReagendar}>
          <Text style={styles.botaoSecundarioTexto}>Reagendar</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.botaoDestrutivo, pressed && { opacity: 0.85 }]}
          onPress={confirmarCancelamento}
          disabled={cancelando}
        >
          {cancelando ? <ActivityIndicator color={cores.erro} /> : <Text style={styles.botaoDestrutivoTexto}>Cancelar compromisso</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  caixa: {
    marginTop: espaco.xl,
    padding: espaco.lg,
    borderRadius: raio.lg,
    borderWidth: 1,
    borderColor: cores.divisor,
    backgroundColor: cores.fundoCard,
    gap: espaco.sm,
  },
  titulo: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: cores.textoTerciario, textTransform: 'uppercase' },
  texto: { fontSize: 13, color: cores.textoSecundario },
  linha: { flexDirection: 'row', gap: espaco.sm, marginTop: espaco.xs },
  botaoSecundario: {
    flex: 1,
    minHeight: 44,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.borda,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoSecundarioTexto: { fontSize: 14, fontWeight: '700', color: cores.texto },
  botaoDestrutivo: {
    flex: 1.4,
    minHeight: 44,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.erroBorda,
    backgroundColor: cores.erroFundo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoDestrutivoTexto: { fontSize: 14, fontWeight: '700', color: cores.erro },
});
