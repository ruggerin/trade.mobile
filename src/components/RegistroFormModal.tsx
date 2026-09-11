import { useQuery } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { listarDepartamentos, listarMarcas, listarSecoes } from '../lib/api/catalogo';
import { apagarImagemPersistente, copiarImagemParaArmazenamentoPersistente } from '../lib/db/filaRegistros';
import type { CampoTipoRegistro, CatalogoItem, MomentoRegistro, ProdutoDisponivel, TipoRegistro, TipoVinculoRegistro } from '../types/api';

export interface RegistroFormResultado {
  tipoRegistroUuid: string;
  // Já é um caminho persistente (copiado do picker pra pasta do app na hora da captura, ver
  // capturarFoto abaixo) — nunca a uri transitória do image picker.
  imagemUri?: string;
  produtoAuditoriaUuid?: string;
  tipoVinculo?: TipoVinculoRegistro;
  secaoUuid?: string;
  departamentoUuid?: string;
  marcaUuid?: string;
  // Nome legível do que foi escolhido em "Vincular a" (seção/departamento/marca) — o servidor
  // resolve isso sozinho na resposta quando o registro é enviado, mas pra exibir um registro
  // ainda na fila local (offline, ver lib/visitaLocal.ts) precisa vir daqui, já que só o uuid
  // não dá pra mostrar pro promotor.
  vinculoLabel?: string;
  valoresCampos?: Record<string, string>;
  ruptura?: boolean;
  momento?: MomentoRegistro;
}

interface RegistroFormModalProps {
  visible: boolean;
  tiposRegistro: TipoRegistro[];
  produtosDisponiveis: ProdutoDisponivel[];
  // Quando vem de "tirar foto"/"marcar ruptura" num produto específico da campanha — nesse
  // caso o vínculo de catálogo e a marcação antes/depois não fazem sentido (produto já é o
  // contexto, ver StoreVisitaRegistroRequest: `momento` é proibido junto de produto_auditoria_uuid).
  produtoContexto?: { uuid: string; descricao: string } | null;
  // Quando vem de uma Ação (aba Ações da visita, ver TipoRegistro.acao_obrigatoria) — pula a
  // etapa de escolher o tipo, o formulário já abre direto nele.
  tipoFixo?: TipoRegistro | null;
  enviando: boolean;
  erro: string | null;
  onClose: () => void;
  onSubmit: (payload: RegistroFormResultado) => void;
}

type Categoria = Extract<TipoVinculoRegistro, 'PRODUTO' | 'SECAO' | 'DEPARTAMENTO' | 'MARCA'>;

const CATEGORIAS: { valor: Categoria; label: string }[] = [
  { valor: 'PRODUTO', label: 'Produto' },
  { valor: 'SECAO', label: 'Seção' },
  { valor: 'DEPARTAMENTO', label: 'Departamento' },
  { valor: 'MARCA', label: 'Marca' },
];

