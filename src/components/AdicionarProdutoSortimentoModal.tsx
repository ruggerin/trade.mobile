import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { listarDepartamentos, listarMarcas, listarSecoes } from '../lib/api/catalogo';
import { buscarCodigoBarrasObrigatorio } from '../lib/api/parametros';
import { adicionarSortimentoProprio } from '../lib/api/sortimentoPontoVenda';
import { criarProdutoProprio, listarProdutosCatalogo } from '../lib/api/produtosAuditoria';
import { useDebounce } from '../lib/useDebounce';
import type { AutonomiaPromotor, CatalogoItem } from '../types/api';
import { cores, espaco, neutro, raio } from '../theme';

interface AdicionarProdutoSortimentoModalProps {
  visible: boolean;
  pontoVendaUuid: string;
  // Já vinculados a este PDV — some da lista de busca (não faz sentido vincular de novo).
  produtosJaVinculados: Set<string>;
  autonomiaCatalogo: AutonomiaPromotor;
  onClose: () => void;
  onAdicionado: () => void;
}

// docs/14-SORTIMENTO-PONTO-VENDA.md §8/§9 — "+ adicionar produto loja": busca um produto já
// existente no catálogo pra vincular ao mix deste PDV, ou (se a empresa permitir) cadastra
// um produto novo na hora. A busca bate em nome, código de barras ou código externo, aceita
// filtro por departamento/seção/marca e marca vários produtos antes de confirmar (docs/27). Ação online — não passa pela fila offline de envio, mesmo raciocínio
// de NovoCompromissoScreen.
export function AdicionarProdutoSortimentoModal({
  visible,
  pontoVendaUuid,
  produtosJaVinculados,
  autonomiaCatalogo,
  onClose,
  onAdicionado,
}: AdicionarProdutoSortimentoModalProps) {
  const queryClient = useQueryClient();
  const [modo, setModo] = useState<'BUSCAR' | 'CADASTRAR'>('BUSCAR');
  const [busca, setBusca] = useState('');
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [departamentoUuid, setDepartamentoUuid] = useState<string | null>(null);
  const [secaoUuid, setSecaoUuid] = useState<string | null>(null);
  const [marcaUuid, setMarcaUuid] = useState<string | null>(null);
  const [selecionados, setSelecionados] = useState<Map<string, string>>(new Map());
  const [descricaoNova, setDescricaoNova] = useState('');
  const [codigoBarrasNovo, setCodigoBarrasNovo] = useState('');
  const [propriedadeNova, setPropriedadeNova] = useState<'PROPRIA' | 'CONCORRENTE'>('PROPRIA');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Mesmo parâmetro do cadastro pelo admin web (CODIGO_BARRAS_OBRIGATORIO) — só pra marcar o
  // campo como obrigatório na hora; quem valida de verdade é sempre o backend.
  const codigoBarrasObrigatorioQuery = useQuery({
    queryKey: ['codigo-barras-obrigatorio'],
    queryFn: buscarCodigoBarrasObrigatorio,
    enabled: visible,
  });
  const codigoBarrasObrigatorio = codigoBarrasObrigatorioQuery.data ?? false;

  useEffect(() => {
    if (visible) {
      setModo('BUSCAR');
      setBusca('');
      setFiltrosAbertos(false);
      setDepartamentoUuid(null);
      setSecaoUuid(null);
      setMarcaUuid(null);
      setSelecionados(new Map());
      setDescricaoNova('');
      setCodigoBarrasNovo('');
      setPropriedadeNova('PROPRIA');
      setErro(null);
    }
  }, [visible]);

  const buscaDebounced = useDebounce(busca, 300);
  const produtosQuery = useInfiniteQuery({
    queryKey: ['produtos-catalogo', buscaDebounced, departamentoUuid, secaoUuid, marcaUuid],
    queryFn: ({ pageParam }) =>
      listarProdutosCatalogo({ busca: buscaDebounced, departamentoUuid, secaoUuid, marcaUuid }, pageParam),
    initialPageParam: 1,
    getNextPageParam: (ultima) => (ultima.paginaAtual < ultima.ultimaPagina ? ultima.paginaAtual + 1 : undefined),
    enabled: visible && modo === 'BUSCAR',
  });
  const opcoes = (produtosQuery.data?.pages.flatMap((pagina) => pagina.produtos) ?? []).filter(
    (p) => !produtosJaVinculados.has(p.id),
  );

  const departamentosQuery = useQuery({
    queryKey: ['departamentos-auditoria'],
    queryFn: listarDepartamentos,
    enabled: visible && filtrosAbertos,
  });
  const secoesQuery = useQuery({ queryKey: ['secoes-auditoria'], queryFn: listarSecoes, enabled: visible && filtrosAbertos });
  const marcasQuery = useQuery({ queryKey: ['marcas-auditoria'], queryFn: listarMarcas, enabled: visible && filtrosAbertos });
  const filtrosAtivos = [departamentoUuid, secaoUuid, marcaUuid].filter(Boolean).length;

  function alternarSelecao(id: string, descricao: string) {
    setSelecionados((atual) => {
      const novo = new Map(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.set(id, descricao);
      return novo;
    });
  }

  // Um POST por produto marcado, em paralelo — mesmo raciocínio do admin (docs/27 §3.4). Quem
  // falhou continua marcado pra tentar de novo; quem entrou sai da seleção.
  async function vincularSelecionados() {
    setEnviando(true);
    setErro(null);
    const ids = Array.from(selecionados.keys());
    try {
      const resultados = await Promise.allSettled(
        ids.map((id) => adicionarSortimentoProprio(pontoVendaUuid, { tipo_item: 'PRODUTO', produto_uuid: id })),
      );
      const falhou = new Set(ids.filter((_, i) => resultados[i].status === 'rejected'));
      void queryClient.invalidateQueries({ queryKey: ['sortimento', pontoVendaUuid] });
      if (falhou.size === 0) {
        onAdicionado();
        return;
      }
      setSelecionados((atual) => new Map(Array.from(atual).filter(([id]) => falhou.has(id))));
      setErro(`${falhou.size} de ${ids.length} produto(s) não puderam ser vinculados. Tente novamente.`);
    } finally {
      setEnviando(false);
    }
  }

  async function cadastrarECincular() {
    if (!descricaoNova.trim()) {
      setErro('Digite o nome do produto.');
      return;
    }
    if (codigoBarrasObrigatorio && !codigoBarrasNovo.trim()) {
      setErro('Digite o código de barras.');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const produto = await criarProdutoProprio({
        descricao: descricaoNova.trim(),
        codigo_barras: codigoBarrasNovo.trim() || undefined,
        propriedade: propriedadeNova,
      });
      await adicionarSortimentoProprio(pontoVendaUuid, { tipo_item: 'PRODUTO', produto_uuid: produto.id });
      void queryClient.invalidateQueries({ queryKey: ['sortimento', pontoVendaUuid] });
      onAdicionado();
    } catch {
      setErro('Não foi possível cadastrar o produto agora. Tente novamente.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.cabecalho}>
          {modo === 'CADASTRAR' ? (
            <Pressable onPress={() => setModo('BUSCAR')} hitSlop={12}>
              <Text style={styles.cabecalhoAcao}>‹ Voltar</Text>
            </Pressable>
          ) : (
            <View style={styles.cabecalhoAcaoEspaco} />
          )}
          <Text style={styles.cabecalhoTitulo}>
            {modo === 'CADASTRAR' ? 'Cadastrar produto novo' : 'Adicionar produto da loja'}
          </Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.cabecalhoAcao}>Fechar</Text>
          </Pressable>
        </View>

        {modo === 'BUSCAR' ? (
          <>
            <View style={styles.buscaBox}>
              <View style={styles.buscaLinha}>
                <TextInput
                  style={[styles.input, styles.buscaInput]}
                  placeholder="Nome, código de barras ou código"
                  value={busca}
                  onChangeText={setBusca}
                  autoFocus
                />
                <Pressable
                  style={[styles.botaoFiltro, (filtrosAbertos || filtrosAtivos > 0) && styles.botaoFiltroAtivo]}
                  onPress={() => setFiltrosAbertos((aberto) => !aberto)}
                  hitSlop={6}
                >
                  <Text style={[styles.botaoFiltroTexto, (filtrosAbertos || filtrosAtivos > 0) && styles.chipTextoSelecionado]}>
                    Filtros{filtrosAtivos > 0 ? ` (${filtrosAtivos})` : ''}
                  </Text>
                </Pressable>
              </View>
              {filtrosAbertos && (
                <View style={styles.filtros}>
                  <FiltroChips titulo="Departamento" itens={departamentosQuery.data} selecionado={departamentoUuid} onChange={setDepartamentoUuid} />
                  <FiltroChips titulo="Seção" itens={secoesQuery.data} selecionado={secaoUuid} onChange={setSecaoUuid} />
                  <FiltroChips titulo="Marca" itens={marcasQuery.data} selecionado={marcaUuid} onChange={setMarcaUuid} />
                </View>
              )}
            </View>

            {produtosQuery.isLoading ? (
              <ActivityIndicator style={{ marginTop: 20 }} color={cores.primaria} />
            ) : (
              <FlatList
                data={opcoes}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.lista}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <Pressable
                    style={({ pressed }) => [styles.itemProduto, pressed && styles.itemPressionado]}
                    onPress={() => alternarSelecao(item.id, item.descricao)}
                    disabled={enviando}
                  >
                    <View style={[styles.caixa, selecionados.has(item.id) && styles.caixaMarcada]}>
                      {selecionados.has(item.id) && <Text style={styles.caixaTick}>✓</Text>}
                    </View>
                    <View style={styles.itemProdutoCorpo}>
                      <Text style={styles.itemProdutoNome}>{item.descricao}</Text>
                      {(item.marca || item.codigo_barras) && (
                        <Text style={styles.itemProdutoDetalhe}>
                          {[item.marca?.descricao, item.codigo_barras].filter(Boolean).join(' · ')}
                        </Text>
                      )}
                    </View>
                    <Text style={styles.itemProdutoDetalhe}>
                      {item.propriedade === 'CONCORRENTE' ? 'Concorrente' : 'Nosso'}
                    </Text>
                  </Pressable>
                )}
                onEndReached={() => {
                  if (produtosQuery.hasNextPage && !produtosQuery.isFetchingNextPage) void produtosQuery.fetchNextPage();
                }}
                onEndReachedThreshold={0.4}
                ListFooterComponent={
                  produtosQuery.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: 12 }} color={cores.primaria} /> : null
                }
                ListEmptyComponent={
                  <Text style={styles.vazioTexto}>
                    {busca || filtrosAtivos > 0 ? 'Nenhum produto encontrado.' : 'Nenhum produto no catálogo.'}
                  </Text>
                }
              />
            )}

            {selecionados.size > 0 && (
              <View style={styles.rodape}>
                <Pressable
                  style={({ pressed }) => [styles.botaoPrimario, styles.botaoRodape, pressed && styles.itemPressionado]}
                  onPress={() => void vincularSelecionados()}
                  disabled={enviando}
                >
                  {enviando ? (
                    <ActivityIndicator color={cores.onPrimaria} />
                  ) : (
                    <Text style={styles.botaoPrimarioTexto}>Adicionar ao mix ({selecionados.size})</Text>
                  )}
                </Pressable>
              </View>
            )}

            {autonomiaCatalogo !== 'DESABILITADO' && (
              <View style={styles.rodapeLink}>
                <Pressable onPress={() => setModo('CADASTRAR')}>
                  <Text style={styles.link}>Não encontrei — cadastrar produto novo</Text>
                </Pressable>
              </View>
            )}

            {erro && (
              <View style={styles.rodape}>
                <Text style={styles.erroTexto}>{erro}</Text>
              </View>
            )}
          </>
        ) : (
          <View style={styles.formCadastro}>
            <Text style={styles.secaoLabel}>Nome do produto</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex.: Farinha de Trigo 1kg"
              value={descricaoNova}
              onChangeText={setDescricaoNova}
              autoFocus
            />

            <Text style={styles.secaoLabel}>
              Código de barras{codigoBarrasObrigatorio ? ' *' : ' (opcional)'}
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Ex.: 7891000100103"
              value={codigoBarrasNovo}
              onChangeText={setCodigoBarrasNovo}
              keyboardType="numeric"
            />

            <Text style={styles.secaoLabel}>Propriedade</Text>
            <View style={styles.chipsLinha}>
              {(['PROPRIA', 'CONCORRENTE'] as const).map((p) => (
                <Pressable
                  key={p}
                  style={[styles.chip, propriedadeNova === p && styles.chipSelecionado]}
                  onPress={() => setPropriedadeNova(p)}
                >
                  <Text style={[styles.chipTexto, propriedadeNova === p && styles.chipTextoSelecionado]}>
                    {p === 'PROPRIA' ? 'Nosso' : 'Concorrente'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {autonomiaCatalogo === 'REQUER_APROVACAO' && (
              <Text style={styles.avisoTexto}>
                Sua empresa exige aprovação do gestor pra produtos novos — ele já fica disponível
                pra você registrar agora, mas só aparece oficialmente no catálogo depois de
                aprovado.
              </Text>
            )}

            {erro && <Text style={styles.erroTexto}>{erro}</Text>}

            <Pressable
              style={({ pressed }) => [styles.botaoPrimario, pressed && styles.itemPressionado]}
              onPress={() => void cadastrarECincular()}
              disabled={enviando}
            >
              {enviando ? (
                <ActivityIndicator color={cores.onPrimaria} />
              ) : (
                <Text style={styles.botaoPrimarioTexto}>Cadastrar e vincular</Text>
              )}
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

// Linha de chips rolável, seleção única com toque de novo pra limpar — filtro de catálogo
// (departamento/seção/marca) sem ocupar a tela toda.
function FiltroChips({
  titulo,
  itens,
  selecionado,
  onChange,
}: {
  titulo: string;
  itens: CatalogoItem[] | undefined;
  selecionado: string | null;
  onChange: (uuid: string | null) => void;
}) {
  if (itens && itens.length === 0) return null;
  return (
    <View>
      <Text style={styles.filtroTitulo}>{titulo}</Text>
      {!itens ? (
        <ActivityIndicator color={cores.primaria} />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtroChips} keyboardShouldPersistTaps="handled">
          {itens.map((item) => {
            const ativo = item.id === selecionado;
            return (
              <Pressable
                key={item.id}
                style={[styles.chip, ativo && styles.chipSelecionado]}
                onPress={() => onChange(ativo ? null : item.id)}
              >
                <Text style={[styles.chipTexto, ativo && styles.chipTextoSelecionado]}>{item.descricao}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: cores.fundo,
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: cores.fundoCard,
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.md,
    borderBottomWidth: 1,
    borderBottomColor: cores.divisor,
    gap: espaco.sm,
  },
  cabecalhoAcao: {
    color: cores.primaria,
    fontSize: 15,
    fontWeight: '600',
  },
  cabecalhoAcaoEspaco: {
    width: 60,
  },
  cabecalhoTitulo: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: cores.texto,
  },
  buscaBox: {
    padding: espaco.lg,
    paddingBottom: espaco.sm,
    gap: espaco.sm,
  },
  buscaLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm,
  },
  buscaInput: {
    flex: 1,
  },
  botaoFiltro: {
    minHeight: 48,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.borda,
    backgroundColor: cores.fundoCard,
    paddingHorizontal: espaco.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoFiltroAtivo: {
    backgroundColor: cores.primaria,
    borderColor: cores.primaria,
  },
  botaoFiltroTexto: {
    fontSize: 14,
    fontWeight: '700',
    color: neutro[700],
  },
  filtros: {
    gap: espaco.sm,
  },
  filtroTitulo: {
    fontSize: 12,
    fontWeight: '700',
    color: neutro[700],
    marginBottom: 4,
  },
  filtroChips: {
    gap: espaco.sm,
    paddingRight: espaco.lg,
  },
  caixa: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: cores.borda,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: espaco.md,
  },
  caixaMarcada: {
    backgroundColor: cores.primaria,
    borderColor: cores.primaria,
  },
  caixaTick: {
    color: cores.branco,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 16,
  },
  itemProdutoCorpo: {
    flex: 1,
    paddingVertical: espaco.sm,
  },
  botaoRodape: {
    marginTop: 0,
  },
  input: {
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.md,
    paddingHorizontal: espaco.md,
    minHeight: 48,
    fontSize: 15,
    backgroundColor: cores.fundoCard,
    color: cores.texto,
  },
  lista: {
    paddingHorizontal: espaco.lg,
    paddingBottom: espaco.lg,
    gap: espaco.sm,
    flexGrow: 1,
  },
  itemProduto: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: cores.fundoCard,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.borda,
    paddingHorizontal: espaco.md,
    minHeight: 52,
  },
  itemPressionado: {
    backgroundColor: neutro[100],
  },
  itemProdutoNome: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: cores.texto,
  },
  itemProdutoDetalhe: {
    fontSize: 12,
    color: cores.textoTerciario,
  },
  vazioTexto: {
    fontSize: 14,
    color: cores.textoTerciario,
    textAlign: 'center',
    marginTop: espaco.xl,
  },
  rodapeLink: {
    padding: espaco.lg,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: cores.divisor,
    backgroundColor: cores.fundoCard,
  },
  link: {
    color: cores.primaria,
    fontSize: 14,
    fontWeight: '700',
  },
  rodape: {
    padding: espaco.lg,
    backgroundColor: cores.fundoCard,
  },
  formCadastro: {
    padding: espaco.xl,
    gap: espaco.sm,
  },
  secaoLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: neutro[700],
    marginTop: espaco.md,
  },
  chipsLinha: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: espaco.sm,
  },
  chip: {
    minHeight: 40,
    borderRadius: raio.pill,
    borderWidth: 1,
    borderColor: cores.borda,
    paddingHorizontal: espaco.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelecionado: {
    backgroundColor: cores.primaria,
    borderColor: cores.primaria,
  },
  chipTexto: {
    fontSize: 14,
    fontWeight: '600',
    color: neutro[700],
  },
  chipTextoSelecionado: {
    color: cores.branco,
  },
  avisoTexto: {
    fontSize: 12,
    color: cores.acentoTexto,
    backgroundColor: cores.acentoClaro,
    borderWidth: 1,
    borderColor: cores.acentoBorda,
    borderRadius: raio.md,
    padding: espaco.sm + 2,
    marginTop: espaco.sm,
  },
  erroTexto: {
    color: cores.erro,
    fontSize: 13,
    textAlign: 'center',
    marginTop: espaco.sm,
  },
  botaoPrimario: {
    minHeight: 52,
    borderRadius: raio.md,
    backgroundColor: cores.primaria,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: espaco.lg,
  },
  botaoPrimarioTexto: {
    color: cores.branco,
    fontSize: 15,
    fontWeight: '700',
  },
});
