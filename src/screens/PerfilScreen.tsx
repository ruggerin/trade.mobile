import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { ActivityIndicator, Alert, Image, Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { PermissaoRastreamentoModal } from '../components/PermissaoRastreamentoModal';
import { useRastreamento } from '../lib/useRastreamento';
import { atualizarFotoPerfil, removerFotoPerfil } from '../lib/api/perfil';
import { useAuth } from '../lib/auth/AuthContext';
import { obterUltimaSincronizacao } from '../lib/db/database';
import { processarFilaEnvio } from '../lib/filaEnvio';
import { sincronizarAgora } from '../lib/sync';
import { useAoAtualizarFilaEnvio } from '../lib/useFilaEnvioAtualizada';
import { listarVisitasLocaisPendentesOuRejeitadas } from '../lib/visitaLocal';
import { cores, espaco, raio, sombraCard, tipografia } from '../theme';

// docs/05-APP-MOBILE-UX.md §3.8 — nome/e-mail do usuário, empresa (tenant), botão Sair com
// confirmação, espaço pra versão do app.
export function PerfilScreen() {
  const { usuario, token, logout, atualizarUsuario } = useAuth();
  const queryClient = useQueryClient();
  const [ultimaSincronizacao, setUltimaSincronizacao] = useState<string | null>(null);

  // Switch de compartilhar localização (docs/11-RASTREAMENTO-TEMPO-REAL.md) — só PROMOTOR, e só
  // aparece quando a empresa habilitou o rastreamento (situacao !== INDISPONIVEL).
  const rastreamento = useRastreamento(usuario?.user_type === 'PROMOTOR', false);
  const perfilEmFoco = useIsFocused();
  const { reavaliar: reavaliarRastreamento } = rastreamento;
  useEffect(() => {
    // A situação pode ter mudado enquanto outra aba estava em foco (ex.: permissão concedida na
    // explicação aberta pelo MainTabs) — relê ao voltar pra cá.
    if (perfilEmFoco) void reavaliarRastreamento();
  }, [perfilEmFoco, reavaliarRastreamento]);
  const mostrarRastreamento = usuario?.user_type === 'PROMOTOR' && rastreamento.situacao !== null && rastreamento.situacao !== 'INDISPONIVEL';

  const fotoMutation = useMutation({
    mutationFn: atualizarFotoPerfil,
    onSuccess: (usuarioAtualizado) => atualizarUsuario(usuarioAtualizado),
    onError: () => Alert.alert('Erro', 'Não foi possível salvar a foto agora. Tente de novo.'),
  });

  const removerFotoMutation = useMutation({
    mutationFn: removerFotoPerfil,
    onSuccess: (usuarioAtualizado) => atualizarUsuario(usuarioAtualizado),
    onError: () => Alert.alert('Erro', 'Não foi possível remover a foto agora. Tente de novo.'),
  });

  async function capturarFoto(origem: 'camera' | 'galeria') {
    const permissao =
      origem === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (permissao.status !== 'granted') {
      Alert.alert(
        'Permissão necessária',
        origem === 'camera'
          ? 'Ative a permissão de câmera nas configurações do sistema pra tirar uma foto.'
          : 'Ative a permissão de fotos nas configurações do sistema pra escolher da galeria.',
        [
          { text: 'Agora não', style: 'cancel' },
          { text: 'Abrir configurações', onPress: () => void Linking.openSettings() },
        ],
      );
      return;
    }

    const resultado =
      origem === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true, aspect: [1, 1] })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.7, allowsEditing: true, aspect: [1, 1] });

    if (resultado.canceled) return;
    const asset = resultado.assets[0];
    if (!asset) return;

    fotoMutation.mutate(asset.uri);
  }

  function escolherFoto() {
    const opcoes: Parameters<typeof Alert.alert>[2] = [
      { text: 'Tirar foto', onPress: () => void capturarFoto('camera') },
      { text: 'Escolher da galeria', onPress: () => void capturarFoto('galeria') },
    ];
    if (usuario?.foto_url) {
      opcoes.push({
        text: 'Remover foto',
        style: 'destructive',
        onPress: () => Alert.alert('Remover foto', 'Tem certeza?', [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Remover', style: 'destructive', onPress: () => removerFotoMutation.mutate() },
        ]),
      });
    }
    opcoes.push({ text: 'Cancelar', style: 'cancel' });
    Alert.alert('Foto de perfil', undefined, opcoes);
  }

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
      <Pressable
        onPress={escolherFoto}
        disabled={fotoMutation.isPending || removerFotoMutation.isPending}
        style={({ pressed }) => [styles.avatarToque, pressed && { opacity: 0.7 }]}
      >
        {usuario?.foto_url ? (
          // Sempre a nossa própria API (ver Usuario.foto_url) — o header de autenticação nunca
          // vaza pra um host externo, diferente de avatar_url (que pode ser qualquer URL).
          <Image source={{ uri: usuario.foto_url, headers: { Authorization: `Bearer ${token}` } }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarSemFoto]}>
            <Text style={styles.avatarTexto}>{usuario?.nome?.charAt(0).toUpperCase() ?? '?'}</Text>
          </View>
        )}
        <View style={styles.avatarEditarBadge}>
          {fotoMutation.isPending || removerFotoMutation.isPending ? (
            <ActivityIndicator size="small" color={cores.onPrimaria} />
          ) : (
            <MaterialCommunityIcons name="pencil" size={13} color={cores.onPrimaria} />
          )}
        </View>
      </Pressable>

      <Text style={styles.nome}>{usuario?.nome}</Text>
      <Text style={styles.email}>{usuario?.email}</Text>

      {usuario?.empresa && (
        <View style={styles.empresaBox}>
          <MaterialCommunityIcons name="domain" size={20} color={cores.primaria} />
          <View>
            <Text style={styles.empresaLabel}>Empresa</Text>
            <Text style={styles.empresaNome}>{usuario.empresa.nome_fantasia}</Text>
          </View>
        </View>
      )}

      {mostrarRastreamento && (
        <View style={styles.rastreamentoBox}>
          <View style={styles.rastreamentoTextos}>
            <Text style={styles.rastreamentoTitulo}>Compartilhar minha localização</Text>
            <Text style={styles.rastreamentoDescricao}>
              {rastreamento.situacao === 'ATIVO'
                ? 'Ativo — seu gestor vê sua posição durante o expediente.'
                : rastreamento.situacao === 'DESLIGADO_PELO_PROMOTOR'
                  ? 'Pausado por você.'
                  : rastreamento.situacao === 'PERMISSAO_RECUSADA'
                    ? 'Precisa da permissão de localização "o tempo todo".'
                    : 'Aguardando permissão de localização.'}
            </Text>
          </View>
          <Switch
            value={rastreamento.situacao === 'ATIVO' || rastreamento.situacao === 'PRECISA_PERMISSAO'}
            onValueChange={(ligado) => void rastreamento.alternar(ligado)}
            trackColor={{ true: cores.primaria }}
          />
        </View>
      )}

      <PermissaoRastreamentoModal
        visible={rastreamento.explicando}
        enviando={rastreamento.pedindo}
        onPermitir={() => void rastreamento.permitir()}
        onAgoraNao={() => void rastreamento.agoraNao()}
      />

      <View style={styles.syncBox}>
        <Pressable
          style={({ pressed }) => [styles.botaoSync, pressed && styles.botaoPressionado]}
          onPress={() => sincronizarMutation.mutate()}
          disabled={sincronizarMutation.isPending}
        >
          {sincronizarMutation.isPending ? (
            <ActivityIndicator color={cores.primaria} />
          ) : (
            <>
              <MaterialCommunityIcons name="sync" size={18} color={cores.primaria} />
              <Text style={styles.botaoSyncTexto}>Sincronizar agora</Text>
            </>
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
          <View style={styles.filaTituloLinha}>
            <MaterialCommunityIcons name="tray-full" size={16} color={cores.acentoTexto} />
            <Text style={styles.filaTitulo}>Fila de envio</Text>
          </View>
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
              <ActivityIndicator color={cores.primaria} />
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
        <MaterialCommunityIcons name="logout" size={18} color={cores.erro} />
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
    paddingTop: espaco.xxl * 1.5,
    paddingHorizontal: espaco.xl,
    backgroundColor: cores.fundoCard,
  },
  avatarToque: {
    marginBottom: espaco.lg,
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
  },
  avatarSemFoto: {
    backgroundColor: cores.primaria,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTexto: {
    color: cores.onPrimaria,
    fontSize: 28,
    fontWeight: '700',
  },
  avatarEditarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: raio.pill,
    backgroundColor: cores.primaria,
    borderWidth: 2,
    borderColor: cores.fundoCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nome: {
    ...tipografia.titulo,
    color: cores.texto,
  },
  email: {
    fontSize: 15,
    color: cores.textoSecundario,
    marginTop: 4,
  },
  empresaBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    marginTop: espaco.xl,
    width: '100%',
    backgroundColor: cores.fundo,
    borderRadius: raio.lg,
    padding: espaco.lg,
    borderWidth: 1,
    borderColor: cores.borda,
  },
  empresaLabel: {
    fontSize: 12,
    color: cores.textoTerciario,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  empresaNome: {
    fontSize: 16,
    color: cores.texto,
    fontWeight: '600',
    marginTop: 2,
  },
  rastreamentoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    marginTop: espaco.lg,
    width: '100%',
    backgroundColor: cores.fundo,
    borderRadius: raio.lg,
    padding: espaco.lg,
    borderWidth: 1,
    borderColor: cores.borda,
  },
  rastreamentoTextos: { flex: 1 },
  rastreamentoTitulo: { fontSize: 15, fontWeight: '700', color: cores.texto },
  rastreamentoDescricao: { fontSize: 12, color: cores.textoSecundario, marginTop: 2 },
  syncBox: {
    marginTop: espaco.xl,
    width: '100%',
    alignItems: 'center',
  },
  botaoSync: {
    flexDirection: 'row',
    gap: espaco.sm,
    width: '100%',
    minHeight: 52,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.primaria,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoPressionado: {
    backgroundColor: cores.primariaClara,
  },
  botaoSyncTexto: {
    color: cores.primaria,
    fontSize: 16,
    fontWeight: '700',
  },
  syncTexto: {
    marginTop: espaco.sm,
    fontSize: 12,
    color: cores.textoTerciario,
    textAlign: 'center',
  },
  filaBox: {
    marginTop: espaco.lg,
    width: '100%',
    backgroundColor: cores.acentoClaro,
    borderWidth: 1,
    borderColor: cores.acentoBorda,
    borderRadius: raio.lg,
    padding: espaco.lg,
  },
  filaTituloLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.xs,
  },
  filaTitulo: {
    ...tipografia.rotulo,
    color: cores.acentoTexto,
  },
  filaTexto: {
    fontSize: 13,
    color: cores.acentoTexto,
    marginTop: espaco.xs,
  },
  filaTextoErro: {
    fontSize: 13,
    color: cores.erro,
    marginTop: espaco.xs,
    fontWeight: '600',
  },
  botaoFila: {
    marginTop: espaco.md,
    minHeight: 44,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.primaria,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cores.fundoCard,
  },
  botaoFilaTexto: {
    color: cores.primaria,
    fontSize: 14,
    fontWeight: '700',
  },
  botaoSair: {
    flexDirection: 'row',
    gap: espaco.sm,
    marginTop: espaco.xxl,
    width: '100%',
    minHeight: 52,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.erroBorda,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoSairPressionado: {
    backgroundColor: cores.erroFundo,
  },
  botaoSairTexto: {
    color: cores.erro,
    fontSize: 16,
    fontWeight: '700',
  },
  versao: {
    marginTop: 'auto',
    marginBottom: espaco.xl,
    fontSize: 12,
    color: cores.bordaForte,
  },
});
