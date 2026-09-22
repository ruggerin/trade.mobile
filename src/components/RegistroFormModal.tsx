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
import { IconeTipoRegistro } from './IconeTipoRegistro';
import { buscarSortimentoCampo, type ProdutoSortimento } from '../lib/api/campoSortimento';
import { listarDepartamentos, listarMarcas, listarSecoes } from '../lib/api/catalogo';
import { apagarImagemPersistente, copiarImagemParaArmazenamentoPersistente } from '../lib/db/filaRegistros';
import type { CampoTipoRegistro, CatalogoItem, ProdutoDisponivel, TipoRegistro, TipoVinculoRegistro } from '../types/api';
import { cores, espaco, indigo, neutro, raio, sombraCard, sombraFlutuante } from '../theme';

/** Valor de um campo SORTIMENTO em valores_campos — sempre um JSON deste shape, ver decisão 3 de docs/20-FORMULARIO-DINAMICO-CAMPANHA.md. */
export interface EstadoSortimento {
  presentes: string[];
  ausentes: string[];
}

export interface RegistroFormResultado {
  tipoRegistroUuid: string;
  // Já são caminhos persistentes (copiados do picker pra pasta do app na hora da captura, ver
  // capturarFoto abaixo) — nunca a uri transitória do image picker. 0..N fotos por registro, ver
  // docs/21-EVIDENCIA-EM-FOTOS.md.
  imagensUri?: string[];
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
  // Produtos marcados ausentes num campo SORTIMENTO com confirmar_ruptura_ausentes=true (decisão
  // 4 de docs/20-FORMULARIO-DINAMICO-CAMPANHA.md) — o app pai (VisitaAndamentoScreen) usa isso
  // pra abrir a tela de confirmação de ruptura DEPOIS que este registro for salvo. Vazio/ausente
  // quando não há nenhum campo assim neste tipo, ou nenhum produto ficou marcado ausente.
  produtosAusentesConfirmaveis?: { produtoUuid: string; descricao: string }[];
}

