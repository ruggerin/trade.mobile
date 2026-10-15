import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as FileSystem from 'expo-file-system/legacy';
import { ActivityIndicator, Image, StyleSheet, View, type ImageStyle, type StyleProp } from 'react-native';
import { useAuth } from '../lib/auth/AuthContext';
import { headersAutenticados } from '../lib/seguranca/chaveAparelho';
import { cores } from '../theme';

/**
 * Foto que pode vir de um caminho local (já copiado pro armazenamento persistente do app — ver
 * lib/db/filaRegistros.ts, sempre `file://...`) ou de uma rota autenticada do servidor (Bearer,
 * `http.../https...`). `<Image source={{ uri, headers }}>` direto na rota autenticada falha
 * silenciosamente com frequência (constatado na foto da fachada, ver DadosCadastraisLoja.tsx) —
 * então baixa pra um arquivo local com o header certo primeiro, e mostra esse arquivo. Cacheia
 * por URL (não rebaixa se já tiver).
 */
export function ImagemAutenticada({
  uri,
  style,
  resizeMode = 'cover',
}: {
  uri: string;
  style?: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain';
}) {
  const { token } = useAuth();
  const remota = uri.startsWith('http');

  const query = useQuery({
    queryKey: ['imagem-autenticada', uri],
    enabled: remota && !!token,
    retry: 1,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const nomeArquivo = uri.replace(/[^a-zA-Z0-9]/g, '_').slice(-100);
      const destino = `${FileSystem.cacheDirectory}img-${nomeArquivo}`;
      const existente = await FileSystem.getInfoAsync(destino);
      if (existente.exists && existente.size > 0) return destino;
      // Authorization + assinatura do aparelho (docs/67 Fase 3) — fora do apiClient.
      const r = await FileSystem.downloadAsync(uri, destino, { headers: await headersAutenticados(uri, token!) });
      if (r.status !== 200) {
        await FileSystem.deleteAsync(destino, { idempotent: true }).catch(() => {});
        throw new Error(`HTTP ${r.status}`);
      }
      return r.uri;
    },
  });

  const uriFinal = remota ? query.data : uri;

  if (remota && query.isLoading) {
    return (
      <View style={[styles.estado, style]}>
        <ActivityIndicator color={cores.primaria} size="small" />
      </View>
    );
  }

  // Falhou de vez (já com a nova tentativa): ícone fixo, não um spinner vermelho girando pra sempre.
  if (remota && query.isError) {
    return (
      <View style={[styles.estado, style]} accessibilityLabel="Imagem indisponível">
        <MaterialCommunityIcons name="image-broken-variant" size={26} color={cores.textoTerciario} />
      </View>
    );
  }

  if (!uriFinal) {
    return <View style={[styles.estado, style]} />;
  }

  return <Image source={{ uri: uriFinal }} style={style} resizeMode={resizeMode} />;
}

const styles = StyleSheet.create({
  estado: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cores.borda,
  },
});
