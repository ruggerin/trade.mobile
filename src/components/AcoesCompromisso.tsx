import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cancelarOrdemServico, listarMotivosNaoExecucao } from '../lib/api/ordensServico';
import { useAuth } from '../lib/auth/AuthContext';
import { exigeSequencia } from '../lib/rotaObrigatoria';
import type { OrdemServico } from '../types/api';
import { cores, espaco, raio, sombraFlutuante } from '../theme';

/**
 * Reagendar e Cancelar o compromisso (ordem de serviço). Ficam DENTRO da tela da loja, não nos cards
 * da lista da Agenda: são ações mais sérias (cancelar tira a visita da rotina e pode precisar de
 * aprovação do gestor) e ao lado do nome e do endereço do card um toque errado era fácil demais.
 * Aqui o promotor já abriu a loja, viu os dados e confirma de propósito.
 *
 * Perfil que segue a sequência do dia (docs/74): o cancelamento vira "Não vou atender", com o
 * motivo de não execução obrigatório — é o jeito de pular a vez (loja fechada, sem acesso).
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
  const { usuario } = useAuth();
  const [cancelando, setCancelando] = useState(false);
  const [escolhendoMotivo, setEscolhendoMotivo] = useState(false);
  const pulaAVez = exigeSequencia(usuario);
  // Reagendar só pra compromisso que nasceu na agenda do promotor (OS de Direcionamento/campanha não).
  const podeReagendar = ordemServico.origem === 'AGENDA';

  if (ordemServico.status !== 'PENDENTE') return null;

  async function cancelar(motivoUuid?: string) {
    setCancelando(true);
    try {
      await cancelarOrdemServico(ordemServico.id, motivoUuid ? { motivo_uuid: motivoUuid } : {});
      void queryClient.invalidateQueries({ queryKey: ['ordens-servico-agenda'] });
      void queryClient.invalidateQueries({ queryKey: ['ordens-servico'] });
      setEscolhendoMotivo(false);
      onCancelado();
    } catch (err) {
      const mensagem = axios.isAxiosError<{ message?: string }>(err) ? err.response?.data?.message : undefined;
      Alert.alert('Erro', mensagem || 'Não foi possível concluir agora. Verifique a conexão e tente novamente.');
    } finally {
      setCancelando(false);
    }
  }

  function confirmarCancelamento() {
    Alert.alert('Cancelar compromisso', `Cancelar a visita em "${ordemServico.ponto_venda.fantasia}"?`, [
      { text: 'Voltar', style: 'cancel' },
      { text: 'Cancelar compromisso', style: 'destructive', onPress: () => void cancelar() },
    ]);
  }

  return (
    <View style={styles.caixa}>
      <Text style={styles.titulo}>Este compromisso</Text>
      <Text style={styles.texto}>
        {pulaAVez
          ? 'Não vai conseguir atender esta loja? Informe o motivo para seguir para a próxima.'
          : 'Mudar a data da visita ou tirá-la da sua agenda.'}
      </Text>
      <View style={styles.linha}>
        {podeReagendar && (
          <Pressable style={({ pressed }) => [styles.botaoSecundario, pressed && { opacity: 0.85 }]} onPress={onReagendar}>
            <Text style={styles.botaoSecundarioTexto}>Reagendar</Text>
          </Pressable>
        )}
        <Pressable
          style={({ pressed }) => [styles.botaoDestrutivo, pressed && { opacity: 0.85 }]}
          onPress={pulaAVez ? () => setEscolhendoMotivo(true) : confirmarCancelamento}
          disabled={cancelando}
        >
          {cancelando ? (
            <ActivityIndicator color={cores.erro} />
          ) : (
            <Text style={styles.botaoDestrutivoTexto}>{pulaAVez ? 'Não vou atender' : 'Cancelar compromisso'}</Text>
          )}
        </Pressable>
      </View>

      <EscolherMotivoModal
        visible={escolhendoMotivo}
        loja={ordemServico.ponto_venda.fantasia}
        enviando={cancelando}
        onEscolher={(motivo) => void cancelar(motivo)}
        onClose={() => setEscolhendoMotivo(false)}
      />
    </View>
  );
}

/** Motivo de não execução (cadastro do admin) pra pular a vez — docs/74 §7.1. Precisa de sinal. */
function EscolherMotivoModal({
  visible,
  loja,
  enviando,
  onEscolher,
  onClose,
}: {
  visible: boolean;
  loja: string;
  enviando: boolean;
  onEscolher: (motivoUuid: string) => void;
  onClose: () => void;
}) {
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const motivosQuery = useQuery({
    queryKey: ['motivos-nao-execucao'],
    queryFn: listarMotivosNaoExecucao,
    enabled: visible,
  });
  const motivos = motivosQuery.data ?? [];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.fundo}>
        <View style={styles.cartao}>
          <Text style={styles.modalTitulo}>Não vou atender</Text>
          <Text style={styles.texto}>Por que você não vai atender {loja} hoje? O gestor vê o motivo.</Text>
          {motivosQuery.isLoading ? (
            <ActivityIndicator color={cores.primaria} style={{ marginVertical: espaco.lg }} />
          ) : motivosQuery.isError ? (
            <Text style={styles.erro}>Sem conexão para buscar os motivos. Tente de novo com internet.</Text>
          ) : motivos.length === 0 ? (
            <Text style={styles.erro}>Nenhum motivo cadastrado. Peça ao gestor para cadastrar os motivos de não execução.</Text>
          ) : (
            <ScrollView style={{ maxHeight: 280 }}>
              {motivos.map((m) => (
                <Pressable
                  key={m.id}
                  style={[styles.opcao, escolhido === m.id && styles.opcaoEscolhida]}
                  onPress={() => setEscolhido(m.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: escolhido === m.id }}
                >
                  <Text style={[styles.opcaoTexto, escolhido === m.id && styles.opcaoTextoEscolhida]}>{m.descricao}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          <Pressable
            style={({ pressed }) => [styles.botaoConfirmar, (!escolhido || enviando) && styles.botaoConfirmarOff, pressed && { opacity: 0.85 }]}
            disabled={!escolhido || enviando}
            onPress={() => escolhido && onEscolher(escolhido)}
          >
            {enviando ? <ActivityIndicator color={cores.onPrimaria} /> : <Text style={styles.botaoConfirmarTexto}>Pular esta loja</Text>}
          </Pressable>
          <Pressable style={styles.link} onPress={onClose} disabled={enviando}>
            <Text style={styles.linkTexto}>Voltar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
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
  fundo: { flex: 1, backgroundColor: 'rgba(17,24,39,0.55)', alignItems: 'center', justifyContent: 'center', padding: espaco.xl },
  cartao: { width: '100%', backgroundColor: cores.fundoCard, borderRadius: raio.xl, padding: espaco.xl, gap: espaco.md, ...sombraFlutuante },
  modalTitulo: { fontSize: 18, fontWeight: '800', color: cores.texto, textAlign: 'center' },
  erro: { color: cores.erro, fontSize: 13, textAlign: 'center' },
  opcao: {
    minHeight: 44,
    paddingHorizontal: espaco.md,
    justifyContent: 'center',
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.borda,
    marginBottom: espaco.sm,
  },
  opcaoEscolhida: { borderColor: cores.primaria, backgroundColor: cores.primariaClara },
  opcaoTexto: { fontSize: 14, color: cores.texto },
  opcaoTextoEscolhida: { fontWeight: '700', color: cores.primariaEscura },
  botaoConfirmar: { minHeight: 50, borderRadius: raio.md, backgroundColor: cores.primaria, alignItems: 'center', justifyContent: 'center' },
  botaoConfirmarOff: { opacity: 0.45 },
  botaoConfirmarTexto: { color: cores.onPrimaria, fontWeight: '800', fontSize: 15 },
  link: { minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  linkTexto: { color: cores.textoSecundario, fontWeight: '700', fontSize: 13 },
});
