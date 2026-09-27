import { useQuery } from '@tanstack/react-query';
import * as FileSystem from 'expo-file-system/legacy';
import { ActivityIndicator, Image, StyleSheet, View, type ImageStyle, type StyleProp } from 'react-native';
import { useAuth } from '../lib/auth/AuthContext';
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
      const r = await FileSystem.downloadAsync(uri, destino, { headers: { Authorization: `Bearer ${token}` } });
      if (r.status !== 200) {
        await FileSystem.deleteAsync(destino, { idempotent: true }).catch(() => {});
        throw new Error(`HTTP ${r.status}`);
      }
      return r.uri;
    },
  });

  const uriFinal = remota ? query.data : uri;

  if (remota && (query.isLoading || query.isError)) {
    return (
      <View style={[styles.estado, style]}>
        <ActivityIndicator color={query.isError ? cores.erro : cores.primaria} size="small" />
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
