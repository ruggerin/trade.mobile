import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ComentariosRegistroModal } from '../components/ComentariosRegistroModal';
import { buscarNaoLidos } from '../lib/api/comentarios';
import { buscarVisita, cancelarRegistro } from '../lib/api/visitas';
import { buscarCancelamentoRegistroPermitido } from '../lib/api/parametros';
import { useAuth } from '../lib/auth/AuthContext';
import type { HistoricoStackParamList } from '../navigation/HistoricoStack';
import type { StatusVisita, VisitaRegistro } from '../types/api';
import { cores, espaco, raio, sombraCard, tipografia } from '../theme';

type Props = NativeStackScreenProps<HistoricoStackParamList, 'VisitaDetalhe'>;

const STATUS_INFO: Record<StatusVisita, { label: string; bg: string; texto: string }> = {
  ABERTA: { label: 'Aberta', bg: cores.primariaClara, texto: cores.primariaEscura },
  FINALIZADA: { label: 'Finalizada', bg: cores.sucessoFundo, texto: cores.sucesso },
  CANCELADA: { label: 'Cancelada', bg: cores.divisor, texto: cores.textoSecundario },
};

// docs/05-APP-MOBILE-UX.md §3.7 — mesmos dados da tela de visita em andamento, mas sem
// nenhuma ação (só leitura): sem "Registro geral", sem "Finalizar visita".
export function VisitaDetalheScreen({ route }: Props) {
  const { visita: visitaInicial } = route.params;
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);
  // Feedback do gestor (docs/28 §3) — registro aberto no modal + quais têm resposta não lida.
  const [feedbackRegistro, setFeedbackRegistro] = useState<VisitaRegistro | null>(null);
  const naoLidosQuery = useQuery({ queryKey: ['comentarios-nao-lidos'], queryFn: buscarNaoLidos, retry: false });
  const registrosComNaoLido = useMemo(
    () => new Set((naoLidosQuery.data?.registros ?? []).map((r) => r.registro_id)),
    [naoLidosQuery.data],
  );

  const query = useQuery({
    queryKey: ['visita', visitaInicial.id],
    queryFn: () => buscarVisita(visitaInicial.id),
    initialData: visitaInicial,
  });

  const cancelamentoPermitidoQuery = useQuery({
    queryKey: ['cancelamento-registro-permitido'],
    queryFn: buscarCancelamentoRegistroPermitido,
  });
  const cancelamentoPermitido = cancelamentoPermitidoQuery.data ?? false;

  const cancelarMutation = useMutation({
    mutationFn: (registroId: string) => cancelarRegistro(visitaInicial.id, registroId),
    onSuccess: () => {
      setErro(null);
      void queryClient.invalidateQueries({ queryKey: ['visita', visitaInicial.id] });
    },
    onError: () => setErro('Não foi possível cancelar o registro agora. Tente de novo.'),
  });

  function confirmarCancelamento(registro: VisitaRegistro) {
    Alert.alert('Cancelar registro', 'Tem certeza? Essa ação não pode ser desfeita.', [
      { text: 'Voltar', style: 'cancel' },
      { text: 'Cancelar registro', style: 'destructive', onPress: () => cancelarMutation.mutate(registro.id) },
    ]);
  }

  const visita = query.data;
  // Cancelado é soft no servidor (mantém rastro histórico), mas some da lista igual qualquer
  // "cancelar" — mesmo raciocínio do filtro de DESCARTADO na visita em andamento.
  const registros = useMemo(() => (visita.registros ?? []).filter((r) => !r.cancelado_em), [visita.registros]);
  const status = STATUS_INFO[visita.status];
  const inicio = new Date(visita.inicio_data);

  return (
    <View style={styles.container}>
      <View style={styles.cabecalho}>
        <View style={styles.cabecalhoTopo}>
          <Text style={styles.pdvNome}>{visita.ponto_venda?.fantasia}</Text>
          <View style={[styles.badge, { backgroundColor: status.bg }]}>
            <Text style={[styles.badgeTexto, { color: status.texto }]}>{status.label}</Text>
          </View>
        </View>
        <Text style={styles.infoTexto}>
          Início: {inicio.toLocaleDateString('pt-BR')} às{' '}
          {inicio.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </Text>
        {visita.fim_data && (
          <Text style={styles.infoTexto}>
            Fim: {new Date(visita.fim_data).toLocaleDateString('pt-BR')} às{' '}
            {new Date(visita.fim_data).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        )}
      </View>

      {query.isLoading && !visita.registros && (
        <View style={styles.centro}>
          <ActivityIndicator color={cores.primaria} />
        </View>
      )}

      {erro && (
        <View style={styles.erroBox}>
          <Text style={styles.erroBoxTexto}>{erro}</Text>
        </View>
      )}

      <FlatList
        data={registros}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.lista}
        ListEmptyComponent={
          !query.isLoading ? (
            <View style={styles.centro}>
              <Text style={styles.vazioTexto}>Nenhum registro nesta visita.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <RegistroCard
            registro={item}
            token={token}
            podeCancelar={cancelamentoPermitido}
            cancelando={cancelarMutation.isPending && cancelarMutation.variables === item.id}
            onCancelar={() => confirmarCancelamento(item)}
            naoLido={registrosComNaoLido.has(item.id)}
            onFeedback={() => setFeedbackRegistro(item)}
          />
        )}
      />

      <ComentariosRegistroModal
        visible={feedbackRegistro !== null}
        visitaUuid={visitaInicial.id}
        registroUuid={feedbackRegistro?.id ?? null}
        titulo={feedbackRegistro?.produto_auditoria?.descricao ?? feedbackRegistro?.tipo_registro.descricao ?? 'Registro'}
        onClose={() => setFeedbackRegistro(null)}
      />
    </View>
  );
}

