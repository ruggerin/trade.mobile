import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../lib/auth/AuthContext';
import { obterUltimaSincronizacao } from '../lib/db/database';
import { processarFilaEnvio } from '../lib/filaEnvio';
import { sincronizarAgora } from '../lib/sync';
import { useAoAtualizarFilaEnvio } from '../lib/useFilaEnvioAtualizada';
import { listarVisitasLocaisPendentesOuRejeitadas } from '../lib/visitaLocal';

// docs/05-APP-MOBILE-UX.md §3.8 — nome/e-mail do usuário, empresa (tenant), botão Sair com
// confirmação, espaço pra versão do app.
export function PerfilScreen() {
  const { usuario, logout } = useAuth();
  const queryClient = useQueryClient();
  const [ultimaSincronizacao, setUltimaSincronizacao] = useState<string | null>(null);

  // Lê a última sincronização já registrada no cache local assim que a tela abre — sem isso, o
  // promotor não tem como saber se já sincronizou hoje sem apertar o botão de novo.
  useEffect(() => {
    obterUltimaSincronizacao()
      .then(setUltimaSincronizacao)
      .catch(() => {});
  }, []);

  const sincronizarMutation = useMutation({
    mutationFn: sincronizarAgora,
    onSuccess: (resultado) => {
      setUltimaSincronizacao(new Date().toISOString());
      Alert.alert(
        'Sincronizado',
        `${resultado.pontosVenda} ponto(s) de venda, ${resultado.tiposRegistro} tipo(s) de registro e ${resultado.parametros} parâmetro(s) atualizados.`,
      );
    },
    onError: () => {
      Alert.alert(
        'Sem conexão',
        'Não foi possível sincronizar agora. Verifique sua internet e tente novamente — o app continua usando os últimos dados salvos.',
      );
    },
  });

  // Fila de ENVIO (visitas/registros coletados offline, ver docs/04-APP-MOBILE.md "Fila
  // offline de envio") — diferente do botão acima, que só PUXA dado de referência novo. Este
  // aqui é EMPURRAR o que o promotor já coletou; os dois giram sozinhos em segundo plano
  // (lib/sync.ts / lib/filaEnvio.ts), o botão aqui é só pra quando o promotor quer confirmar na
  // hora que já foi tudo.
  const filaQuery = useQuery({
    queryKey: ['visitas-locais-pendentes', usuario?.id],
    queryFn: () => listarVisitasLocaisPendentesOuRejeitadas(usuario!.id),
    enabled: Boolean(usuario),
  });
  useAoAtualizarFilaEnvio(() => void queryClient.invalidateQueries({ queryKey: ['visitas-locais-pendentes'] }));
  const pendentes = (filaQuery.data ?? []).filter((v) => v.status !== 'REJEITADA');
  const rejeitadas = (filaQuery.data ?? []).filter((v) => v.status === 'REJEITADA');

  const enviarFilaMutation = useMutation({
    mutationFn: () => processarFilaEnvio(usuario!.id),
    onSuccess: (resultado) => {
      void queryClient.invalidateQueries({ queryKey: ['visitas-locais-pendentes'] });
      const partes: string[] = [];
      if (resultado.visitasEnviadas > 0) partes.push(`${resultado.visitasEnviadas} visita(s) enviada(s)`);
      if (resultado.registrosEnviados > 0) partes.push(`${resultado.registrosEnviados} registro(s) enviado(s)`);
      if (resultado.visitasRejeitadas > 0) partes.push(`${resultado.visitasRejeitadas} visita(s) recusada(s)`);
      Alert.alert(
        'Fila de envio',
        partes.length > 0
          ? partes.join(', ') + '.'
          : 'Nada novo pra enviar agora, ou sem conexão no momento — o app continua tentando sozinho.',
      );
    },
  });

  function confirmarSaida() {
    const totalPendente = pendentes.length + rejeitadas.length;
    if (totalPendente > 0) {
      Alert.alert(
        'Sair com envios pendentes?',
        `Você tem ${totalPendente} visita(s) ainda não confirmadas pelo servidor. Elas ficam guardadas neste aparelho e só são enviadas quando você entrar de novo aqui com conexão — não são perdidas, mas também não sincronizam enquanto você estiver deslogado.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Sair mesmo assim', style: 'destructive', onPress: () => void logout() },
        ],
      );
      return;
    }
    Alert.alert('Sair', 'Deseja realmente sair da sua conta?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: () => void logout() },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.avatar}>
        <Text style={styles.avatarTexto}>{usuario?.nome?.charAt(0).toUpperCase() ?? '?'}</Text>
      </View>

      <Text style={styles.nome}>{usuario?.nome}</Text>
      <Text style={styles.email}>{usuario?.email}</Text>

      {usuario?.empresa && (
        <View style={styles.empresaBox}>
          <Text style={styles.empresaLabel}>Empresa</Text>
          <Text style={styles.empresaNome}>{usuario.empresa.nome_fantasia}</Text>
        </View>
      )}

      <View style={styles.syncBox}>
        <Pressable
          style={({ pressed }) => [styles.botaoSync, pressed && styles.botaoPressionado]}
          onPress={() => sincronizarMutation.mutate()}
          disabled={sincronizarMutation.isPending}
        >
          {sincronizarMutation.isPending ? (
            <ActivityIndicator color="#2563eb" />
          ) : (
            <Text style={styles.botaoSyncTexto}>Sincronizar agora</Text>
          )}
        </Pressable>
        <Text style={styles.syncTexto}>
          {ultimaSincronizacao
            ? `Última sincronização: ${new Date(ultimaSincronizacao).toLocaleString('pt-BR')}`
            : 'Ainda não sincronizado neste aparelho'}
        </Text>
      </View>

      {(pendentes.length > 0 || rejeitadas.length > 0) && (
        <View style={styles.filaBox}>
          <Text style={styles.filaTitulo}>Fila de envio</Text>
          {pendentes.length > 0 && (
            <Text style={styles.filaTexto}>
              {pendentes.length} visita(s) aguardando envio pro servidor.
            </Text>
          )}
          {rejeitadas.length > 0 && (
            <Text style={styles.filaTextoErro}>
              {rejeitadas.length} visita(s) recusada(s) — veja e descarte na aba Histórico.
            </Text>
          )}
          <Pressable
            style={({ pressed }) => [styles.botaoFila, pressed && styles.botaoPressionado]}
            onPress={() => enviarFilaMutation.mutate()}
            disabled={enviarFilaMutation.isPending}
          >
            {enviarFilaMutation.isPending ? (
              <ActivityIndicator color="#2563eb" />
            ) : (
              <Text style={styles.botaoFilaTexto}>Tentar enviar agora</Text>
            )}
          </Pressable>
        </View>
      )}

      <Pressable
        style={({ pressed }) => [styles.botaoSair, pressed && styles.botaoSairPressionado]}
        onPress={confirmarSaida}
      >
        <Text style={styles.botaoSairTexto}>Sair</Text>
      </Pressable>

      <Text style={styles.versao}>v1.0.0</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 48,
    paddingHorizontal: 24,
    backgroundColor: '#ffffff',
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  avatarTexto: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '700',
  },
  nome: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  email: {
    fontSize: 15,
    color: '#6b7280',
    marginTop: 4,
  },
  empresaBox: {
    marginTop: 24,
    width: '100%',
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  empresaLabel: {
    fontSize: 12,
    color: '#9ca3af',
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  empresaNome: {
    fontSize: 16,
    color: '#111827',
    fontWeight: '600',
    marginTop: 4,
  },
  syncBox: {
    marginTop: 24,
    width: '100%',
    alignItems: 'center',
  },
  botaoSync: {
    width: '100%',
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoPressionado: {
    backgroundColor: '#eff6ff',
  },
  botaoSyncTexto: {
    color: '#2563eb',
    fontSize: 16,
    fontWeight: '700',
  },
  syncTexto: {
    marginTop: 8,
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
  },
  filaBox: {
    marginTop: 16,
    width: '100%',
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 12,
    padding: 16,
  },
  filaTitulo: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400e',
    textTransform: 'uppercase',
  },
  filaTexto: {
    fontSize: 13,
    color: '#92400e',
    marginTop: 6,
  },
  filaTextoErro: {
    fontSize: 13,
    color: '#b91c1c',
    marginTop: 6,
    fontWeight: '600',
  },
  botaoFila: {
    marginTop: 12,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  botaoFilaTexto: {
    color: '#2563eb',
    fontSize: 14,
    fontWeight: '700',
  },
  botaoSair: {
    marginTop: 40,
    width: '100%',
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#fecaca',
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoSairPressionado: {
    backgroundColor: '#fef2f2',
  },
  botaoSairTexto: {
    color: '#b91c1c',
    fontSize: 16,
    fontWeight: '700',
  },
  versao: {
    marginTop: 'auto',
    marginBottom: 24,
    fontSize: 12,
    color: '#d1d5db',
  },
});
