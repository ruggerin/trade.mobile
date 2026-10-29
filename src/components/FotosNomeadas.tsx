import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ImagemAutenticada } from './ImagemAutenticada';
import { buscarFotosAnteriores, type FotoAnteriorApi } from '../lib/api/visitas';
import { listarRegistrosLocais } from '../lib/db/filaRegistros';
import { fotosDaVisita, legendaCaptura, type FotoDaVisita, type FotoHistorico, type FotoMeta } from '../lib/fotosNomeadas';
import { useEstaOnline } from '../lib/network';
import type { CampoTipoRegistro, TipoRegistro } from '../types/api';
import { cores, espaco, indigo, neutro, raio } from '../theme';

// Fotos nomeadas no formulário (docs/98): a pergunta FOTO ("Antes", "Depois") e a galeria Horus,
// que só oferece fotos tiradas pela câmera do app — desta visita ou de visitas anteriores na loja.
// A galeria do celular nunca aparece aqui.

const ROTULO_ORIGEM: Record<string, string> = { VISITA: 'desta visita', HISTORICO: 'visita anterior' };

export function CampoFoto({
  campo,
  fotos,
  historico,
  onTirar,
  onUsarJaTirada,
  onRemover,
  onRemoverHistorico,
}: {
  campo: CampoTipoRegistro;
  fotos: { uri: string; meta: FotoMeta }[];
  historico: FotoHistorico[];
  onTirar: () => void;
  onUsarJaTirada: () => void;
  onRemover: (uri: string) => void;
  onRemoverHistorico: (uuid: string) => void;
}) {
  const total = fotos.length + historico.length;
  const cabe = !campo.foto_max || total < campo.foto_max;
  const reaproveita = !!campo.foto_reaproveitar && campo.foto_reaproveitar !== 'NAO';
  const quantidade = campo.foto_max ? `${total} de ${campo.foto_max}` : total > 0 ? `${total}` : '';

  return (
    <View style={styles.campo}>
      <Text style={styles.rotulo}>
        {campo.rotulo}
        {campo.obrigatorio ? ' *' : ''}
        {quantidade ? <Text style={styles.rotuloFraco}> · {quantidade}</Text> : null}
      </Text>
      {campo.foto_dica ? <Text style={styles.dica}>{campo.foto_dica}</Text> : null}

      {total > 0 && (
        <View style={styles.grade}>
          {fotos.map(({ uri, meta }) => (
            <View key={uri} style={styles.tile}>
              <Image source={{ uri }} style={styles.tileImagem} accessibilityLabel={`Foto ${campo.rotulo}`} />
              {meta.origem && ROTULO_ORIGEM[meta.origem] ? <Text style={styles.selo}>{ROTULO_ORIGEM[meta.origem]}</Text> : null}
              <Pressable onPress={() => onRemover(uri)} hitSlop={8} style={styles.remover} accessibilityLabel="Remover foto">
                <MaterialCommunityIcons name="close" size={11} color={cores.branco} />
              </Pressable>
            </View>
          ))}
          {historico.map((f) => (
            <View key={f.uuid} style={styles.tile}>
              <ImagemAutenticada uri={f.url} style={styles.tileImagem} />
              <Text style={styles.selo}>{legendaCaptura(f.capturadaEm) || ROTULO_ORIGEM.HISTORICO}</Text>
              <Pressable onPress={() => onRemoverHistorico(f.uuid)} hitSlop={8} style={styles.remover} accessibilityLabel="Remover foto">
                <MaterialCommunityIcons name="close" size={11} color={cores.branco} />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {cabe && (
        <View style={styles.botoes}>
          <Pressable style={({ pressed }) => [styles.botao, styles.botaoCamera, pressed && { opacity: 0.85 }]} onPress={onTirar} accessibilityRole="button">
            <MaterialCommunityIcons name="camera-outline" size={20} color={cores.primaria} />
            <Text style={styles.botaoCameraTexto}>Registro fotográfico</Text>
          </Pressable>
          {reaproveita && (
            <Pressable style={({ pressed }) => [styles.botao, pressed && { opacity: 0.85 }]} onPress={onUsarJaTirada} accessibilityRole="button">
              <MaterialCommunityIcons name="image-multiple-outline" size={20} color={cores.texto} />
              <Text style={styles.botaoTexto}>Usar foto já tirada</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Galeria Horus: escolher uma foto já tirada pela câmera do app. "Desta visita" vem do aparelho
 * (funciona sem sinal); "Visitas anteriores" vem da API, só com internet e só quando a pergunta
 * aceita o histórico.
 */
export function GaleriaHorusModal({
  campo,
  visitaLocalId,
  visitaServidorId,
  tiposRegistro,
  chavesUsadas,
  uuidsUsados,
  onEscolherDaVisita,
  onEscolherAnterior,
  onClose,
}: {
  campo: CampoTipoRegistro | null;
  visitaLocalId?: string;
  visitaServidorId?: string | null;
  tiposRegistro: TipoRegistro[];
  chavesUsadas: string[];
  uuidsUsados: string[];
  onEscolherDaVisita: (foto: FotoDaVisita) => void;
  onEscolherAnterior: (foto: FotoAnteriorApi) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const online = useEstaOnline();
  const permiteHistorico = campo?.foto_reaproveitar === 'HISTORICO';
  const [aba, setAba] = useState<'VISITA' | 'ANTERIORES'>('VISITA');

  const daVisitaQuery = useQuery({
    queryKey: ['galeria-horus', 'visita', visitaLocalId, campo?.chave],
    enabled: !!campo && !!visitaLocalId,
    queryFn: async () => {
      const registros = await listarRegistrosLocais(visitaLocalId!);
      const descricao = (uuid: string) => tiposRegistro.find((t) => t.id === uuid)?.descricao ?? 'Registro';
      return fotosDaVisita(
        registros.map((r) => ({ id: r.id, imagensLocais: r.imagensLocais, fotosMeta: r.fotosMeta, descricao: descricao(r.tipoRegistroUuid) })),
        chavesUsadas,
      );
    },
  });

  const anterioresQuery = useQuery({
    queryKey: ['galeria-horus', 'anteriores', visitaServidorId],
    enabled: !!campo && permiteHistorico && !!visitaServidorId && online && aba === 'ANTERIORES',
    queryFn: () => buscarFotosAnteriores(visitaServidorId!),
    staleTime: 60_000,
  });

  const anteriores = (anterioresQuery.data?.fotos ?? []).filter((f) => !uuidsUsados.includes(f.id));

  return (
    <Modal visible={!!campo} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.galeria, { paddingTop: insets.top + espaco.sm, paddingBottom: insets.bottom }]}>
        <View style={styles.galeriaTopo}>
          <View style={{ flex: 1 }}>
            <Text style={styles.galeriaTitulo}>Usar foto já tirada</Text>
            <Text style={styles.galeriaSub}>Para "{campo?.rotulo}". Só fotos tiradas pelo Horus.</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Fechar">
            <MaterialCommunityIcons name="close" size={24} color={cores.texto} />
          </Pressable>
        </View>

        {permiteHistorico && (
          <View style={styles.abas}>
            {(['VISITA', 'ANTERIORES'] as const).map((a) => (
              <Pressable key={a} style={[styles.aba, aba === a && styles.abaAtiva]} onPress={() => setAba(a)} accessibilityRole="tab">
                <Text style={[styles.abaTexto, aba === a && styles.abaTextoAtivo]}>{a === 'VISITA' ? 'Desta visita' : 'Visitas anteriores'}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {aba === 'VISITA' ? (
          daVisitaQuery.isLoading ? (
            <ActivityIndicator style={{ marginTop: espaco.xl }} color={cores.primaria} />
          ) : (daVisitaQuery.data ?? []).length === 0 ? (
            <Text style={styles.vazio}>Nenhuma foto salva nesta visita ainda. Fotos de um formulário aparecem aqui depois que ele é salvo.</Text>
          ) : (
            <FlatList
              data={daVisitaQuery.data}
              keyExtractor={(f) => f.chave}
              numColumns={3}
              contentContainerStyle={styles.lista}
              columnWrapperStyle={{ gap: espaco.sm }}
              renderItem={({ item }) => (
                <Pressable style={styles.item} onPress={() => onEscolherDaVisita(item)} accessibilityRole="button">
                  <Image source={{ uri: item.uri }} style={styles.itemImagem} />
                  <Text style={styles.itemTexto} numberOfLines={1}>{item.origemDescricao}</Text>
                  {item.meta.capturadaEm ? <Text style={styles.itemSub}>{legendaCaptura(item.meta.capturadaEm)}</Text> : null}
                </Pressable>
              )}
            />
          )
        ) : !online ? (
          <Text style={styles.vazio}>Sem internet. As fotos de visitas anteriores aparecem quando a conexão voltar.</Text>
        ) : !visitaServidorId ? (
          <Text style={styles.vazio}>A visita ainda está sendo enviada. Tente de novo em instantes.</Text>
        ) : anterioresQuery.isLoading ? (
          <ActivityIndicator style={{ marginTop: espaco.xl }} color={cores.primaria} />
        ) : anterioresQuery.isError ? (
          <Text style={styles.vazio}>Não foi possível carregar as fotos anteriores.</Text>
        ) : anteriores.length === 0 ? (
          <Text style={styles.vazio}>Nenhuma foto desta loja nos últimos {anterioresQuery.data?.dias ?? 60} dias.</Text>
        ) : (
          <FlatList
            data={anteriores}
            keyExtractor={(f) => f.id}
            numColumns={3}
            contentContainerStyle={styles.lista}
            columnWrapperStyle={{ gap: espaco.sm }}
            renderItem={({ item }) => (
              <Pressable style={styles.item} onPress={() => onEscolherAnterior(item)} accessibilityRole="button">
                <ImagemAutenticada uri={item.url} style={styles.itemImagem} />
                <Text style={styles.itemTexto} numberOfLines={1}>{item.pergunta ?? item.formulario ?? 'Foto'}</Text>
                <Text style={styles.itemSub} numberOfLines={1}>{legendaCaptura(item.capturada_em)}</Text>
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  campo: { gap: espaco.sm },
  rotulo: { fontSize: 13, fontWeight: '700', color: neutro[700] },
  rotuloFraco: { fontWeight: '500', color: cores.textoTerciario },
  dica: { fontSize: 13, color: cores.textoSecundario },
  grade: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.sm },
  tile: { width: 96, height: 96, borderRadius: raio.md },
  tileImagem: { width: '100%', height: '100%', borderRadius: raio.md },
  selo: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    maxWidth: 88,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: raio.sm,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.6)',
    color: cores.branco,
    fontSize: 10,
    fontWeight: '700',
  },
  remover: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: neutro[700],
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Alvo de 48 px: o promotor fotografa em pé, com uma mão.
  botoes: { flexDirection: 'row', gap: espaco.sm },
  botao: {
    flex: 1,
    minHeight: 48,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.borda,
    backgroundColor: cores.fundoCard,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: espaco.xs,
    paddingHorizontal: espaco.sm,
  },
  botaoCamera: { borderStyle: 'dashed', borderWidth: 1.5, borderColor: indigo[300], backgroundColor: cores.primariaClara },
  botaoCameraTexto: { fontSize: 14, fontWeight: '700', color: cores.primaria },
  botaoTexto: { fontSize: 14, fontWeight: '700', color: cores.texto },
  galeria: { flex: 1, backgroundColor: cores.fundo },
  galeriaTopo: { flexDirection: 'row', alignItems: 'flex-start', gap: espaco.md, paddingHorizontal: espaco.lg, paddingBottom: espaco.md },
  galeriaTitulo: { fontSize: 18, fontWeight: '800', color: cores.texto },
  galeriaSub: { fontSize: 13, color: cores.textoSecundario, marginTop: 2 },
  abas: { flexDirection: 'row', gap: espaco.sm, paddingHorizontal: espaco.lg, paddingBottom: espaco.md },
  aba: { flex: 1, minHeight: 44, borderRadius: raio.md, borderWidth: 1.5, borderColor: cores.borda, alignItems: 'center', justifyContent: 'center' },
  abaAtiva: { backgroundColor: indigo[600], borderColor: indigo[600] },
  abaTexto: { fontSize: 14, fontWeight: '700', color: neutro[600] },
  abaTextoAtivo: { color: cores.branco },
  lista: { paddingHorizontal: espaco.lg, gap: espaco.sm, paddingBottom: espaco.xl },
  item: { flex: 1 / 3, gap: 2 },
  itemImagem: { width: '100%', aspectRatio: 1, borderRadius: raio.md, backgroundColor: cores.borda },
  itemTexto: { fontSize: 12, fontWeight: '700', color: cores.texto },
  itemSub: { fontSize: 11, color: cores.textoSecundario },
  vazio: { paddingHorizontal: espaco.lg, paddingTop: espaco.xl, fontSize: 14, lineHeight: 20, color: cores.textoSecundario, textAlign: 'center' },
});