function RegistroCard({
  registro,
  token,
  podeCancelar,
  cancelando,
  onCancelar,
  naoLido,
  onFeedback,
}: {
  registro: VisitaRegistro;
  token: string | null;
  podeCancelar: boolean;
  cancelando: boolean;
  onCancelar: () => void;
  naoLido: boolean;
  onFeedback: () => void;
}) {
  const vinculoLabel = registro.secao?.descricao ?? registro.departamento?.descricao ?? registro.marca?.descricao;
  const tituloPrincipal = registro.produto_auditoria?.descricao ?? vinculoLabel ?? registro.tipo_registro.descricao;
  const valoresCampos = registro.valores_campos ? Object.entries(registro.valores_campos) : [];

  return (
    <View style={styles.registroCard}>
      {registro.imagens.length > 0 && token ? (
        <View style={styles.registroImagensLinha}>
          {registro.imagens.map((imagem) => (
            <Image
              key={imagem.id}
              source={{ uri: imagem.url, headers: { Authorization: `Bearer ${token}` } }}
              style={styles.registroImagem}
            />
          ))}
        </View>
      ) : (
        <View style={[styles.registroImagem, styles.registroImagemVazia]} />
      )}
      <View style={styles.registroInfo}>
        <Text style={styles.registroTipo}>{tituloPrincipal}</Text>
        <Text style={styles.registroObservacao}>{registro.tipo_registro.descricao}</Text>
        {valoresCampos.map(([chave, valor]) => (
          <Text key={chave} style={styles.registroObservacao}>
            {valor}
          </Text>
        ))}
        {!!registro.observacao && <Text style={styles.registroObservacao}>{registro.observacao}</Text>}
        {registro.ruptura && <Text style={styles.badgeRuptura}>Ruptura</Text>}
        {registro.pontuacao !== null && (
          <Text style={styles.badgePontuacao}>{registro.pontuacao}% de compliance</Text>
        )}
        <Pressable onPress={onFeedback} hitSlop={8}>
          <Text style={styles.linkFeedback}>
            {(registro.comentarios_count ?? 0) === 0
              ? 'Comentar'
              : `${registro.comentarios_count} ${registro.comentarios_count === 1 ? 'comentário' : 'comentários'}`}
            {naoLido ? ' · nova resposta' : ''}
          </Text>
        </Pressable>
        {podeCancelar && (
          <Pressable onPress={onCancelar} disabled={cancelando} hitSlop={8}>
            <Text style={styles.linkCancelar}>{cancelando ? 'Cancelando...' : 'Cancelar registro'}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  linkFeedback: {
    color: cores.primaria,
    fontSize: 13,
    fontWeight: '700',
    marginTop: espaco.sm,
  },
  container: {
    flex: 1,
    backgroundColor: cores.fundo,
  },
  cabecalho: {
    backgroundColor: cores.fundoCard,
    padding: espaco.xl,
    borderBottomWidth: 1,
    borderBottomColor: cores.divisor,
    gap: 4,
  },
  cabecalhoTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: espaco.sm,
  },
  pdvNome: {
    ...tipografia.titulo,
    flex: 1,
    color: cores.texto,
  },
  infoTexto: {
    fontSize: 14,
    color: cores.textoSecundario,
  },
  badge: {
    borderRadius: raio.sm,
    paddingHorizontal: espaco.sm,
    paddingVertical: 4,
  },
  badgeTexto: {
    fontSize: 12,
    fontWeight: '700',
  },
  centro: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: espaco.xxl * 1.5,
  },
  vazioTexto: {
    fontSize: 15,
    color: cores.textoSecundario,
    textAlign: 'center',
  },
  lista: {
    padding: espaco.lg,
    gap: espaco.md,
    flexGrow: 1,
  },
  registroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: cores.fundoCard,
    borderRadius: raio.lg,
    padding: espaco.md,
    borderWidth: 1,
    borderColor: cores.borda,
    gap: espaco.md,
    ...sombraCard,
  },
  registroImagensLinha: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    width: 56,
  },
  registroImagem: {
    width: 56,
    height: 56,
    borderRadius: raio.sm,
  },
  registroImagemVazia: {
    backgroundColor: cores.borda,
  },
  registroInfo: {
    flex: 1,
  },
  registroTipo: {
    fontSize: 15,
    fontWeight: '600',
    color: cores.texto,
  },
  registroObservacao: {
    fontSize: 13,
    color: cores.textoSecundario,
    marginTop: 2,
  },
  badgeRuptura: {
    marginTop: espaco.xs,
    alignSelf: 'flex-start',
    backgroundColor: cores.erroFundo,
    color: cores.erro,
    fontSize: 12,
    fontWeight: '700',
    borderRadius: raio.sm,
    paddingHorizontal: espaco.sm,
    paddingVertical: 2,
  },
  badgePontuacao: {
    marginTop: espaco.xs,
    alignSelf: 'flex-start',
    backgroundColor: cores.acentoClaro,
    color: cores.acentoTexto,
    fontSize: 12,
    fontWeight: '700',
    borderRadius: raio.sm,
    paddingHorizontal: espaco.sm,
    paddingVertical: 2,
  },
  linkCancelar: {
    marginTop: espaco.sm,
    fontSize: 12,
    color: cores.erro,
    fontWeight: '700',
  },
  erroBox: {
    backgroundColor: cores.erroFundo,
    borderWidth: 1,
    borderColor: cores.erroBorda,
    borderRadius: raio.md,
    padding: espaco.md,
    marginHorizontal: espaco.lg,
    marginTop: espaco.md,
  },
  erroBoxTexto: {
    color: cores.erro,
    fontSize: 14,
  },
});