interface RegistroFormModalProps {
  visible: boolean;
  tiposRegistro: TipoRegistro[];
  produtosDisponiveis: ProdutoDisponivel[];
  // Quando vem de "tirar foto"/"marcar ruptura" num produto específico da campanha — nesse
  // caso o vínculo de catálogo não faz sentido (produto já é o contexto).
  produtoContexto?: { uuid: string; descricao: string } | null;
  // Quando vem de uma Ação (aba Ações da visita, ver TipoRegistro.acao_obrigatoria) — pula a
  // etapa de escolher o tipo, o formulário já abre direto nele.
  tipoFixo?: TipoRegistro | null;
  // Necessário só pra campos SORTIMENTO (resolve o checklist pra este PDV) — ver
  // lib/api/campoSortimento.ts. `undefined` faz o campo aparecer vazio (nunca deveria acontecer
  // na prática, a visita sempre tem um PDV).
  pontoVendaUuid?: string;
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
  pontoVendaUuid,
  enviando,
  erro,
  onClose,
  onSubmit,
}: RegistroFormModalProps) {
  const [tipo, setTipo] = useState<TipoRegistro | null>(null);
  const [valoresCampos, setValoresCampos] = useState<Record<string, string>>({});
  // Descrição de cada produto resolvido pelos campos SORTIMENTO deste formulário (chaveado por
  // uuid do produto) — só pra montar `produtosAusentesConfirmaveis` no submit sem precisar
  // re-buscar a lista lá (o CampoSortimentoInput já buscou, só reporta de volta pra cá).
  const [produtosSortimentoPorUuid, setProdutosSortimentoPorUuid] = useState<Record<string, string>>({});
  const [imagensUri, setImagensUri] = useState<string[]>([]);
  const [ruptura, setRuptura] = useState(false);
  const [vinculo, setVinculo] = useState<{ categoria: Categoria; uuid: string; label: string } | null>(null);
  const [categoriaAberta, setCategoriaAberta] = useState<Categoria | null>(null);
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  // Acompanha o valor mais recente de imagensUri e se o registro chegou a ser de fato submetido
  // — usados só pelo efeito de limpeza abaixo (não dá pra ler estado direto de dentro dele sem
  // recriar o efeito a cada tecla).
  const imagensUriRef = useRef<string[]>([]);
  const submetidoRef = useRef(false);

  useEffect(() => {
    imagensUriRef.current = imagensUri;
  }, [imagensUri]);

  // Reseta tudo sempre que o modal reabre — nunca deixa resíduo de um registro anterior.
  useEffect(() => {
    if (visible) {
      submetidoRef.current = false;
      setTipo(tipoFixo ?? null);
      setValoresCampos({});
      setProdutosSortimentoPorUuid({});
      setImagensUri([]);
      setRuptura(false);
      setVinculo(null);
      setCategoriaAberta(null);
      setErroLocal(null);
    } else if (!submetidoRef.current && imagensUriRef.current.length > 0) {
      // Modal fechado sem confirmar (botão Fechar, back do Android, ou o pai desmontou por
      // outro motivo) com fotos já copiadas pro armazenamento persistente (ver capturarFoto) —
      // sem essa limpeza, os arquivos ficavam no disco pra sempre, sem nenhum registro apontando
      // pra eles.
      for (const uri of imagensUriRef.current) {
        void apagarImagemPersistente(uri);
      }
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

  // Campo condicional (docs/20-FORMULARIO-DINAMICO-CAMPANHA.md decisão 7) — só entra na tela (e
  // só é validado como obrigatório) quando o campo do qual depende tiver o valor esperado; o
  // backend aplica a mesma regra na submissão (StoreVisitaRegistroRequest), então uma resposta
  // "escondida" aqui nunca seria salva mesmo que o promotor conseguisse preenchê-la.
  const camposVisiveis = useMemo(
    () =>
      camposOrdenados.filter(
        (campo) => !campo.depende_de_chave || valoresCampos[campo.depende_de_chave] === campo.depende_de_valor,
      ),
    [camposOrdenados, valoresCampos],
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
      setImagensUri((atual) => [...atual, caminhoPersistente]);
    } catch {
      setErroLocal('Não foi possível salvar a foto. Tente novamente.');
    }
  }

  function removerFoto(indice: number) {
    const uri = imagensUri[indice];
    if (uri) {
      void apagarImagemPersistente(uri);
    }
    setImagensUri((atual) => atual.filter((_, i) => i !== indice));
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
  // só são checadas no servidor.
  const exigeProduto = !produtoContexto && tipo?.granularidade_padrao === 'PRODUTO';
  const categoriasDisponiveis = exigeProduto ? CATEGORIAS.filter((c) => c.valor === 'PRODUTO') : CATEGORIAS;

  function validar(): string | null {
    if (!tipo) return 'Escolha um tipo de registro.';
    if (tipo.exige_foto && imagensUri.length === 0) return `O tipo "${tipo.descricao}" exige uma foto.`;
    if (exigeProduto && vinculo?.categoria !== 'PRODUTO') {
      return `O tipo "${tipo.descricao}" exige vincular um produto específico.`;
    }
    for (const campo of camposVisiveis) {
      const valor = valoresCampos[campo.chave];
      if (campo.obrigatorio && (!valor || valor.trim() === '')) {
        return `O campo "${campo.rotulo}" é obrigatório.`;
      }
      if (campo.tipo_campo === 'DATA' && valor && !/^\d{2}\/\d{2}\/\d{4}$/.test(valor)) {
        return `O campo "${campo.rotulo}" precisa de uma data completa (dd/mm/aaaa).`;
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
    // (a API valida com is_numeric, que não aceita "1,5"). Só os campos VISÍVEIS agora — uma
    // resposta escondida por uma condição não satisfeita nunca deveria ter sido dada (o backend
    // descartaria mesmo assim, ver StoreVisitaRegistroRequest, mas nem faz sentido mandar).
    const valoresNormalizados: Record<string, string> = {};
    for (const campo of camposVisiveis) {
      const valor = valoresCampos[campo.chave];
      if (valor === undefined || valor === '') continue;
      valoresNormalizados[campo.chave] =
        campo.tipo_campo === 'NUMERO' || campo.tipo_campo === 'MOEDA' ? valor.replace(',', '.') : valor;
    }

    // Produtos marcados ausentes em campos SORTIMENTO com confirmar_ruptura_ausentes=true —
    // decisão 4 do doc 20. O pai decide o que fazer com isso (abrir a tela de confirmação) só
    // DEPOIS que este registro salvar com sucesso.
    const produtosAusentesConfirmaveis: { produtoUuid: string; descricao: string }[] = [];
    for (const campo of camposVisiveis) {
      if (campo.tipo_campo !== 'SORTIMENTO' || !campo.confirmar_ruptura_ausentes) continue;
      const valor = valoresCampos[campo.chave];
      if (!valor) continue;
      const estado = JSON.parse(valor) as EstadoSortimento;
      for (const produtoUuid of estado.ausentes) {
        produtosAusentesConfirmaveis.push({ produtoUuid, descricao: produtosSortimentoPorUuid[produtoUuid] ?? produtoUuid });
      }
    }

    // Marca como submetido ANTES de chamar onSubmit — o efeito de limpeza (ver acima) só deve
    // apagar a foto se o modal fechar SEM essa marcação (abandono), nunca depois de um envio de
    // verdade, mesmo que o mutation ainda esteja pendente quando o modal for fechado.
    submetidoRef.current = true;

    onSubmit({
      tipoRegistroUuid: tipo.id,
      imagensUri: imagensUri.length > 0 ? imagensUri : undefined,
      produtoAuditoriaUuid: produtoContexto?.uuid ?? (vinculo?.categoria === 'PRODUTO' ? vinculo.uuid : undefined),
      tipoVinculo: !produtoContexto && vinculo ? vinculo.categoria : undefined,
      secaoUuid: vinculo?.categoria === 'SECAO' ? vinculo.uuid : undefined,
      departamentoUuid: vinculo?.categoria === 'DEPARTAMENTO' ? vinculo.uuid : undefined,
      marcaUuid: vinculo?.categoria === 'MARCA' ? vinculo.uuid : undefined,
      vinculoLabel: !produtoContexto && vinculo && vinculo.categoria !== 'PRODUTO' ? vinculo.label : undefined,
      valoresCampos: Object.keys(valoresNormalizados).length > 0 ? valoresNormalizados : undefined,
      ruptura: ruptura || undefined,
      produtosAusentesConfirmaveis: produtosAusentesConfirmaveis.length > 0 ? produtosAusentesConfirmaveis : undefined,
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
          <View style={styles.cabecalhoTituloLinha}>
            {tipo?.icone && <IconeTipoRegistro icone={tipo.icone} size={18} />}
            <Text style={styles.cabecalhoTitulo} numberOfLines={1}>
              {tipo ? tipo.descricao : 'Tipo de registro'}
            </Text>
          </View>
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
                <View style={styles.tipoCardConteudo}>
                  <IconeTipoRegistro icone={t.icone} />
                  <View style={styles.tipoTextos}>
                    <Text style={styles.tipoNome}>{t.descricao}</Text>
                    {t.exige_foto && <Text style={styles.tipoDetalhe}>Exige foto</Text>}
                  </View>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {tipo && (
          <>
            <ScrollView contentContainerStyle={styles.lista}>
              {produtoContexto && <Text style={styles.contextoTexto}>Registro para: {produtoContexto.descricao}</Text>}

              <View style={styles.secaoForm}>
                <Text style={styles.secaoLabel}>
                  Fotos {tipo.exige_foto ? '(pelo menos 1)' : '(opcional)'}
                </Text>
                {imagensUri.length > 0 && (
                  <ScrollView horizontal contentContainerStyle={styles.fotosLinha} showsHorizontalScrollIndicator={false}>
                    {imagensUri.map((uri, indice) => (
                      <View key={uri} style={styles.fotoPreviewBox}>
                        <Image source={{ uri }} style={styles.fotoPreview} />
                        <Pressable onPress={() => removerFoto(indice)}>
                          <Text style={styles.linkRemover}>Remover</Text>
                        </Pressable>
                      </View>
                    ))}
                  </ScrollView>
                )}
                <Pressable
                  style={({ pressed }) => [styles.botaoSecundario, pressed && styles.itemPressionado]}
                  onPress={escolherOrigemFoto}
                >
                  <Text style={styles.botaoSecundarioTexto}>
                    {imagensUri.length > 0 ? 'Adicionar mais uma foto' : 'Adicionar foto'}
                  </Text>
                </Pressable>
              </View>

              {camposVisiveis.map((campo) => (
                <View key={campo.id} style={campo.depende_de_chave ? styles.campoCondicional : undefined}>
                  <CampoInput
                    campo={campo}
                    valor={valoresCampos[campo.chave] ?? ''}
                    onChange={(valor) => definirValorCampo(campo.chave, valor)}
                    pontoVendaUuid={pontoVendaUuid}
                    onProdutosResolvidos={(produtos) =>
                      setProdutosSortimentoPorUuid((atual) => ({
                        ...atual,
                        ...Object.fromEntries(produtos.map((p) => [p.produto_uuid, p.descricao])),
                      }))
                    }
                  />
                </View>
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
                      {carregandoCategoria && <ActivityIndicator color={cores.primaria} style={{ padding: 12 }} />}
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
            </ScrollView>

            <View style={styles.rodape}>
              {(erroLocal ?? erro) && <Text style={styles.erroTexto}>{erroLocal ?? erro}</Text>}
              <Pressable
                style={({ pressed }) => [styles.botaoPrimario, pressed && styles.itemPressionado]}
                onPress={confirmar}
                disabled={enviando}
              >
                {enviando ? (
                  <ActivityIndicator color={cores.branco} />
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
  pontoVendaUuid,
  onProdutosResolvidos,
}: {
  campo: CampoTipoRegistro;
  valor: string;
  onChange: (valor: string) => void;
  pontoVendaUuid?: string;
  onProdutosResolvidos: (produtos: ProdutoSortimento[]) => void;
}) {
  const situacao = campo.tipo_campo === 'DATA' ? situacaoData(valor) : null;

  if (campo.tipo_campo === 'SORTIMENTO') {
    return (
      <View style={styles.secaoForm}>
        <Text style={styles.secaoLabel}>
          {campo.rotulo}
          {campo.obrigatorio ? ' *' : ''}
        </Text>
        <CampoSortimentoInput
          campo={campo}
          valor={valor}
          onChange={onChange}
          pontoVendaUuid={pontoVendaUuid}
          onProdutosResolvidos={onProdutosResolvidos}
        />
      </View>
    );
  }

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
      ) : campo.tipo_campo === 'BOOLEANO' ? (
        // "0"/"1" — mesma convenção do campo `ruptura` já existente, ver
        // StoreVisitaRegistroRequest::withValidator no backend.
        <View style={styles.chipsLinha}>
          <Pressable style={[styles.chip, valor === '1' && styles.chipSelecionado]} onPress={() => onChange('1')}>
            <Text style={[styles.chipTexto, valor === '1' && styles.chipTextoSelecionado]}>Sim</Text>
          </Pressable>
          <Pressable style={[styles.chip, valor === '0' && styles.chipSelecionado]} onPress={() => onChange('0')}>
            <Text style={[styles.chipTexto, valor === '0' && styles.chipTextoSelecionado]}>Não</Text>
          </Pressable>
        </View>
      ) : campo.tipo_campo === 'DATA' ? (
        <>
          <TextInput
            style={[styles.input, situacao && styles.inputDataAlerta]}
            value={valor}
            onChangeText={(texto) => onChange(formatarDataDigitada(texto))}
            keyboardType="number-pad"
            placeholder="dd/mm/aaaa"
            maxLength={10}
          />
          {situacao === 'vencida' && <Text style={styles.textoDataVencida}>Data já vencida.</Text>}
          {situacao === 'proxima' && <Text style={styles.textoDataProxima}>Vencimento próximo.</Text>}
        </>
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

/**
 * Checklist de produtos presente/ausente (decisão 3 de docs/20-FORMULARIO-DINAMICO-CAMPANHA.md)
 * — busca o recorte já resolvido pro PDV (backend decide origem dinâmica/fixa, ver
 * App\Support\ResolverSortimentoCampo), nasce com tudo pré-marcado como presente (decisão 3), o
 * promotor só desmarca o que está faltando.
 */
function CampoSortimentoInput({
  campo,
  valor,
  onChange,
  pontoVendaUuid,
  onProdutosResolvidos,
}: {
  campo: CampoTipoRegistro;
  valor: string;
  onChange: (valor: string) => void;
  pontoVendaUuid?: string;
  onProdutosResolvidos: (produtos: ProdutoSortimento[]) => void;
}) {
  const query = useQuery({
    queryKey: ['sortimento-campo', campo.id, pontoVendaUuid],
    queryFn: () => buscarSortimentoCampo(campo.id, pontoVendaUuid!),
    enabled: !!pontoVendaUuid,
  });

  const estado: EstadoSortimento | null = valor ? (JSON.parse(valor) as EstadoSortimento) : null;

  useEffect(() => {
    if (query.data) onProdutosResolvidos(query.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  // Nasce com tudo pré-marcado como presente — só semeia se ainda não tem resposta (não
  // sobrescreve o que o promotor já ajustou se o componente re-renderizar).
  useEffect(() => {
    if (query.data && !valor) {
      onChange(JSON.stringify({ presentes: query.data.map((p) => p.produto_uuid), ausentes: [] } satisfies EstadoSortimento));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, valor]);

  function alternarProduto(produtoUuid: string) {
    if (!estado) return;
    const estaPresente = estado.presentes.includes(produtoUuid);
    const novoEstado: EstadoSortimento = estaPresente
      ? { presentes: estado.presentes.filter((u) => u !== produtoUuid), ausentes: [...estado.ausentes, produtoUuid] }
      : { presentes: [...estado.presentes, produtoUuid], ausentes: estado.ausentes.filter((u) => u !== produtoUuid) };
    onChange(JSON.stringify(novoEstado));
  }

  if (!pontoVendaUuid) {
    return <Text style={styles.vazioTexto}>PDV não identificado — não é possível carregar o mix.</Text>;
  }

  if (query.isLoading) {
    return <ActivityIndicator color={cores.primaria} style={{ padding: 12 }} />;
  }

  if (query.isError) {
    return <Text style={styles.textoDataVencida}>Não foi possível carregar a lista de produtos. Feche e tente de novo.</Text>;
  }

  if ((query.data ?? []).length === 0) {
    return <Text style={styles.vazioTexto}>Nenhum produto no mix deste PDV pra este recorte.</Text>;
  }

  return (
    <View style={styles.subListaBox}>
      <ScrollView style={styles.subLista} nestedScrollEnabled>
        {(query.data ?? []).map((produto) => {
          const presente = estado?.presentes.includes(produto.produto_uuid) ?? true;
          return (
            <Pressable
              key={produto.produto_uuid}
              style={({ pressed }) => [styles.checkboxLinha, styles.subListaItem, pressed && styles.itemPressionado]}
              onPress={() => alternarProduto(produto.produto_uuid)}
            >
              <View style={[styles.checkbox, presente && styles.checkboxMarcado]}>
                {presente && <Text style={styles.checkboxMarca}>✓</Text>}
              </View>
              <Text style={styles.subListaItemTexto}>{produto.descricao}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Insere as barras automaticamente conforme o promotor digita — nunca um calendário nativo, ver docs/20-FORMULARIO-DINAMICO-CAMPANHA.md decisão 2. */
function formatarDataDigitada(texto: string): string {
  const digitos = texto.replace(/\D/g, '').slice(0, 8);
  if (digitos.length <= 2) return digitos;
  if (digitos.length <= 4) return `${digitos.slice(0, 2)}/${digitos.slice(2)}`;
  return `${digitos.slice(0, 2)}/${digitos.slice(2, 4)}/${digitos.slice(4)}`;
}

/**
 * Alerta imediato de validade (decisão 9 do doc) — "vencida" (já passou) ou "proxima" (dentro de
 * 30 dias, limiar não fechado no doc, escolhido por ser um padrão comum de aviso de validade).
 * `null` pra data incompleta/inválida (nem toda data mal-formada deveria acender alerta).
 */
function situacaoData(valor: string): 'vencida' | 'proxima' | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor);
  if (!match) return null;

  const dia = Number(match[1]);
  const mes = Number(match[2]);
  const ano = Number(match[3]);
  const data = new Date(ano, mes - 1, dia);
  if (data.getDate() !== dia || data.getMonth() !== mes - 1 || data.getFullYear() !== ano) return null;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const diffDias = (data.getTime() - hoje.getTime()) / 86_400_000;
  if (diffDias < 0) return 'vencida';
  if (diffDias <= 30) return 'proxima';
  return null;
}

function mapCatalogoItem(item: CatalogoItem): { uuid: string; label: string } {
  return { uuid: item.id, label: item.descricao };
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
  lista: {
    padding: espaco.lg,
    gap: espaco.md,
  },
  contextoTexto: {
    fontSize: 13,
    color: cores.textoSecundario,
    marginBottom: 4,
  },
  vazioTexto: {
    fontSize: 14,
    color: cores.textoTerciario,
    textAlign: 'center',
    padding: espaco.md,
  },
  tipoCard: {
    backgroundColor: cores.fundoCard,
    borderRadius: raio.lg,
    padding: espaco.lg,
    borderWidth: 1,
    borderColor: cores.borda,
    minHeight: 48,
    justifyContent: 'center',
    ...sombraCard,
  },
  itemPressionado: {
    backgroundColor: neutro[100],
  },
  tipoCardConteudo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
  },
  tipoTextos: {
    flex: 1,
  },
  cabecalhoTituloLinha: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  tipoNome: {
    fontSize: 16,
    fontWeight: '600',
    color: cores.texto,
  },
  tipoDetalhe: {
    fontSize: 12,
    color: cores.textoTerciario,
    marginTop: 2,
  },
  secaoForm: {
    gap: espaco.sm,
  },
  // Indica visualmente que este campo só apareceu por causa de outra resposta (decisão 7/9 do
  // doc 20) — borda esquerda + recuo, mesmo padrão de "isso é uma consequência do que veio antes".
  campoCondicional: {
    borderLeftWidth: 2,
    borderLeftColor: indigo[300],
    paddingLeft: espaco.md,
    marginLeft: 4,
  },
  inputDataAlerta: {
    borderColor: cores.erro,
  },
  textoDataVencida: {
    color: cores.erro,
    fontSize: 12,
    fontWeight: '700',
    marginTop: -4,
  },
  textoDataProxima: {
    color: cores.acentoTexto,
    fontSize: 12,
    fontWeight: '700',
    marginTop: -4,
  },
  secaoLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: neutro[700],
  },
  input: {
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.md,
    paddingHorizontal: espaco.md,
    minHeight: 48,
    fontSize: 15,
    backgroundColor: cores.fundoCard,
  },
  fotosLinha: {
    flexDirection: 'row',
    gap: espaco.md,
  },
  fotoPreviewBox: {
    gap: espaco.sm,
    alignItems: 'center',
  },
  fotoPreview: {
    width: 120,
    height: 120,
    borderRadius: raio.md,
  },
  linkRemover: {
    color: cores.erro,
    fontSize: 13,
    fontWeight: '600',
  },
  botaoSecundario: {
    flexDirection: 'row',
    gap: espaco.sm,
    minHeight: 48,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.primaria,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: espaco.lg,
    alignSelf: 'flex-start',
  },
  botaoSecundarioTexto: {
    color: cores.primaria,
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
    borderColor: cores.borda,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxMarcado: {
    backgroundColor: cores.primaria,
    borderColor: cores.primaria,
  },
  checkboxMarca: {
    color: cores.branco,
    fontSize: 14,
    fontWeight: '700',
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
  chipRemover: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: espaco.sm,
  },
  chipRemoverTexto: {
    color: cores.erro,
    fontSize: 13,
    fontWeight: '600',
  },
  vinculoSelecionado: {
    fontSize: 13,
    color: cores.primaria,
    fontWeight: '600',
  },
  subListaBox: {
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.md,
    backgroundColor: cores.fundoCard,
    overflow: 'hidden',
  },
  subLista: {
    maxHeight: 200,
  },
  subListaItem: {
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.md,
    borderBottomWidth: 1,
    borderBottomColor: neutro[100],
    minHeight: 44,
    justifyContent: 'center',
  },
  subListaItemTexto: {
    fontSize: 14,
    color: cores.texto,
  },
  rodape: {
    padding: espaco.lg,
    backgroundColor: cores.fundoCard,
    borderTopWidth: 1,
    borderTopColor: cores.divisor,
    gap: espaco.sm,
  },
  erroTexto: {
    color: cores.erro,
    fontSize: 13,
    textAlign: 'center',
  },
  botaoPrimario: {
    minHeight: 52,
    borderRadius: raio.md,
    backgroundColor: cores.primaria,
    alignItems: 'center',
    justifyContent: 'center',
    ...sombraFlutuante,
    shadowColor: cores.primaria,
    shadowOpacity: 0.3,
  },
  botaoPrimarioTexto: {
    color: cores.branco,
    fontSize: 15,
    fontWeight: '700',
  },
});