// docs/05-APP-MOBILE-UX.md §"Formulário de registro (dinâmico por tipo)" — substitui o antigo
// diálogo fixo antes/depois/sem marcação: primeiro escolhe o tipo de registro (customizável
// pela empresa), depois preenche um formulário montado a partir dos `campos` daquele tipo.
export function RegistroFormModal({
  visible,
  tiposRegistro,
  produtosDisponiveis,
  produtoContexto,
  tipoFixo,
  enviando,
  erro,
  onClose,
  onSubmit,
}: RegistroFormModalProps) {
  const [tipo, setTipo] = useState<TipoRegistro | null>(null);
  const [valoresCampos, setValoresCampos] = useState<Record<string, string>>({});
  const [imagemUri, setImagemUri] = useState<string | null>(null);
  const [ruptura, setRuptura] = useState(false);
  const [momento, setMomento] = useState<MomentoRegistro | null>(null);
  const [vinculo, setVinculo] = useState<{ categoria: Categoria; uuid: string; label: string } | null>(null);
  const [categoriaAberta, setCategoriaAberta] = useState<Categoria | null>(null);
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  // Acompanha o valor mais recente de imagemUri e se o registro chegou a ser de fato submetido
  // — usados só pelo efeito de limpeza abaixo (não dá pra ler estado direto de dentro dele sem
  // recriar o efeito a cada tecla).
  const imagemUriRef = useRef<string | null>(null);
  const submetidoRef = useRef(false);

  useEffect(() => {
    imagemUriRef.current = imagemUri;
  }, [imagemUri]);

  // Reseta tudo sempre que o modal reabre — nunca deixa resíduo de um registro anterior.
  useEffect(() => {
    if (visible) {
      submetidoRef.current = false;
      setTipo(tipoFixo ?? null);
      setValoresCampos({});
      setImagemUri(null);
      setRuptura(false);
      setMomento(null);
      setVinculo(null);
      setCategoriaAberta(null);
      setErroLocal(null);
    } else if (!submetidoRef.current && imagemUriRef.current) {
      // Modal fechado sem confirmar (botão Fechar, back do Android, ou o pai desmontou por
      // outro motivo) com uma foto já copiada pro armazenamento persistente (ver capturarFoto) —
      // sem essa limpeza, o arquivo ficava no disco pra sempre, sem nenhum registro apontando
      // pra ele.
      void apagarImagemPersistente(imagemUriRef.current);
    }
  }, [visible, tipoFixo]);

  const secoesQuery = useQuery({
    queryKey: ['secoes-auditoria'],
    queryFn: listarSecoes,
    enabled: categoriaAberta === 'SECAO',
  });
  const departamentosQuery = useQuery({
    queryKey: ['departamentos-auditoria'],
    queryFn: listarDepartamentos,
    enabled: categoriaAberta === 'DEPARTAMENTO',
  });
  const marcasQuery = useQuery({
    queryKey: ['marcas-auditoria'],
    queryFn: listarMarcas,
    enabled: categoriaAberta === 'MARCA',
  });

  const camposOrdenados = useMemo(
    () => (tipo ? [...tipo.campos].sort((a, b) => a.ordem - b.ordem) : []),
    [tipo],
  );

  function definirValorCampo(chave: string, valor: string) {
    setValoresCampos((atual) => ({ ...atual, [chave]: valor }));
  }

  async function capturarFoto(origem: 'camera' | 'galeria') {
    const permissao =
      origem === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (permissao.status !== 'granted') {
      Alert.alert(
        'Permissão necessária',
        origem === 'camera'
          ? 'Ative a permissão de câmera nas configurações do sistema pra tirar fotos.'
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
        ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.7 });

    if (resultado.canceled) return;
    const asset = resultado.assets[0];
    if (!asset) return;

    try {
      // Copia pro armazenamento persistente JÁ na captura, não só quando o registro é salvo —
      // a uri que o picker devolve vive no cache do SO, que pode ser limpo a qualquer momento
      // enquanto o promotor ainda preenche o resto do formulário (campos, vínculo, etc.). Sem
      // isso, um formulário longo (ou o app indo pro background no meio) podia perder a foto e o
      // registro inteiro junto na hora de salvar.
      const caminhoPersistente = await copiarImagemParaArmazenamentoPersistente(asset.uri);
      setImagemUri(caminhoPersistente);
    } catch {
      setErroLocal('Não foi possível salvar a foto. Tente novamente.');
    }
  }

  function removerFoto() {
    if (imagemUri) {
      void apagarImagemPersistente(imagemUri);
    }
    setImagemUri(null);
  }

  function escolherOrigemFoto() {
    Alert.alert('Foto do registro', 'Como você quer registrar?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Tirar foto', onPress: () => void capturarFoto('camera') },
      { text: 'Escolher da galeria', onPress: () => void capturarFoto('galeria') },
    ]);
  }

  // Ver App\Support\GranularidadeChecklist no backend e
  // docs/16-GRANULARIDADE-CHECKLIST-AUDITORIA.md §4 — quando a pergunta exige resposta por
  // produto individual, só o vínculo a Produto faz sentido (Seção/Departamento/Marca inteira
  // seria uma resposta agregada, o que essa pergunta não aceita). produtoContexto já satisfaz
  // isso sozinho (já é um produto específico). O backend é a autoridade final — isto aqui só
  // evita o promotor escolher um caminho que já sabe que vai ser rejeitado; exceções por seção
  // (ver TipoRegistro.excecoes_granularidade) só são checadas no servidor.
  const exigeProduto = !produtoContexto && tipo?.granularidade_padrao === 'PRODUTO';
  const categoriasDisponiveis = exigeProduto ? CATEGORIAS.filter((c) => c.valor === 'PRODUTO') : CATEGORIAS;

  function validar(): string | null {
    if (!tipo) return 'Escolha um tipo de registro.';
    if (tipo.exige_foto && !imagemUri) return `O tipo "${tipo.descricao}" exige uma foto.`;
    if (exigeProduto && vinculo?.categoria !== 'PRODUTO') {
      return `O tipo "${tipo.descricao}" exige vincular um produto específico.`;
    }
    for (const campo of camposOrdenados) {
      const valor = valoresCampos[campo.chave];
      if (campo.obrigatorio && (!valor || valor.trim() === '')) {
        return `O campo "${campo.rotulo}" é obrigatório.`;
      }
    }
    return null;
  }

  function confirmar() {
    const mensagemErro = validar();
    if (mensagemErro) {
      setErroLocal(mensagemErro);
      return;
    }
    setErroLocal(null);
    if (!tipo) return;

    // NUMERO/MOEDA vêm de teclado decimal — normaliza vírgula pra ponto antes de enviar
    // (a API valida com is_numeric, que não aceita "1,5").
    const valoresNormalizados: Record<string, string> = {};
    for (const campo of camposOrdenados) {
      const valor = valoresCampos[campo.chave];
      if (valor === undefined || valor === '') continue;
      valoresNormalizados[campo.chave] =
        campo.tipo_campo === 'NUMERO' || campo.tipo_campo === 'MOEDA' ? valor.replace(',', '.') : valor;
    }

    // Marca como submetido ANTES de chamar onSubmit — o efeito de limpeza (ver acima) só deve
    // apagar a foto se o modal fechar SEM essa marcação (abandono), nunca depois de um envio de
    // verdade, mesmo que o mutation ainda esteja pendente quando o modal for fechado.
    submetidoRef.current = true;

    onSubmit({
      tipoRegistroUuid: tipo.id,
      imagemUri: imagemUri ?? undefined,
      produtoAuditoriaUuid: produtoContexto?.uuid ?? (vinculo?.categoria === 'PRODUTO' ? vinculo.uuid : undefined),
      tipoVinculo: !produtoContexto && vinculo ? vinculo.categoria : undefined,
      secaoUuid: vinculo?.categoria === 'SECAO' ? vinculo.uuid : undefined,
      departamentoUuid: vinculo?.categoria === 'DEPARTAMENTO' ? vinculo.uuid : undefined,
      marcaUuid: vinculo?.categoria === 'MARCA' ? vinculo.uuid : undefined,
      vinculoLabel: !produtoContexto && vinculo && vinculo.categoria !== 'PRODUTO' ? vinculo.label : undefined,
      valoresCampos: Object.keys(valoresNormalizados).length > 0 ? valoresNormalizados : undefined,
      ruptura: ruptura || undefined,
      // Livre mesmo com produto vinculado (por produtoContexto ou por "Vincular a > Produto")
      // — o mesmo produto pode ter mais de um registro na visita (antes, depois, um outro tipo),
      // cada um com seu próprio momento opcional. Ver StoreVisitaRegistroRequest.
      momento: momento ?? undefined,
    });
  }

  function itensDaCategoria(categoria: Categoria): { uuid: string; label: string }[] {
    if (categoria === 'PRODUTO') {
      return produtosDisponiveis.map((p) => ({ uuid: p.produto_uuid, label: p.descricao }));
    }
    if (categoria === 'SECAO') return (secoesQuery.data ?? []).map(mapCatalogoItem);
    if (categoria === 'DEPARTAMENTO') return (departamentosQuery.data ?? []).map(mapCatalogoItem);
    return (marcasQuery.data ?? []).map(mapCatalogoItem);
  }

  const carregandoCategoria =
    (categoriaAberta === 'SECAO' && secoesQuery.isLoading) ||
    (categoriaAberta === 'DEPARTAMENTO' && departamentosQuery.isLoading) ||
    (categoriaAberta === 'MARCA' && marcasQuery.isLoading);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.cabecalho}>
          {tipo && !tipoFixo ? (
            <Pressable onPress={() => setTipo(null)} hitSlop={12}>
              <Text style={styles.cabecalhoAcao}>‹ Voltar</Text>
            </Pressable>
          ) : (
            <View style={styles.cabecalhoAcaoEspaco} />
          )}
          <Text style={styles.cabecalhoTitulo} numberOfLines={1}>
            {tipo ? tipo.descricao : 'Tipo de registro'}
          </Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.cabecalhoAcao}>Fechar</Text>
          </Pressable>
        </View>

        {!tipo && (
          <ScrollView contentContainerStyle={styles.lista}>
            {produtoContexto && <Text style={styles.contextoTexto}>Registro para: {produtoContexto.descricao}</Text>}
            {tiposRegistro.length === 0 && (
              <Text style={styles.vazioTexto}>Nenhum tipo de registro disponível.</Text>
            )}
            {tiposRegistro.map((t) => (
              <Pressable
                key={t.id}
                style={({ pressed }) => [styles.tipoCard, pressed && styles.itemPressionado]}
                onPress={() => setTipo(t)}
              >
                <Text style={styles.tipoNome}>{t.descricao}</Text>
                {t.exige_foto && <Text style={styles.tipoDetalhe}>Exige foto</Text>}
              </Pressable>
            ))}
          </ScrollView>
        )}

        {tipo && (
          <>
            <ScrollView contentContainerStyle={styles.lista}>
              {produtoContexto && <Text style={styles.contextoTexto}>Registro para: {produtoContexto.descricao}</Text>}

              <View style={styles.secaoForm}>
                <Text style={styles.secaoLabel}>Foto {tipo.exige_foto ? '(obrigatória)' : '(opcional)'}</Text>
                {imagemUri ? (
                  <View style={styles.fotoPreviewBox}>
                    <Image source={{ uri: imagemUri }} style={styles.fotoPreview} />
                    <Pressable onPress={removerFoto}>
                      <Text style={styles.linkRemover}>Remover foto</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    style={({ pressed }) => [styles.botaoSecundario, pressed && styles.itemPressionado]}
                    onPress={escolherOrigemFoto}
                  >
                    <Text style={styles.botaoSecundarioTexto}>Adicionar foto</Text>
                  </Pressable>
                )}
              </View>

              {camposOrdenados.map((campo) => (
                <CampoInput
                  key={campo.id}
                  campo={campo}
                  valor={valoresCampos[campo.chave] ?? ''}
                  onChange={(valor) => definirValorCampo(campo.chave, valor)}
                />
              ))}

              <View style={styles.secaoForm}>
                <Pressable style={styles.checkboxLinha} onPress={() => setRuptura((r) => !r)}>
                  <View style={[styles.checkbox, ruptura && styles.checkboxMarcado]}>
                    {ruptura && <Text style={styles.checkboxMarca}>✓</Text>}
                  </View>
                  <Text style={styles.secaoLabel}>Marcar como ruptura</Text>
                </Pressable>
              </View>

              {!produtoContexto && (tipo.permite_vincular_catalogo || exigeProduto) && (
                <View style={styles.secaoForm}>
                  <Text style={styles.secaoLabel}>Vincular a {exigeProduto ? '(obrigatório)' : '(opcional)'}</Text>
                  <View style={styles.chipsLinha}>
                    {categoriasDisponiveis.map((c) => (
                      <Pressable
                        key={c.valor}
                        style={[styles.chip, categoriaAberta === c.valor && styles.chipSelecionado]}
                        onPress={() => setCategoriaAberta(categoriaAberta === c.valor ? null : c.valor)}
                      >
                        <Text style={[styles.chipTexto, categoriaAberta === c.valor && styles.chipTextoSelecionado]}>
                          {c.label}
                        </Text>
                      </Pressable>
                    ))}
                    {vinculo && (
                      <Pressable style={styles.chipRemover} onPress={() => setVinculo(null)}>
                        <Text style={styles.chipRemoverTexto}>Limpar ✕</Text>
                      </Pressable>
                    )}
                  </View>

                  {vinculo && !categoriaAberta && (
                    <Text style={styles.vinculoSelecionado}>Selecionado: {vinculo.label}</Text>
                  )}

                  {categoriaAberta && (
                    <View style={styles.subListaBox}>
                      {carregandoCategoria && <ActivityIndicator color="#2563eb" style={{ padding: 12 }} />}
                      <ScrollView style={styles.subLista} nestedScrollEnabled>
                        {itensDaCategoria(categoriaAberta).map((item) => (
                          <Pressable
                            key={item.uuid}
                            style={({ pressed }) => [styles.subListaItem, pressed && styles.itemPressionado]}
                            onPress={() => {
                              setVinculo({ categoria: categoriaAberta, uuid: item.uuid, label: item.label });
                              setCategoriaAberta(null);
                            }}
                          >
                            <Text style={styles.subListaItemTexto}>{item.label}</Text>
                          </Pressable>
                        ))}
                        {!carregandoCategoria && itensDaCategoria(categoriaAberta).length === 0 && (
                          <Text style={styles.vazioTexto}>Nada cadastrado.</Text>
                        )}
                      </ScrollView>
                    </View>
                  )}
                </View>
              )}

              <View style={styles.secaoForm}>
                <Text style={styles.secaoLabel}>Marcação (opcional)</Text>
                <View style={styles.chipsLinha}>
                  {(['ANTES', 'DEPOIS'] as MomentoRegistro[]).map((m) => (
                    <Pressable
                      key={m}
                      style={[styles.chip, momento === m && styles.chipSelecionado]}
                      onPress={() => setMomento(momento === m ? null : m)}
                    >
                      <Text style={[styles.chipTexto, momento === m && styles.chipTextoSelecionado]}>
                        {m === 'ANTES' ? 'Antes' : 'Depois'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </ScrollView>

            <View style={styles.rodape}>
              {(erroLocal ?? erro) && <Text style={styles.erroTexto}>{erroLocal ?? erro}</Text>}
              <Pressable
                style={({ pressed }) => [styles.botaoPrimario, pressed && styles.itemPressionado]}
                onPress={confirmar}
                disabled={enviando}
              >
                {enviando ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.botaoPrimarioTexto}>Salvar registro</Text>
                )}
              </Pressable>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

function CampoInput({
  campo,
  valor,
  onChange,
}: {
  campo: CampoTipoRegistro;
  valor: string;
  onChange: (valor: string) => void;
}) {
  return (
    <View style={styles.secaoForm}>
      <Text style={styles.secaoLabel}>
        {campo.rotulo}
        {campo.obrigatorio ? ' *' : ''}
        {campo.tipo_campo === 'MOEDA' ? ' (R$)' : ''}
      </Text>

      {campo.tipo_campo === 'MULTIPLA_ESCOLHA' ? (
        <View style={styles.chipsLinha}>
          {(campo.opcoes ?? []).map((opcao) => (
            <Pressable
              key={opcao}
              style={[styles.chip, valor === opcao && styles.chipSelecionado]}
              onPress={() => onChange(valor === opcao ? '' : opcao)}
            >
              <Text style={[styles.chipTexto, valor === opcao && styles.chipTextoSelecionado]}>{opcao}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <TextInput
          style={styles.input}
          value={valor}
          onChangeText={onChange}
          keyboardType={campo.tipo_campo === 'NUMERO' || campo.tipo_campo === 'MOEDA' ? 'decimal-pad' : 'default'}
          placeholder={campo.tipo_campo === 'MOEDA' ? '0,00' : undefined}
        />
      )}
    </View>
  );
}

function mapCatalogoItem(item: CatalogoItem): { uuid: string; label: string } {
  return { uuid: item.id, label: item.descricao };
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
  lista: {
    padding: 16,
    gap: 12,
  },
  contextoTexto: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 4,
  },
  vazioTexto: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    padding: 12,
  },
  tipoCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    minHeight: 48,
    justifyContent: 'center',
  },
  itemPressionado: {
    backgroundColor: '#f3f4f6',
  },
  tipoNome: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  tipoDetalhe: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  secaoForm: {
    gap: 8,
  },
  secaoLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 48,
    fontSize: 15,
    backgroundColor: '#ffffff',
  },
  fotoPreviewBox: {
    gap: 8,
  },
  fotoPreview: {
    width: 120,
    height: 120,
    borderRadius: 10,
  },
  linkRemover: {
    color: '#b91c1c',
    fontSize: 13,
    fontWeight: '600',
  },
  botaoSecundario: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
  botaoSecundarioTexto: {
    color: '#2563eb',
    fontSize: 14,
    fontWeight: '700',
  },
  checkboxLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxMarcado: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  checkboxMarca: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
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
  chipRemover: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  chipRemoverTexto: {
    color: '#b91c1c',
    fontSize: 13,
    fontWeight: '600',
  },
  vinculoSelecionado: {
    fontSize: 13,
    color: '#2563eb',
    fontWeight: '600',
  },
  subListaBox: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  subLista: {
    maxHeight: 200,
  },
  subListaItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    minHeight: 44,
    justifyContent: 'center',
  },
  subListaItemTexto: {
    fontSize: 14,
    color: '#111827',
  },
  rodape: {
    padding: 16,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    gap: 8,
  },
  erroTexto: {
    color: '#b91c1c',
    fontSize: 13,
    textAlign: 'center',
  },
  botaoPrimario: {
    minHeight: 52,
    borderRadius: 10,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoPrimarioTexto: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});
