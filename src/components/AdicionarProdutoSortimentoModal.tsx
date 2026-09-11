import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { buscarCodigoBarrasObrigatorio } from '../lib/api/parametros';
import { adicionarSortimentoProprio } from '../lib/api/sortimentoPontoVenda';
import { criarProdutoProprio, listarProdutosCatalogo } from '../lib/api/produtosAuditoria';
import { useDebounce } from '../lib/useDebounce';
import type { AutonomiaPromotor, ProdutoCatalogo } from '../types/api';

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
// existente no catálogo pra vincular ao sortimento deste PDV, ou (se a empresa permitir) cadastra
// um produto novo na hora. Ação online — não passa pela fila offline de envio, mesmo raciocínio
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
      setDescricaoNova('');
      setCodigoBarrasNovo('');
      setPropriedadeNova('PROPRIA');
      setErro(null);
    }
  }, [visible]);

  const buscaDebounced = useDebounce(busca, 300);
  const produtosQuery = useQuery({
    queryKey: ['produtos-catalogo', buscaDebounced],
    queryFn: () => listarProdutosCatalogo(buscaDebounced || undefined),
    enabled: visible && modo === 'BUSCAR',
  });
  const opcoes = (produtosQuery.data ?? []).filter((p) => !produtosJaVinculados.has(p.id));

  async function vincular(produtoUuid: string) {
    setEnviando(true);
    setErro(null);
    try {
      await adicionarSortimentoProprio(pontoVendaUuid, { tipo_item: 'PRODUTO', produto_uuid: produtoUuid });
      void queryClient.invalidateQueries({ queryKey: ['sortimento', pontoVendaUuid] });
      onAdicionado();
    } catch {
      setErro('Não foi possível vincular o produto agora. Tente novamente.');
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
              <TextInput
                style={styles.input}
                placeholder="Buscar produto no catálogo"
                value={busca}
                onChangeText={setBusca}
                autoFocus
              />
            </View>

            {produtosQuery.isLoading ? (
              <ActivityIndicator style={{ marginTop: 20 }} color="#2563eb" />
            ) : (
              <FlatList
                data={opcoes}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.lista}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <Pressable
                    style={({ pressed }) => [styles.itemProduto, pressed && styles.itemPressionado]}
                    onPress={() => void vincular(item.id)}
                    disabled={enviando}
                  >
                    <Text style={styles.itemProdutoNome}>{item.descricao}</Text>
                    <Text style={styles.itemProdutoDetalhe}>
                      {item.propriedade === 'CONCORRENTE' ? 'Concorrente' : 'Nosso'}
                    </Text>
                  </Pressable>
                )}
                ListEmptyComponent={
                  <Text style={styles.vazioTexto}>
                    {busca ? 'Nenhum produto encontrado.' : 'Digite pra buscar no catálogo.'}
                  </Text>
                }
              />
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
                <ActivityIndicator color="#ffffff" />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    gap: 8,
  },
  cabecalhoAcao: {
    color: '#2563eb',
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
    color: '#111827',
  },
  buscaBox: {
    padding: 16,
    paddingBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 48,
    fontSize: 15,
    backgroundColor: '#ffffff',
    color: '#111827',
  },
  lista: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 8,
    flexGrow: 1,
  },
  itemProduto: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 14,
    minHeight: 52,
  },
  itemPressionado: {
    backgroundColor: '#f3f4f6',
  },
  itemProdutoNome: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  itemProdutoDetalhe: {
    fontSize: 12,
    color: '#9ca3af',
  },
  vazioTexto: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 24,
  },
  rodapeLink: {
    padding: 16,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#ffffff',
  },
  link: {
    color: '#2563eb',
    fontSize: 14,
    fontWeight: '700',
  },
  rodape: {
    padding: 16,
    backgroundColor: '#ffffff',
  },
  formCadastro: {
    padding: 20,
    gap: 8,
  },
  secaoLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
    marginTop: 12,
  },
  chipsLinha: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    minHeight: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#d1d5db',
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelecionado: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  chipTexto: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  chipTextoSelecionado: {
    color: '#ffffff',
  },
  avisoTexto: {
    fontSize: 12,
    color: '#92400e',
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
  },
  erroTexto: {
    color: '#b91c1c',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
  },
  botaoPrimario: {
    minHeight: 52,
    borderRadius: 10,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  botaoPrimarioTexto: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});
