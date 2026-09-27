import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buscarPontoVenda, enviarFachadaPromotor } from '../lib/api/pontosVenda';
import { useAuth } from '../lib/auth/AuthContext';
import type { ContratoAtivo, PontoVenda } from '../types/api';
import { cores, espaco, neutro, raio, sombraCard } from '../theme';

const TIPO_CONTRATO: Record<ContratoAtivo['tipo'], string> = {
  COMODATO: 'Comodato',
  PONTO_EXTRA: 'Ponto extra',
};

function Linha({ rotulo, valor }: { rotulo: string; valor: string | number | null | undefined }) {
  if (valor === null || valor === undefined || valor === '') return null;
  return (
    <View style={styles.linha}>
      <Text style={styles.linhaRotulo}>{rotulo}</Text>
      <Text style={styles.linhaValor}>{valor}</Text>
    </View>
  );
}

/**
 * Aba "Dados cadastrais" (na visita e ao abrir a loja): foto da fachada, identificação, endereço,
 * perfil e os contratos de comodato vigentes em lista, com o título de cada um. Parte do que a
 * lista de lojas já trouxe (funciona offline) e complementa com o detalhe quando há rede.
 *
 * Loja SEM foto de fachada: o promotor tira e envia a foto aqui mesmo. O backend só aceita quando
 * ainda não existe foto — nunca troca a que o admin colocou.
 *
 * `depoisDaFachada` é o encaixe do mapa/distância do check-in, que fica logo abaixo da foto.
 */
