import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  acaoPedidoVenda,
  atualizarPedidoVenda,
  buscarPedidoVenda,
  criarPedidoVenda,
  type PedidoVendaDetailResponse,
} from '../lib/api/pedidosVenda';
import { buscarPedidoSemVisitaPermitido } from '../lib/api/parametros';
import { listarPontosVenda } from '../lib/api/pontosVenda';
import { listarProdutosCatalogo } from '../lib/api/produtosAuditoria';
import {
  formatarMoeda,
  mensagemErroPedido,
  numeroDigitado,
  paraCampo,
  precoMinimo,
  STATUS_PEDIDO_VENDA,
} from '../lib/pedidoVenda';
import { mascararMoeda, numeroParaMoeda } from '../lib/mascaraMoeda';
import { useDebounce } from '../lib/useDebounce';
import type { PedidoVenda, ProdutoCatalogo } from '../types/api';
import { cores, espaco, raio, sombraCard, sombraFlutuante, tipografia } from '../theme';

// Registrada em PedidosStack (aba "Pedidos") e também em PontosVendaStack/AgendaStack, pra abrir
// de dentro da visita sem navegação cross-tab — mesmo padrão de VisitaDetalheScreen.
export type PedidoVendaParams = {
  // Presente = abre um pedido existente; ausente = pedido novo.
  pedidoId?: string;
  // Pedido novo a partir da visita já nasce com a loja (e a visita, se já sincronizou).
  pontoVenda?: { id: string; fantasia: string };
  visitaServidorId?: string | null;
};
type Props = NativeStackScreenProps<{ PedidoVenda: PedidoVendaParams | undefined }, 'PedidoVenda'>;

interface LinhaItem {
  produtoId: string;
  descricao: string;
  codigo: string | null;
  precoTabela: number;
  descontoMaximoPct: number | null;
  quantidade: string;
  preco: string;
}

function linhasDoPedido(pedido: PedidoVenda): LinhaItem[] {
  return (pedido.itens ?? []).map((i) => ({
    produtoId: i.produto?.id ?? '',
    descricao: i.produto?.descricao ?? '—',
    codigo: i.produto?.codigo_externo ?? i.produto?.codigo_barras ?? null,
    // Snapshot do pedido — o servidor revalida contra o catálogo atual no envio.
    precoTabela: i.preco_tabela,
    descontoMaximoPct: i.desconto_maximo_pct,
    quantidade: paraCampo(i.quantidade),
    preco: numeroParaMoeda(i.preco),
  }));
}

