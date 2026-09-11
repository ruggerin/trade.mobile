import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { buscarVisita, cancelarRegistro } from '../lib/api/visitas';
import { buscarCancelamentoRegistroPermitido } from '../lib/api/parametros';
import { useAuth } from '../lib/auth/AuthContext';
import type { HistoricoStackParamList } from '../navigation/HistoricoStack';
import type { StatusVisita, VisitaRegistro } from '../types/api';

type Props = NativeStackScreenProps<HistoricoStackParamList, 'VisitaDetalhe'>;

const STATUS_INFO: Record<StatusVisita, { label: string; bg: string; texto: string }> = {
  ABERTA: { label: 'Aberta', bg: '#eff6ff', texto: '#1d4ed8' },
  FINALIZADA: { label: 'Finalizada', bg: '#f0fdf4', texto: '#15803d' },
  CANCELADA: { label: 'Cancelada', bg: '#f3f4f6', texto: '#6b7280' },
};

// docs/05-APP-MOBILE-UX.md §3.7 — mesmos dados da tela de visita em andamento, mas sem
// nenhuma ação (só leitura): sem "Registro geral", sem "Finalizar visita".
export function VisitaDetalheScreen({ route }: Props) {
  const { visita: visitaInicial } = route.params;
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);

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
          <ActivityIndicator color="#2563eb" />
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
          />
        )}
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
}: {
  registro: VisitaRegistro;
  token: string | null;
  podeCancelar: boolean;
  cancelando: boolean;
  onCancelar: () => void;
}) {
  const vinculoLabel = registro.secao?.descricao ?? registro.departamento?.descricao ?? registro.marca?.descricao;
  const tituloPrincipal = registro.produto_auditoria?.descricao ?? vinculoLabel ?? registro.tipo_registro.descricao;
  const valoresCampos = registro.valores_campos ? Object.entries(registro.valores_campos) : [];

  return (
    <View style={styles.registroCard}>
      {registro.imagem_url && token ? (
        <Image
          source={{ uri: registro.imagem_url, headers: { Authorization: `Bearer ${token}` } }}
          style={styles.registroImagem}
        />
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
        {registro.momento && (
          <Text style={registro.momento === 'ANTES' ? styles.badgeAntes : styles.badgeDepois}>
            {registro.momento === 'ANTES' ? 'Antes' : 'Depois'}
          </Text>
        )}
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
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  cabecalho: {
    backgroundColor: '#ffffff',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    gap: 4,
  },
  cabecalhoTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  pdvNome: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  infoTexto: {
    fontSize: 14,
    color: '#6b7280',
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeTexto: {
    fontSize: 12,
    fontWeight: '700',
  },
  centro: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  vazioTexto: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
  },
  lista: {
    padding: 16,
    gap: 12,
    flexGrow: 1,
  },
  registroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 12,
  },
  registroImagem: {
    width: 56,
    height: 56,
    borderRadius: 8,
  },
  registroImagemVazia: {
    backgroundColor: '#e5e7eb',
  },
  registroInfo: {
    flex: 1,
  },
  registroTipo: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  registroObservacao: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  badgeRuptura: {
    marginTop: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#fef2f2',
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: '700',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeAntes: {
    marginTop: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#fff7ed',
    color: '#c2410c',
    fontSize: 12,
    fontWeight: '700',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeDepois: {
    marginTop: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#f0fdf4',
    color: '#15803d',
    fontSize: 12,
    fontWeight: '700',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  linkCancelar: {
    marginTop: 6,
    fontSize: 12,
    color: '#b91c1c',
    fontWeight: '700',
  },
  erroBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 12,
  },
  erroBoxTexto: {
    color: '#b91c1c',
    fontSize: 14,
  },
});