export function DadosCadastraisLoja({ pontoVenda, depoisDaFachada }: { pontoVenda: PontoVenda; depoisDaFachada?: ReactNode }) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const [erroFoto, setErroFoto] = useState<string | null>(null);
  const [versaoFoto, setVersaoFoto] = useState(0);
  const [fotoExpandida, setFotoExpandida] = useState(false);

  const detalheQuery = useQuery({
    queryKey: ['ponto-venda-detalhe', pontoVenda.id],
    queryFn: () => buscarPontoVenda(pontoVenda.id),
    // Sempre rebusca ao abrir a aba: a fachada pode ter sido enviada pelo admin depois da última vez
    // (com staleTime, a foto nova só aparecia depois de 1 minuto — ou nunca, se a consulta já
    // estava em cache). Enquanto rebusca, vale o que a lista já tinha.
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  });
  const loja = { ...pontoVenda, ...(detalheQuery.data ?? {}) };
  const contratos = loja.contratos_ativos ?? [];

  // A foto é rota autenticada. Em vez de deixar o <Image> buscar com header (que falhava sem dizer
  // por quê), baixa pra um arquivo local com o Bearer — dá o status HTTP real quando falha e a foto
  // fica em cache no aparelho. O nome do arquivo leva a versão: foto nova = arquivo novo.
  const fotoQuery = useQuery({
    queryKey: ['fachada-arquivo', loja.fachada_url, versaoFoto],
    enabled: Boolean(loja.fachada_url && token),
    retry: 1,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const destino = `${FileSystem.cacheDirectory}fachada-${pontoVenda.id}-${versaoFoto}.jpg`;
      const existente = await FileSystem.getInfoAsync(destino);
      if (existente.exists && existente.size > 0) return destino;
      const r = await FileSystem.downloadAsync(loja.fachada_url!, destino, { headers: { Authorization: `Bearer ${token}` } });
      if (r.status !== 200) {
        await FileSystem.deleteAsync(destino, { idempotent: true }).catch(() => {});
        throw new Error(`HTTP ${r.status}`);
      }
      return r.uri;
    },
  });

  const enviarMutation = useMutation({
    mutationFn: async () => {
      const permissao = await ImagePicker.requestCameraPermissionsAsync();
      if (!permissao.granted) throw new Error('permissao');
      const foto = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      if (foto.canceled || !foto.assets[0]) return null;
      return enviarFachadaPromotor(pontoVenda.id, foto.assets[0].uri);
    },
    onSuccess: (atualizada) => {
      if (!atualizada) return;
      setErroFoto(null);
      setVersaoFoto(Date.now());
      queryClient.setQueryData(['ponto-venda-detalhe', pontoVenda.id], { ...loja, ...atualizada });
      void queryClient.invalidateQueries({ queryKey: ['pontos-venda'] });
    },
    onError: (err) => {
      setErroFoto(
        err instanceof Error && err.message === 'permissao'
          ? 'Sem permissão da câmera. Ative nas configurações do aparelho.'
          : 'Não foi possível enviar a foto agora. Verifique a conexão e tente de novo.',
      );
    },
  });

  return (
    <View style={styles.container}>
      {loja.fachada_url ? (
        <Pressable
          style={styles.fachadaBox}
          onPress={() => (fotoQuery.isError ? void fotoQuery.refetch() : setFotoExpandida(true))}
          disabled={!fotoQuery.data && !fotoQuery.isError}
        >
          {fotoQuery.data ? (
            <Image
              source={{ uri: fotoQuery.data }}
              style={styles.fachada}
              resizeMode="cover"
              accessibilityLabel="Foto da fachada da loja"
            />
          ) : (
            <View style={styles.fachada} />
          )}
          {fotoQuery.isLoading && (
            <View style={styles.fachadaFalha}>
              <ActivityIndicator color={cores.branco} />
            </View>
          )}
          {fotoQuery.isError ? (
            <View style={styles.fachadaFalha}>
              <Text style={styles.fachadaFalhaTexto}>
                Não foi possível carregar a foto ({fotoQuery.error instanceof Error ? fotoQuery.error.message : 'erro'}).
                Toque para tentar de novo.
              </Text>
            </View>
          ) : (
            <View style={styles.fachadaLegenda}>
              <MaterialCommunityIcons name="arrow-expand" size={12} color={cores.texto} />
              <Text style={styles.fachadaLegendaTexto}>Toque para ampliar</Text>
            </View>
          )}
        </Pressable>
      ) : (
        <>
          <Pressable
            style={({ pressed }) => [styles.semFoto, pressed && { opacity: 0.85 }]}
            onPress={() => enviarMutation.mutate()}
            disabled={enviarMutation.isPending}
          >
            <View style={styles.semFotoIconeCirculo}>
              {enviarMutation.isPending ? (
                <ActivityIndicator color={cores.primaria} />
              ) : (
                <MaterialCommunityIcons name="camera-plus-outline" size={22} color={cores.primaria} />
              )}
            </View>
            <View style={styles.semFotoTextos}>
              <Text style={styles.semFotoTitulo}>Sem foto da fachada</Text>
              <Text style={styles.semFotoTexto}>Toque pra tirar uma foto da frente da loja</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={18} color={cores.primaria} />
          </Pressable>
          {!!erroFoto && <Text style={styles.erro}>{erroFoto}</Text>}
        </>
      )}

      <Modal visible={fotoExpandida} transparent animationType="fade" onRequestClose={() => setFotoExpandida(false)}>
        <Pressable style={styles.lightboxFundo} onPress={() => setFotoExpandida(false)}>
          {fotoQuery.data && (
            <Image source={{ uri: fotoQuery.data }} style={styles.lightboxImagem} resizeMode="contain" />
          )}
          <Pressable
            style={[styles.lightboxFechar, { top: insets.top + espaco.md }]}
            onPress={() => setFotoExpandida(false)}
            hitSlop={12}
          >
            <MaterialCommunityIcons name="close" size={20} color={cores.branco} />
          </Pressable>
        </Pressable>
      </Modal>

      {depoisDaFachada}

      <Text style={styles.secao}>Identificação</Text>
      <View style={styles.cartao}>
        <Linha rotulo="Razão social" valor={loja.razao_social} />
        <Linha rotulo="Nome fantasia" valor={loja.fantasia} />
        <Linha rotulo="CNPJ" valor={loja.cnpj} />
        <Linha rotulo="Código externo" valor={loja.codigo_externo} />
        <Linha rotulo="Telefone" valor={loja.telefone} />
      </View>

      <Text style={styles.secao}>Endereço</Text>
      <View style={styles.cartao}>
        <Linha rotulo="Rua" valor={[loja.endereco, loja.numero].filter(Boolean).join(', ')} />
        <Linha rotulo="Bairro" valor={loja.bairro} />
        <Linha rotulo="Cidade" valor={loja.cidade} />
        <Linha rotulo="CEP" valor={loja.cep} />
      </View>

      <Text style={styles.secao}>Perfil da loja</Text>
      <View style={styles.cartao}>
        <Linha rotulo="Rede" valor={loja.rede_loja?.descricao} />
        <Linha rotulo="Ramo" valor={loja.ramo_atividade?.descricao} />
        <Linha rotulo="Checkouts" valor={loja.numero_checkouts} />
      </View>

      <Text style={styles.secao}>
        {contratos.length > 0
          ? `Comodato · ${contratos.length} ${contratos.length === 1 ? 'contrato ativo' : 'contratos ativos'}`
          : 'Comodato'}
      </Text>
      {contratos.length > 0 ? (
        contratos.map((contrato) => (
          <View key={contrato.id} style={styles.contrato}>
            <Text style={styles.contratoTitulo}>{contrato.titulo ?? `Contrato de ${TIPO_CONTRATO[contrato.tipo].toLowerCase()}`}</Text>
            <View style={styles.contratoMeta}>
              <View style={styles.contratoChip}>
                <Text style={styles.contratoChipTexto}>{TIPO_CONTRATO[contrato.tipo]}</Text>
              </View>
              {!!contrato.vigencia_fim && (
                <Text style={styles.contratoVigencia}>
                  Vigente até {new Date(contrato.vigencia_fim).toLocaleDateString('pt-BR')}
                </Text>
              )}
            </View>
          </View>
        ))
      ) : (
        <Text style={styles.vazio}>
          {loja.tem_contrato_ativo
            ? 'Esta loja tem comodato ativo. Os detalhes aparecem quando houver conexão.'
            : 'Esta loja não tem contrato de comodato ativo.'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: espaco.lg, gap: espaco.xs },
  fachadaBox: { borderRadius: raio.lg, overflow: 'hidden', marginBottom: espaco.md, backgroundColor: neutro[200] } ,
  // Menor que antes (170) — a foto de verdade agora se vê inteira no lightbox (toque pra
  // ampliar); aqui só precisa dar pra reconhecer, sem ocupar tanta rolagem da aba.
  fachada: { width: '100%', height: 220 },
  fachadaFalha: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: espaco.lg,
    backgroundColor: 'rgba(15,14,30,0.55)',
  },
  fachadaFalhaTexto: { color: cores.branco, fontWeight: '700', fontSize: 13, textAlign: 'center' },
  fachadaLegenda: {
    position: 'absolute',
    left: espaco.md,
    bottom: espaco.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: cores.fundoCard,
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  fachadaLegendaTexto: { fontSize: 11, fontWeight: '700', color: cores.texto },
  lightboxFundo: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxImagem: {
    width: '100%',
    height: '80%',
  },
  lightboxFechar: {
    position: 'absolute',
    top: 56,
    right: espaco.lg,
    width: 40,
    height: 40,
    borderRadius: raio.pill,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Cartão compacto (uma linha), não mais o bloco grande de antes — o upload é uma ação
  // secundária nesta tela, não devia disputar espaço com os dados cadastrais de verdade.
  semFoto: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: cores.primariaBorda,
    backgroundColor: cores.primariaClara,
    borderRadius: raio.lg,
    padding: espaco.md,
    marginBottom: espaco.md,
  },
  semFotoIconeCirculo: {
    width: 40,
    height: 40,
    borderRadius: raio.md,
    backgroundColor: cores.fundoCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  semFotoTextos: { flex: 1, minWidth: 0, gap: 1 },
  semFotoTitulo: { fontSize: 14, fontWeight: '700', color: cores.texto },
  semFotoTexto: { fontSize: 12, color: cores.textoSecundario },
  erro: { color: cores.erro, fontSize: 12, marginTop: -espaco.sm, marginBottom: espaco.md },
  secao: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    color: neutro[500],
    textTransform: 'uppercase',
    marginTop: espaco.md,
    marginBottom: 6,
    marginLeft: 2,
  },
  cartao: {
    backgroundColor: cores.fundoCard,
    borderRadius: raio.lg,
    borderWidth: 1,
    borderColor: cores.divisor,
    paddingHorizontal: espaco.lg,
  },
  linha: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: espaco.lg,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: cores.divisor,
  },
  linhaRotulo: { fontSize: 13, color: cores.textoSecundario },
  linhaValor: { flex: 1, textAlign: 'right', fontSize: 13, fontWeight: '600', color: cores.texto },
  contrato: {
    backgroundColor: cores.fundoCard,
    borderRadius: raio.lg,
    borderWidth: 1,
    borderColor: cores.divisor,
    padding: espaco.md,
    marginBottom: espaco.sm,
    ...sombraCard,
  },
  contratoTitulo: { fontSize: 14, fontWeight: '700', color: cores.texto },
  contratoMeta: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm, marginTop: 6, flexWrap: 'wrap' },
  contratoChip: { backgroundColor: cores.primariaClara, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3 },
  contratoChipTexto: { fontSize: 11, fontWeight: '700', color: cores.primariaEscura },
  contratoVigencia: { fontSize: 12, color: cores.textoSecundario },
  vazio: { fontSize: 13, color: cores.textoTerciario, marginLeft: 2 },
});