// docs/38-PEDIDO-VENDEDOR.md §8 — o vendedor monta o pedido (produto, quantidade, preço). Preço
// abaixo de tabela × (1 − desconto máximo) não trava a digitação: o botão vira "Solicitar
// autorização" e o pedido vai pra fila de quem aprova. Online na v1 (sem fila offline).
export function PedidoVendaScreen({ route, navigation }: Props) {
  const params = route.params ?? {};
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [pedidoId, setPedidoId] = useState<string | undefined>(params.pedidoId);
  const [pontoVenda, setPontoVenda] = useState(params.pontoVenda ?? null);
  const [linhas, setLinhas] = useState<LinhaItem[]>([]);
  const [observacao, setObservacao] = useState('');
  const [alterado, setAlterado] = useState(false);
  const [escolhendoProduto, setEscolhendoProduto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['pedidos-venda', pedidoId],
    queryFn: () => buscarPedidoVenda(pedidoId!),
    enabled: !!pedidoId,
  });
  const pedido = query.data?.pedido_venda ?? null;
  // Pedido NOVO sem visita (solto, ou visita cujo check-in ainda não sincronizou) só com
  // PEDIDO_VENDA_SEM_VISITA_PERMITIDO ligado — o backend recusa de qualquer jeito.
  const semVisitaQuery = useQuery({
    queryKey: ['pedido-sem-visita-permitido'],
    queryFn: buscarPedidoSemVisitaPermitido,
    enabled: !params.pedidoId && !params.visitaServidorId,
  });
  const permissoes = query.data?.permissoes;
  const editavel = !pedidoId || !!permissoes?.editar;

  // Carrega o estado do servidor na grade — só quando não há edição local pendente (senão um
  // refetch em segundo plano apagaria o que o vendedor está digitando).
  useEffect(() => {
    if (pedido && !alterado) {
      setLinhas(linhasDoPedido(pedido));
      setObservacao(pedido.observacao ?? '');
      if (pedido.ponto_venda) setPontoVenda({ id: pedido.ponto_venda.id, fantasia: pedido.ponto_venda.fantasia });
    }
  }, [pedido, alterado]);

  useEffect(() => {
    navigation.setOptions({ title: pedidoId ? 'Pedido' : 'Novo pedido' });
  }, [navigation, pedidoId]);

  const calculo = useMemo(() => {
    let total = 0;
    let abaixo = 0;
    let invalidos = 0;
    for (const l of linhas) {
      const q = numeroDigitado(l.quantidade);
      const p = numeroDigitado(l.preco);
      if (!(q > 0) || !(p > 0)) {
        invalidos++;
        continue;
      }
      total += q * p;
      if (p < precoMinimo(l.precoTabela, l.descontoMaximoPct)) abaixo++;
    }
    return { total, abaixo, invalidos };
  }, [linhas]);

  function mudar(atualizar: (atual: LinhaItem[]) => LinhaItem[]) {
    setLinhas(atualizar);
    setAlterado(true);
    setErro(null);
  }

  function adicionarProduto(produto: ProdutoCatalogo) {
    setEscolhendoProduto(false);
    if (produto.preco_tabela === null || produto.preco_tabela === undefined) return;
    const existente = linhas.findIndex((l) => l.produtoId === produto.id);
    if (existente >= 0) {
      // Produto repetido = soma 1 na linha existente (o backend recusa linha duplicada).
      mudar((atual) =>
        atual.map((l, i) =>
          i === existente ? { ...l, quantidade: paraCampo((numeroDigitado(l.quantidade) || 0) + 1) } : l,
        ),
      );
      return;
    }
    mudar((atual) => [
      ...atual,
      {
        produtoId: produto.id,
        descricao: produto.descricao,
        codigo: produto.codigo_externo ?? produto.codigo_barras ?? null,
        precoTabela: produto.preco_tabela!,
        descontoMaximoPct: produto.desconto_maximo_pct ?? null,
        quantidade: '1',
        preco: numeroParaMoeda(produto.preco_tabela!),
      },
    ]);
  }

  function aplicar(data: PedidoVendaDetailResponse) {
    queryClient.setQueryData(['pedidos-venda', data.pedido_venda.id], data);
    void queryClient.invalidateQueries({ queryKey: ['pedidos-venda-lista'] });
    setLinhas(linhasDoPedido(data.pedido_venda));
    setObservacao(data.pedido_venda.observacao ?? '');
    setAlterado(false);
    if (!pedidoId) {
      setPedidoId(data.pedido_venda.id);
      navigation.setParams({ pedidoId: data.pedido_venda.id });
    }
  }

  // Grava o que está na tela (se mudou) e devolve o id do pedido no servidor.
  async function salvar(): Promise<string> {
    const itens = linhas.map((l) => ({
      produto_uuid: l.produtoId,
      quantidade: numeroDigitado(l.quantidade),
      preco: numeroDigitado(l.preco),
    }));
    if (!pedidoId) {
      const data = await criarPedidoVenda({
        ponto_venda_uuid: pontoVenda!.id,
        visita_uuid: params.visitaServidorId ?? null,
        observacao: observacao.trim() || null,
        itens,
      });
      aplicar(data);
      return data.pedido_venda.id;
    }
    if (alterado) {
      aplicar(await atualizarPedidoVenda(pedidoId, { observacao: observacao.trim() || null, itens }));
    }
    return pedidoId;
  }

  function validar(): boolean {
    if (!pontoVenda) {
      setErro('Escolha a loja do pedido.');
      return false;
    }
    if (linhas.length === 0) {
      setErro('Adicione pelo menos um produto.');
      return false;
    }
    if (calculo.invalidos > 0) {
      setErro('Confira quantidade e preço — precisam ser maiores que zero.');
      return false;
    }
    return true;
  }

  async function executar(acao: () => Promise<void>, mensagemPadrao: string) {
    setSalvando(true);
    setErro(null);
    try {
      await acao();
    } catch (err) {
      setErro(mensagemErroPedido(err, mensagemPadrao));
    } finally {
      setSalvando(false);
    }
  }

  function salvarRascunho() {
    if (!validar()) return;
    void executar(async () => {
      await salvar();
      Alert.alert('Rascunho salvo', 'Você pode continuar depois pela aba Pedidos.');
    }, 'Não foi possível salvar o pedido.');
  }

  function enviar() {
    if (!validar()) return;
    const confirmar = () =>
      void executar(async () => {
        const id = await salvar();
        const data = await acaoPedidoVenda(id, 'enviar');
        aplicar(data);
        Alert.alert(
          data.pedido_venda.status === 'PENDENTE_AUTORIZACAO' ? 'Autorização solicitada' : 'Pedido enviado',
          data.pedido_venda.status === 'PENDENTE_AUTORIZACAO'
            ? 'O pedido tem preço abaixo do mínimo e foi para a fila de autorização. Você acompanha o status aqui.'
            : 'Nenhum item abaixo do mínimo — o pedido já está aprovado.',
        );
      }, 'Não foi possível enviar o pedido.');

    if (calculo.abaixo > 0) {
      Alert.alert(
        'Solicitar autorização?',
        `${calculo.abaixo} ${calculo.abaixo === 1 ? 'item está' : 'itens estão'} abaixo do preço mínimo. O pedido fica travado até alguém autorizar.`,
        [{ text: 'Voltar', style: 'cancel' }, { text: 'Solicitar', onPress: confirmar }],
      );
    } else {
      confirmar();
    }
  }

  function cancelarPedido() {
    Alert.alert('Cancelar pedido?', 'Cancelamento é definitivo — para refazer, é um pedido novo.', [
      { text: 'Voltar', style: 'cancel' },
      {
        text: 'Cancelar pedido',
        style: 'destructive',
        onPress: () => void executar(async () => aplicar(await acaoPedidoVenda(pedidoId!, 'cancelar')), 'Não foi possível cancelar.'),
      },
    ]);
  }

  function concluirPedido() {
    Alert.alert('Concluir pedido?', 'Marque como concluído quando o pedido já tiver sido lançado/faturado.', [
      { text: 'Voltar', style: 'cancel' },
      {
        text: 'Concluir',
        onPress: () => void executar(async () => aplicar(await acaoPedidoVenda(pedidoId!, 'concluir')), 'Não foi possível concluir.'),
      },
    ]);
  }

  if (pedidoId && query.isLoading) {
    return (
      <View style={styles.centro}>
        <ActivityIndicator size="large" color={cores.primaria} />
      </View>
    );
  }
  if (pedidoId && query.isError && !pedido) {
    return (
      <View style={styles.centro}>
        <Text style={styles.textoSecundario}>{mensagemErroPedido(query.error, 'Não foi possível carregar o pedido.')}</Text>
        <Pressable style={styles.botaoPrimario} onPress={() => void query.refetch()}>
          <Text style={styles.botaoPrimarioTexto}>Tentar novamente</Text>
        </Pressable>
      </View>
    );
  }

  if (!pedidoId && !params.visitaServidorId && semVisitaQuery.isSuccess && !semVisitaQuery.data) {
    return (
      <View style={styles.centro}>
        <MaterialCommunityIcons name="storefront-outline" size={40} color={cores.textoTerciario} />
        <Text style={[styles.textoCorpo, { textAlign: 'center' }]}>
          {params.pontoVenda
            ? 'O check-in desta visita ainda não chegou ao servidor. Assim que sincronizar, você consegue tirar o pedido.'
            : 'Sua empresa só permite tirar pedido durante uma visita. Faça check-in na loja e toque em "Tirar pedido".'}
        </Text>
        <Pressable style={styles.botaoPrimario} onPress={() => navigation.goBack()}>
          <Text style={styles.botaoPrimarioTexto}>Voltar</Text>
        </Pressable>
      </View>
    );
  }

  if (!pontoVenda) {
    return <EscolherLoja onEscolher={(pv) => setPontoVenda(pv)} />;
  }

  const status = pedido ? STATUS_PEDIDO_VENDA[pedido.status] : null;
  const mostrarEnviar = !pedidoId || !!permissoes?.enviar || (pedido?.status === 'APROVADO' && alterado);

  return (
    <KeyboardAvoidingView style={styles.container} behavior="padding">
      <ScrollView contentContainerStyle={styles.conteudo} keyboardShouldPersistTaps="handled">
        <View style={styles.cabecalho}>
          <View style={{ flex: 1 }}>
            <Text style={styles.loja} numberOfLines={1}>
              {pontoVenda.fantasia}
            </Text>
            <Text style={styles.textoSecundario}>
              {params.visitaServidorId || pedido?.visita_id ? 'Pedido da visita' : 'Pedido fora de visita'}
            </Text>
          </View>
          {status && (
            <View style={[styles.chip, { backgroundColor: status.fundo }]}>
              <Text style={[styles.chipTexto, { color: status.cor }]}>{status.label}</Text>
            </View>
          )}
        </View>

        {pedido?.status === 'PENDENTE_AUTORIZACAO' && (
          <Aviso icone="clock-outline" cor={cores.acentoTexto} fundo={cores.acentoClaro}>
            Aguardando autorização de preço. O pedido não pode ser editado até alguém aprovar ou rejeitar.
          </Aviso>
        )}
        {pedido?.status === 'APROVADO' && editavel && (
          <Aviso icone="information-outline" cor={cores.primaria} fundo={cores.primariaClara}>
            Pedido aprovado. Se você mudar algo, ele volta para rascunho e precisa ser enviado de novo.
          </Aviso>
        )}
        {erro && (
          <Aviso icone="alert-circle-outline" cor={cores.erroTexto} fundo={cores.erroFundo}>
            {erro}
          </Aviso>
        )}

        <Text style={styles.secaoLabel}>Itens</Text>
        {linhas.length === 0 && <Text style={styles.textoSecundario}>Nenhum produto ainda.</Text>}
        {linhas.map((l, idx) => (
          <LinhaItemCard
            key={l.produtoId}
            linha={l}
            editavel={editavel}
            onMudar={(campo, valor) => mudar((atual) => atual.map((x, i) => (i === idx ? { ...x, [campo]: valor } : x)))}
            onRemover={() => mudar((atual) => atual.filter((_, i) => i !== idx))}
          />
        ))}
        {editavel && (
          <Pressable style={styles.botaoAdicionar} onPress={() => setEscolhendoProduto(true)}>
            <MaterialCommunityIcons name="plus" size={20} color={cores.primaria} />
            <Text style={styles.botaoAdicionarTexto}>Adicionar produto</Text>
          </Pressable>
        )}

        <Text style={styles.secaoLabel}>Observação</Text>
        {editavel ? (
          <TextInput
            style={[styles.input, styles.inputMultilinha]}
            placeholder="Ex.: entregar na segunda, falar com o gerente"
            value={observacao}
            onChangeText={(v) => {
              setObservacao(v);
              setAlterado(true);
            }}
            multiline
          />
        ) : (
          <Text style={styles.textoCorpo}>{observacao || '—'}</Text>
        )}

        {!!pedido?.historico?.length && (
          <>
            <Text style={styles.secaoLabel}>Histórico</Text>
            {pedido.historico.map((h) => (
              <View key={h.id} style={styles.historicoItem}>
                <Text style={styles.textoCorpo}>{h.descricao}</Text>
                <Text style={styles.textoSecundario}>
                  {new Date(h.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  {h.usuario ? ` · ${h.usuario.nome}` : ''}
                </Text>
                {h.motivo && <Text style={styles.historicoMotivo}>Motivo: {h.motivo}</Text>}
              </View>
            ))}
          </>
        )}

        {pedidoId && permissoes?.cancelar && (
          <Pressable style={styles.linkPerigo} onPress={cancelarPedido} disabled={salvando}>
            <Text style={styles.linkPerigoTexto}>Cancelar pedido</Text>
          </Pressable>
        )}
      </ScrollView>

      <View style={[styles.rodape, { paddingBottom: Math.max(insets.bottom, espaco.md) }]}>
        <View style={styles.rodapeTotal}>
          <Text style={styles.textoSecundario}>
            {linhas.length} {linhas.length === 1 ? 'item' : 'itens'}
            {calculo.abaixo > 0 && editavel ? ` · ${calculo.abaixo} abaixo do mínimo` : ''}
          </Text>
          <Text style={styles.total}>{formatarMoeda(calculo.total)}</Text>
        </View>
        <View style={styles.rodapeBotoes}>
          {editavel && (
            <Pressable
              style={[styles.botaoSecundario, (salvando || (!!pedidoId && !alterado)) && styles.botaoDesabilitado]}
              onPress={salvarRascunho}
              disabled={salvando || (!!pedidoId && !alterado)}
            >
              <Text style={styles.botaoSecundarioTexto}>Salvar</Text>
            </Pressable>
          )}
          {editavel && mostrarEnviar && (
            <Pressable
              style={[styles.botaoPrimario, { flex: 1 }, calculo.abaixo > 0 && styles.botaoAcento, salvando && styles.botaoDesabilitado]}
              onPress={enviar}
              disabled={salvando}
            >
              {salvando ? (
                <ActivityIndicator color={cores.onPrimaria} />
              ) : (
                <Text style={styles.botaoPrimarioTexto}>{calculo.abaixo > 0 ? 'Solicitar autorização' : 'Enviar pedido'}</Text>
              )}
            </Pressable>
          )}
          {permissoes?.concluir && !alterado && (
            <Pressable style={[styles.botaoPrimario, { flex: 1 }, styles.botaoSucesso]} onPress={concluirPedido} disabled={salvando}>
              <Text style={styles.botaoPrimarioTexto}>Concluir pedido</Text>
            </Pressable>
          )}
        </View>
      </View>

      <EscolherProdutoModal
        visivel={escolhendoProduto}
        onFechar={() => setEscolhendoProduto(false)}
        onEscolher={adicionarProduto}
      />
    </KeyboardAvoidingView>
  );
}

function LinhaItemCard({
  linha,
  editavel,
  onMudar,
  onRemover,
}: {
  linha: LinhaItem;
  editavel: boolean;
  onMudar: (campo: 'quantidade' | 'preco', valor: string) => void;
  onRemover: () => void;
}) {
  const minimo = precoMinimo(linha.precoTabela, linha.descontoMaximoPct);
  const preco = numeroDigitado(linha.preco);
  const quantidade = numeroDigitado(linha.quantidade);
  const abaixo = preco > 0 && preco < minimo;
  const subtotal = quantidade > 0 && preco > 0 ? quantidade * preco : null;

  return (
    <View style={[styles.itemCard, abaixo && styles.itemCardAbaixo]}>
      <View style={styles.itemTopo}>
        <View style={{ flex: 1 }}>
          <Text style={styles.itemDescricao}>{linha.descricao}</Text>
          <Text style={styles.textoSecundario}>
            Tabela {formatarMoeda(linha.precoTabela)} · mínimo {formatarMoeda(minimo)}
          </Text>
        </View>
        {editavel && (
          <Pressable onPress={onRemover} hitSlop={10}>
            <MaterialCommunityIcons name="close" size={20} color={cores.textoTerciario} />
          </Pressable>
        )}
      </View>
      <View style={styles.itemCampos}>
        <View style={{ flex: 1 }}>
          <Text style={styles.campoLabel}>Qtd.</Text>
          {editavel ? (
            <TextInput
              style={styles.input}
              value={linha.quantidade}
              onChangeText={(v) => onMudar('quantidade', v)}
              keyboardType="decimal-pad"
              selectTextOnFocus
            />
          ) : (
            <Text style={styles.textoCorpo}>{linha.quantidade}</Text>
          )}
        </View>
        <View style={{ flex: 1.3 }}>
          <Text style={styles.campoLabel}>Preço (R$)</Text>
          {editavel ? (
            <TextInput
              style={[styles.input, abaixo && styles.inputAbaixo]}
              value={linha.preco}
              // Máscara de R$ (só dígitos, a vírgula anda sozinha) — numeroDigitado() já entende "1.234,56".
              onChangeText={(v) => onMudar('preco', mascararMoeda(v))}
              keyboardType="number-pad"
              selectTextOnFocus
            />
          ) : (
            <Text style={[styles.textoCorpo, abaixo && { color: cores.acentoTexto, fontWeight: '700' }]}>
              {formatarMoeda(preco)}
            </Text>
          )}
        </View>
        <View style={{ flex: 1.2, alignItems: 'flex-end' }}>
          <Text style={styles.campoLabel}>Subtotal</Text>
          <Text style={styles.itemSubtotal}>{formatarMoeda(subtotal)}</Text>
        </View>
      </View>
      {abaixo && (
        <View style={styles.itemAviso}>
          <MaterialCommunityIcons name="alert-outline" size={14} color={cores.acentoTexto} />
          <Text style={styles.itemAvisoTexto}>Abaixo do mínimo — vai precisar de autorização</Text>
        </View>
      )}
    </View>
  );
}

function Aviso({
  icone,
  cor,
  fundo,
  children,
}: {
  icone: keyof typeof MaterialCommunityIcons.glyphMap;
  cor: string;
  fundo: string;
  children: ReactNode;
}) {
  return (
    <View style={[styles.aviso, { backgroundColor: fundo }]}>
      <MaterialCommunityIcons name={icone} size={18} color={cor} />
      <Text style={[styles.avisoTexto, { color: cor }]}>{children}</Text>
    </View>
  );
}

// Pedido solto (aba Pedidos → "Novo pedido"): primeiro escolhe a loja, dentre as que o vendedor
// enxerga (o backend confere de novo).
function EscolherLoja({ onEscolher }: { onEscolher: (pv: { id: string; fantasia: string }) => void }) {
  const [busca, setBusca] = useState('');
  const buscaDebounced = useDebounce(busca, 300);
  const query = useQuery({
    queryKey: ['pontos-venda', 'busca-pedido-venda', buscaDebounced],
    queryFn: () => listarPontosVenda(buscaDebounced || undefined),
  });

  return (
    <View style={styles.container}>
      <View style={styles.conteudo}>
        <Text style={styles.secaoLabel}>Para qual loja é o pedido?</Text>
        <TextInput style={styles.input} placeholder="Buscar loja" value={busca} onChangeText={setBusca} autoFocus />
      </View>
      {query.isLoading ? (
        <ActivityIndicator style={{ marginTop: espaco.lg }} color={cores.primaria} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: espaco.lg }} keyboardShouldPersistTaps="handled">
          {(query.data?.pontos_venda ?? []).map((pv) => (
            <Pressable key={pv.id} style={styles.opcao} onPress={() => onEscolher({ id: pv.id, fantasia: pv.fantasia })}>
              <Text style={styles.itemDescricao}>{pv.fantasia}</Text>
              {!!pv.bairro && <Text style={styles.textoSecundario}>{pv.bairro}</Text>}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// Produto sem preço configurado aparece, mas bloqueado (decisão §10 pergunta 2) — o vendedor
// entende por que não consegue vender em vez de achar que o produto sumiu do catálogo.
function EscolherProdutoModal({
  visivel,
  onFechar,
  onEscolher,
}: {
  visivel: boolean;
  onFechar: () => void;
  onEscolher: (produto: ProdutoCatalogo) => void;
}) {
  const insets = useSafeAreaInsets();
  const [busca, setBusca] = useState('');
  const buscaDebounced = useDebounce(busca, 300);
  const query = useQuery({
    queryKey: ['produtos-catalogo', 'pedido-venda', buscaDebounced],
    queryFn: () => listarProdutosCatalogo({ busca: buscaDebounced }),
    enabled: visivel,
  });

  return (
    <Modal visible={visivel} animationType="slide" onRequestClose={onFechar}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.modalCabecalho}>
          <Text style={styles.modalTitulo}>Adicionar produto</Text>
          <Pressable onPress={onFechar} hitSlop={10}>
            <MaterialCommunityIcons name="close" size={24} color={cores.texto} />
          </Pressable>
        </View>
        <View style={{ paddingHorizontal: espaco.lg }}>
          <TextInput
            style={styles.input}
            placeholder="Nome, código de barras ou código"
            value={busca}
            onChangeText={setBusca}
            autoFocus
          />
        </View>
        {query.isLoading ? (
          <ActivityIndicator style={{ marginTop: espaco.lg }} color={cores.primaria} />
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: espaco.lg, paddingBottom: insets.bottom + espaco.lg }}
            keyboardShouldPersistTaps="handled"
          >
            {query.isError && <Text style={styles.textoSecundario}>{mensagemErroPedido(query.error, 'Erro ao buscar.')}</Text>}
            {(query.data?.produtos ?? []).map((p) => {
              const semPreco = p.preco_tabela === null || p.preco_tabela === undefined;
              return (
                <Pressable
                  key={p.id}
                  style={[styles.opcao, semPreco && styles.opcaoBloqueada]}
                  onPress={() => !semPreco && onEscolher(p)}
                  disabled={semPreco}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.itemDescricao, semPreco && { color: cores.textoTerciario }]}>{p.descricao}</Text>
                    <Text style={styles.textoSecundario}>{p.codigo_externo ?? p.codigo_barras ?? ''}</Text>
                  </View>
                  <Text style={semPreco ? styles.semPreco : styles.precoOpcao}>
                    {semPreco ? 'Sem preço configurado' : formatarMoeda(p.preco_tabela)}
                  </Text>
                </Pressable>
              );
            })}
            {query.isSuccess && (query.data?.produtos ?? []).length === 0 && (
              <Text style={styles.textoSecundario}>Nenhum produto encontrado.</Text>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.sm },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: espaco.xl, gap: espaco.md },
  cabecalho: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.sm },
  loja: { ...tipografia.subtitulo, color: cores.texto },
  chip: { borderRadius: raio.pill, paddingHorizontal: 10, paddingVertical: 4 },
  chipTexto: { ...tipografia.legenda },
  secaoLabel: { ...tipografia.rotulo, color: cores.textoSecundario, marginTop: espaco.md },
  textoSecundario: { ...tipografia.corpoSecundario, color: cores.textoSecundario },
  textoCorpo: { ...tipografia.corpo, color: cores.texto },
  aviso: { flexDirection: 'row', gap: espaco.sm, padding: espaco.md, borderRadius: raio.md, alignItems: 'flex-start' },
  avisoTexto: { ...tipografia.corpoSecundario, flex: 1 },
  input: {
    backgroundColor: cores.fundoCard,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.sm,
    paddingHorizontal: espaco.md,
    paddingVertical: 10,
    fontSize: 15,
    color: cores.texto,
  },
  inputMultilinha: { minHeight: 72, textAlignVertical: 'top' },
  inputAbaixo: { borderColor: cores.acento, backgroundColor: cores.acentoClaro },
  itemCard: {
    backgroundColor: cores.fundoCard,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.borda,
    padding: espaco.md,
    gap: espaco.sm,
    ...sombraCard,
  },
  itemCardAbaixo: { borderColor: cores.acentoBorda },
  itemTopo: { flexDirection: 'row', gap: espaco.sm },
  itemDescricao: { ...tipografia.destaque, color: cores.texto },
  itemCampos: { flexDirection: 'row', gap: espaco.sm, alignItems: 'flex-end' },
  campoLabel: { ...tipografia.legenda, color: cores.textoSecundario, marginBottom: 2 },
  itemSubtotal: { ...tipografia.destaque, color: cores.texto, paddingVertical: 10 },
  itemAviso: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  itemAvisoTexto: { ...tipografia.legenda, color: cores.acentoTexto },
  botaoAdicionar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: espaco.xs,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: cores.primariaBorda,
    borderRadius: raio.md,
    paddingVertical: espaco.md,
  },
  botaoAdicionarTexto: { ...tipografia.botao, color: cores.primaria },
  historicoItem: { borderLeftWidth: 2, borderLeftColor: cores.borda, paddingLeft: espaco.md, paddingVertical: 4 },
  historicoMotivo: { ...tipografia.corpoSecundario, color: cores.texto, marginTop: 2 },
  linkPerigo: { alignSelf: 'center', padding: espaco.md, marginTop: espaco.md },
  linkPerigoTexto: { ...tipografia.botao, color: cores.erroTexto },
  rodape: {
    backgroundColor: cores.fundoCard,
    borderTopWidth: 1,
    borderTopColor: cores.borda,
    paddingHorizontal: espaco.lg,
    paddingTop: espaco.md,
    gap: espaco.sm,
    ...sombraFlutuante,
  },
  rodapeTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  total: { ...tipografia.titulo, color: cores.texto },
  rodapeBotoes: { flexDirection: 'row', gap: espaco.sm },
  botaoPrimario: {
    backgroundColor: cores.primaria,
    borderRadius: raio.md,
    paddingVertical: 14,
    paddingHorizontal: espaco.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoAcento: { backgroundColor: cores.acentoEscuro },
  botaoSucesso: { backgroundColor: cores.sucesso },
  botaoPrimarioTexto: { ...tipografia.botao, color: cores.onPrimaria },
  botaoSecundario: {
    borderWidth: 1,
    borderColor: cores.primariaBorda,
    borderRadius: raio.md,
    paddingVertical: 14,
    paddingHorizontal: espaco.lg,
    alignItems: 'center',
  },
  botaoSecundarioTexto: { ...tipografia.botao, color: cores.primaria },
  botaoDesabilitado: { opacity: 0.5 },
  modalCabecalho: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: espaco.lg,
  },
  modalTitulo: { ...tipografia.titulo, color: cores.texto },
  opcao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm,
    backgroundColor: cores.fundoCard,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.borda,
    padding: espaco.md,
    marginBottom: espaco.sm,
  },
  opcaoBloqueada: { backgroundColor: cores.divisor },
  precoOpcao: { ...tipografia.destaque, color: cores.primaria },
  semPreco: { ...tipografia.legenda, color: cores.textoTerciario },
});
