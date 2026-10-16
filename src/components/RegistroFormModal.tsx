import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconeTipoRegistro } from './IconeTipoRegistro';
import { CampoEmbalagem, ListaMarcasColeta, type MarcaDaColeta } from './ColetaPorMarca';
import { produtosDaListaGuiada } from '../lib/acaoObrigatoria';
import { descreverEmbalagem, precoPorReferencia, quantidadeDigitada, type UnidadeEmbalagem } from '../lib/embalagem';
import { gerarUuidLocal } from '../lib/uuid';
import { buscarSortimento } from '../lib/api/sortimentoPontoVenda';
import { buscarSortimentoCampo, type ProdutoSortimento, type RecortesDoMix } from '../lib/api/campoSortimento';
import { listarDepartamentos, listarMarcas, listarSecoes } from '../lib/api/catalogo';
import { listarProdutosCatalogo } from '../lib/api/produtosAuditoria';
import { apagarImagemPersistente, copiarImagemParaArmazenamentoPersistente } from '../lib/db/filaRegistros';
import { lerRascunhosColeta, salvarRascunhosColeta, type RascunhoProduto, type RascunhosColeta } from '../lib/db/rascunhosColeta';
import { mascararMoeda, moedaParaApi } from '../lib/mascaraMoeda';
import {
  type OpcaoRecorte,
  ROTULO_RECORTE,
  type RecorteEscolhido,
  type TipoRecorte,
  agruparChecklist,
  descricaoRecorte,
  estaNaLoja,
  marcasNaLoja,
  mixAprovado,
  opcoesDaAba,
  produtosDoRecorte,
  recortesPermitidos,
} from '../lib/recorteEscolhido';
import type { CampoTipoRegistro, CatalogoItem, ProdutoDisponivel, SortimentoPontoVenda, TipoRegistro, TipoVinculoRegistro } from '../types/api';
import { cores, espaco, indigo, neutro, raio, sombraCard, tipografia } from '../theme';

/** Valor de um campo SORTIMENTO em valores_campos — sempre um JSON deste shape, ver decisão 3 de docs/20-FORMULARIO-DINAMICO-CAMPANHA.md. */
export interface EstadoSortimento {
  presentes: string[];
  ausentes: string[];
  // Adicionados pelo promotor de fora do mix da loja, sempre entre os presentes (docs/79 decisão 8).
  fora_do_mix?: string[];
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
  // Nome do produto vinculado — pro registro na fila local mostrar o nome mesmo offline (produto
  // da lista predefinida pode nem estar no mix da loja, então não dá pra achar por lá).
  produtoDescricao?: string;
  // Coleta guiada por lista de produtos: depois de salvar, o modal volta pra lista em vez de
  // fechar — o pai não deve fechar o modal no sucesso.
  permanecerAberto?: boolean;
  // Registro de resposta a um "ainda está lá?" (docs/83) — o pai enfileira a resposta depois de salvar.
  acompanhamentoUuid?: string;
  // Concorrente por marca (docs/85): marca nova cadastrada aqui (marcaUuid gerado no celular) e a
  // embalagem — quantidade + unidade (ML, L, G, KG, UN).
  marcaNovaDescricao?: string;
  embalagemQuantidade?: number;
  embalagemUnidade?: string;
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
  // Pode devolver uma Promise — a coleta guiada (lista de produtos) espera o registro salvar pra
  // só então voltar pra lista, sem perder o que foi digitado se der erro.
  onSubmit: (payload: RegistroFormResultado) => void | Promise<unknown>;
  // Produtos já coletados NESTA visita pra um tipo de registro — alimenta o check verde da
  // coleta guiada. Sem isso, todos aparecem como pendentes.
  produtosColetados?: (tipoRegistroUuid: string) => ReadonlySet<string>;
  // Visita local — chave do rascunho da coleta guiada (lib/db/rascunhosColeta.ts).
  visitaLocalId?: string;
  // Concorrente por marca (docs/85): embalagens já salvas NESTA visita pra um formulário — a lista
  // de marcas mostra "500 ml · 1,5 L" e conta. Sem isso, toda marca aparece vazia.
  embalagensColetadas?: (tipoRegistroUuid: string) => { marcaUuid: string; marcaDescricao: string; embalagem: string }[];
  // Registro que responde a um "ainda está lá?" (docs/83 §5.4): abre com a última coleta (modo
  // preenchido; null no cego) e com o vínculo do registro original travado.
  respostaAcompanhamento?: {
    acompanhamentoUuid: string;
    valoresIniciais: Record<string, string> | null;
    vinculo: { tipoVinculo: 'SECAO' | 'DEPARTAMENTO' | 'MARCA'; uuid: string; descricao: string; marcaUuid: string | null } | null;
  } | null;
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
  produtosColetados,
  visitaLocalId,
  embalagensColetadas,
  respostaAcompanhamento = null,
}: RegistroFormModalProps) {
  const insets = useSafeAreaInsets();
  const [tipo, setTipo] = useState<TipoRegistro | null>(null);
  const [valoresCampos, setValoresCampos] = useState<Record<string, string>>({});
  // Descrição de cada produto resolvido pelos campos SORTIMENTO deste formulário (chaveado por
  // uuid do produto) — só pra montar `produtosAusentesConfirmaveis` no submit sem precisar
  // re-buscar a lista lá (o CampoSortimentoInput já buscou, só reporta de volta pra cá).
  const [produtosSortimentoPorUuid, setProdutosSortimentoPorUuid] = useState<Record<string, string>>({});
  const [imagensUri, setImagensUri] = useState<string[]>([]);
  const [ruptura, setRuptura] = useState(false);
  const [vinculo, setVinculo] = useState<{ categoria: Categoria; uuid: string; label: string } | null>(null);
  // Onde é o registro, quando o formulário pede essa escolha antes das perguntas (docs/79).
  const [recorte, setRecorte] = useState<RecorteEscolhido | null>(null);
  const [categoriaAberta, setCategoriaAberta] = useState<Categoria | null>(null);
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  // Coleta guiada: produto da lista predefinida que está sendo respondido agora (null = na lista).
  const [produtoLista, setProdutoLista] = useState<{ uuid: string; descricao: string } | null>(null);
  // Rascunho da coleta guiada — produto por produto, só vira registro no "Salvar" final da lista.
  const [rascunhos, setRascunhos] = useState<RascunhosColeta>({});
  const [salvandoColeta, setSalvandoColeta] = useState(false);
  // Concorrente por marca (docs/85): marca aberta agora (null = na lista de marcas), marcas
  // cadastradas nesta abertura e a embalagem que está sendo preenchida.
  const [marcaAtual, setMarcaAtual] = useState<MarcaDaColeta | null>(null);
  const [marcasNovas, setMarcasNovas] = useState<MarcaDaColeta[]>([]);
  const [embalagemQuantidade, setEmbalagemQuantidade] = useState('');
  const [embalagemUnidade, setEmbalagemUnidade] = useState<UnidadeEmbalagem | null>(null);
  const [erroColeta, setErroColeta] = useState<string | null>(null);
  // Fotos que já pertencem ao rascunho do produto aberto — nunca apagar o arquivo delas por causa
  // de uma edição abandonada (voltar/fechar sem salvar), só quando o rascunho deixar de usá-las.
  const imagensDoRascunhoRef = useRef<string[]>([]);
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
      // "Ainda está lá?" em modo preenchido: começa com a última coleta (docs/83 §3.1.4).
      setValoresCampos(respostaAcompanhamento?.valoresIniciais ?? {});
      setProdutosSortimentoPorUuid({});
      setImagensUri([]);
      setRuptura(false);
      setVinculo(null);
      // Resposta a um acompanhamento: o recorte do registro original já vem escolhido e travado.
      const travado = respostaAcompanhamento?.vinculo;
      if (travado) {
        const [principal, marcaNome] = travado.descricao.split(' · ');
        setRecorte({
          tipo: travado.tipoVinculo,
          uuid: travado.uuid,
          descricao: principal,
          marca: travado.marcaUuid && travado.tipoVinculo !== 'MARCA' ? { uuid: travado.marcaUuid, descricao: marcaNome ?? '' } : null,
        });
      } else {
        setRecorte(null);
      }
      recorteJaEscolhidoRef.current = !!travado;
      setCategoriaAberta(null);
      setErroLocal(null);
      setProdutoLista(null);
      setMarcaAtual(null);
      setMarcasNovas([]);
      setEmbalagemQuantidade('');
      setEmbalagemUnidade(null);
    } else if (!submetidoRef.current && imagensUriRef.current.some((uri) => !imagensDoRascunhoRef.current.includes(uri))) {
      // Modal fechado sem confirmar (botão Fechar, back do Android, ou o pai desmontou por
      // outro motivo) com fotos já copiadas pro armazenamento persistente (ver capturarFoto) —
      // sem essa limpeza, os arquivos ficavam no disco pra sempre, sem nenhum registro apontando
      // pra eles.
      for (const uri of imagensUriRef.current) {
        if (!imagensDoRascunhoRef.current.includes(uri)) void apagarImagemPersistente(uri);
      }
    }
  }, [visible, tipoFixo]);


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

  // docs/79: o formulário pede "onde é" (marca/departamento/seção) antes das perguntas. As opções
  // saem do mix da loja (resposta do Mix que segue a escolha); sem esse campo, do catálogo.
  const permitidos = useMemo(() => (tipo ? recortesPermitidos(tipo) : []), [tipo]);
  const pedeRecorte = permitidos.length > 0;
  const campoQueSegue = camposOrdenados.find((c) => c.tipo_campo === 'SORTIMENTO' && c.sortimento_segue_escolha);
  const mixQueSegueQuery = useQuery({
    queryKey: ['sortimento-campo', campoQueSegue?.id, pontoVendaUuid],
    queryFn: () => buscarSortimentoCampo(campoQueSegue!.id, pontoVendaUuid!),
    enabled: pedeRecorte && !!campoQueSegue && !!pontoVendaUuid,
  });
  const recortesDoMix = mixQueSegueQuery.data?.recortes;
  const usarCatalogoNaEscolha = pedeRecorte && !campoQueSegue;
  // Mix da loja em cache (mesma chave da tela da visita): bloco "Na loja" sem rede (docs/82 §5.1).
  const mixDaLojaQuery = useQuery({
    queryKey: ['sortimento', pontoVendaUuid],
    queryFn: () => buscarSortimento(pontoVendaUuid!),
    enabled: (pedeRecorte || tipo?.lista_produtos_origem === 'MIX_LOJA') && !!pontoVendaUuid,
  });
  // Lista guiada de "Cada produto": a fixa do admin, ou os nossos produtos do Mix desta loja
  // (checklist de presença, docs/85 §7).
  const listaGuiada = useMemo(() => (tipo ? produtosDaListaGuiada(tipo, mixDaLojaQuery.data) : []), [tipo, mixDaLojaQuery.data]);
  // Já escolheu uma vez neste registro: depois de "Trocar", a escolha automática não volta.
  const recorteJaEscolhidoRef = useRef(false);
  function escolherRecorte(r: RecorteEscolhido) {
    recorteJaEscolhidoRef.current = true;
    setRecorte(r);
  }

  // Trocar o recorte muda os produtos do checklist — as marcações anteriores não valem mais.
  function trocarRecorte() {
    setRecorte(null);
    setValoresCampos((atual) => {
      const novo = { ...atual };
      for (const c of camposOrdenados) if (c.sortimento_segue_escolha) delete novo[c.chave];
      return novo;
    });
  }

  const secoesQuery = useQuery({
    queryKey: ['secoes-auditoria'],
    queryFn: listarSecoes,
    enabled: categoriaAberta === 'SECAO' || (pedeRecorte && permitidos.includes('SECAO')),
  });
  const departamentosQuery = useQuery({
    queryKey: ['departamentos-auditoria'],
    queryFn: listarDepartamentos,
    enabled: categoriaAberta === 'DEPARTAMENTO' || (pedeRecorte && permitidos.includes('DEPARTAMENTO')),
  });
  const marcasQuery = useQuery({
    queryKey: ['marcas-auditoria'],
    queryFn: listarMarcas,
    enabled: categoriaAberta === 'MARCA' || (pedeRecorte && (permitidos.includes('MARCA') || !!tipo?.filtra_marca)),
  });

  // Foto de registro é evidência de campo: só câmera, na hora — nunca da galeria (uma foto
  // antiga/de outra loja passaria como coleta de agora). A foto de perfil (PerfilScreen) é outra
  // coisa e continua aceitando galeria.
  async function capturarFoto() {
    const permissao = await ImagePicker.requestCameraPermissionsAsync();

    if (permissao.status !== 'granted') {
      Alert.alert('Permissão necessária', 'Ative a permissão de câmera nas configurações do sistema pra tirar fotos.', [
        { text: 'Agora não', style: 'cancel' },
        { text: 'Abrir configurações', onPress: () => void Linking.openSettings() },
      ]);
      return;
    }

    const resultado = await ImagePicker.launchCameraAsync({ quality: 0.7 });

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
    if (uri && !imagensDoRascunhoRef.current.includes(uri)) {
      void apagarImagemPersistente(uri);
    }
    setImagensUri((atual) => atual.filter((_, i) => i !== indice));
  }

  // Ver App\Support\GranularidadeChecklist no backend e
  // docs/16-GRANULARIDADE-CHECKLIST-AUDITORIA.md §4 — quando a pergunta exige resposta por
  // produto individual, só o vínculo a Produto faz sentido (Seção/Departamento/Marca inteira
  // seria uma resposta agregada, o que essa pergunta não aceita). produtoContexto já satisfaz
  // isso sozinho (já é um produto específico). O backend é a autoridade final — isto aqui só
  // evita o promotor escolher um caminho que já sabe que vai ser rejeitado; exceções por seção
  // só são checadas no servidor.
  // Formulário com lista predefinida de produtos (admin) → coleta guiada: o modal abre numa lista
  // com o status de cada produto (coletado nesta visita ou não), e cada toque abre as perguntas
  // já amarradas àquele produto. Ver docs/16-GRANULARIDADE-CHECKLIST-AUDITORIA.md.
  const modoLista = !!tipo && !produtoContexto && tipo.granularidade_padrao === 'PRODUTO' && listaGuiada.length > 0;
  // Cada marca concorrente (docs/85 §3.3): lista de marcas → marca → uma embalagem por registro.
  const modoMarca = !!tipo && !produtoContexto && tipo.granularidade_padrao === 'MARCA';
  const embalagensDoTipo = useMemo(
    () => (modoMarca && tipo ? (embalagensColetadas?.(tipo.id) ?? []) : []),
    [modoMarca, tipo, embalagensColetadas],
  );
  const embalagensPorMarca = useMemo(() => {
    const mapa = new Map<string, string[]>();
    for (const e of embalagensDoTipo) mapa.set(e.marcaUuid, [...(mapa.get(e.marcaUuid) ?? []), e.embalagem]);
    return mapa;
  }, [embalagensDoTipo]);
  // Lista do formulário + as cadastradas aqui + as que já têm registro nesta visita (ex.: marca
  // nova de uma abertura anterior), sem repetir.
  const marcasDaColeta = useMemo<MarcaDaColeta[]>(() => {
    if (!modoMarca || !tipo) return [];
    const lista: MarcaDaColeta[] = (tipo.marcas_predefinidas ?? []).map((m) => ({ uuid: m.id, descricao: m.descricao, aAprovar: m.a_aprovar, nova: false }));
    const vistos = new Set(lista.map((m) => m.uuid));
    for (const e of embalagensDoTipo) {
      if (vistos.has(e.marcaUuid)) continue;
      vistos.add(e.marcaUuid);
      lista.push({ uuid: e.marcaUuid, descricao: e.marcaDescricao, aAprovar: true, nova: true });
    }
    for (const m of marcasNovas) if (!vistos.has(m.uuid)) lista.push(m);
    return lista;
  }, [modoMarca, tipo, embalagensDoTipo, marcasNovas]);
  const embalagemTexto = descreverEmbalagem(quantidadeDigitada(embalagemQuantidade), embalagemUnidade);
  // R$ por litro/kg na hora, a partir da primeira pergunta em R$ (docs/85 §3.3).
  const campoPreco = camposOrdenados.find((c) => c.tipo_campo === 'MOEDA');
  const precoDigitado = campoPreco && valoresCampos[campoPreco.chave] ? Number(moedaParaApi(valoresCampos[campoPreco.chave])) : null;
  const porReferencia = precoPorReferencia(
    precoDigitado !== null && Number.isFinite(precoDigitado) ? precoDigitado : null,
    quantidadeDigitada(embalagemQuantidade),
    embalagemUnidade,
  );
  const produtoEfetivo = produtoContexto ?? produtoLista;

  useEffect(() => {
    if (!visible || !modoLista || !tipo || !visitaLocalId) return;
    let cancelado = false;
    setErroColeta(null);
    void lerRascunhosColeta(visitaLocalId, tipo.id)
      .then((r) => {
        if (!cancelado) setRascunhos(r);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [visible, modoLista, tipo, visitaLocalId]);
  const exigeProduto = !produtoEfetivo && tipo?.granularidade_padrao === 'PRODUTO';

  function abrirMarca(marca: MarcaDaColeta) {
    if (tipo && !tipo.varias_embalagens && (embalagensPorMarca.get(marca.uuid)?.length ?? 0) > 0) {
      Alert.alert('Já registrada', `Este formulário aceita uma embalagem por marca, e ${marca.descricao} já foi registrada nesta visita.`);
      return;
    }
    limparFormulario();
    setMarcaAtual(marca);
  }

  function voltarParaMarcas() {
    for (const uri of imagensUri) void apagarImagemPersistente(uri);
    limparFormulario();
    setMarcaAtual(null);
  }

  // "+ Outra marca": uuid gerado aqui, a marca nasce no servidor junto do primeiro registro, "a aprovar".
  function cadastrarMarca(descricao: string) {
    const existente = marcasDaColeta.find((m) => m.descricao.trim().toLowerCase() === descricao.trim().toLowerCase());
    if (existente) {
      abrirMarca(existente);
      return;
    }
    const nova: MarcaDaColeta = { uuid: gerarUuidLocal(), descricao: descricao.trim(), aAprovar: true, nova: true };
    setMarcasNovas((atual) => [...atual, nova]);
    abrirMarca(nova);
  }
  const categoriasDisponiveis = exigeProduto ? CATEGORIAS.filter((c) => c.valor === 'PRODUTO') : CATEGORIAS;

  function validar(): string | null {
    if (!tipo) return 'Escolha um tipo de registro.';
    if (pedeRecorte && !recorte) return 'Escolha onde é este registro.';
    if (tipo.exige_foto && imagensUri.length === 0) return `O tipo "${tipo.descricao}" exige uma foto.`;
    if (modoMarca) {
      if (!marcaAtual) return 'Escolha a marca.';
      if (!quantidadeDigitada(embalagemQuantidade)) return 'Informe a quantidade da embalagem.';
      if (!embalagemUnidade) return 'Escolha a unidade da embalagem (ml, L, g, kg ou un).';
    }
    if (exigeProduto && vinculo?.categoria !== 'PRODUTO') {
      return `O tipo "${tipo.descricao}" exige vincular um produto específico.`;
    }
    // Produto em ruptura: não tem o que coletar — as perguntas somem e não são exigidas (o backend
    // aplica a mesma regra, ver StoreVisitaRegistroRequest). Foto obrigatória continua valendo.
    for (const campo of ruptura ? [] : camposVisiveis) {
      const valor = valoresCampos[campo.chave];
      if (campo.obrigatorio && (!valor || valor.trim() === '')) {
        return `O campo "${campo.rotulo}" é obrigatório.`;
      }
      if (campo.tipo_campo === 'DATA' && valor) {
        if (!dataValida(valor)) {
          return `O campo "${campo.rotulo}" precisa de uma data válida (dd/mm/aaaa).`;
        }
        if (campo.limite_dias_retroativos !== null && !dentroDoLimiteRetroativo(valor, campo.limite_dias_retroativos)) {
          return `O campo "${campo.rotulo}" não aceita uma data anterior a ${campo.limite_dias_retroativos} dia(s) atrás.`;
        }
      }
    }
    return null;
  }

  // Limpa o formulário (sem fechar o modal) — ao trocar de produto na coleta guiada.
  function limparFormulario() {
    submetidoRef.current = false;
    setValoresCampos({});
    setProdutosSortimentoPorUuid({});
    setImagensUri([]);
    setRuptura(false);
    setVinculo(null);
    setCategoriaAberta(null);
    setErroLocal(null);
    setEmbalagemQuantidade('');
    setEmbalagemUnidade(null);
  }

  function abrirProdutoDaLista(produto: { uuid: string; descricao: string }) {
    if (tipo && produtosColetados?.(tipo.id).has(produto.uuid)) {
      Alert.alert('Já enviado', `"${produto.descricao}" já foi salvo e enviado nesta visita.`);
      return;
    }
    limparFormulario();
    // Já preenchido antes → abre com o que foi digitado; salvar de novo só atualiza o rascunho.
    const r = rascunhos[produto.uuid];
    if (r) {
      setValoresCampos(r.valoresCampos);
      setImagensUri(r.imagensUri);
      setRuptura(r.ruptura);
      imagensDoRascunhoRef.current = r.imagensUri;
    }
    setProdutoLista(produto);
  }

  // Voltar pra lista sem salvar descarta as fotos já copiadas (mesmo raciocínio da limpeza ao
  // fechar o modal sem confirmar).
  function voltarParaLista() {
    for (const uri of imagensUri) {
      if (!imagensDoRascunhoRef.current.includes(uri)) void apagarImagemPersistente(uri);
    }
    imagensDoRascunhoRef.current = [];
    limparFormulario();
    setProdutoLista(null);
  }

  // NUMERO/MOEDA → formato da API; só as perguntas VISÍVEIS pra esses valores (condicionais).
  function normalizarValores(valores: Record<string, string>): Record<string, string> {
    const normalizados: Record<string, string> = {};
    for (const campo of camposOrdenados) {
      if (campo.depende_de_chave && valores[campo.depende_de_chave] !== campo.depende_de_valor) continue;
      const valor = valores[campo.chave];
      if (valor === undefined || valor === '') continue;
      normalizados[campo.chave] =
        campo.tipo_campo === 'MOEDA' ? moedaParaApi(valor) : campo.tipo_campo === 'NUMERO' ? valor.replace(',', '.') : valor;
    }
    return normalizados;
  }

  // Coleta guiada: "Salvar produto" só guarda o rascunho (SQLite) e volta pra lista.
  async function salvarRascunhoProduto() {
    if (!tipo || !produtoLista || !visitaLocalId) return;
    const anterior = rascunhos[produtoLista.uuid];
    const novo: RascunhoProduto = { descricao: produtoLista.descricao, valoresCampos, imagensUri, ruptura };
    const atualizados = { ...rascunhos, [produtoLista.uuid]: novo };
    try {
      await salvarRascunhosColeta(visitaLocalId, tipo.id, atualizados);
    } catch {
      setErroLocal('Não foi possível guardar neste aparelho. Tente de novo.');
      return;
    }
    // Foto que estava no rascunho e foi tirada nesta edição: agora sim o arquivo pode ir embora.
    for (const uri of anterior?.imagensUri ?? []) {
      if (!imagensUri.includes(uri)) void apagarImagemPersistente(uri);
    }
    setRascunhos(atualizados);
    imagensDoRascunhoRef.current = [];
    limparFormulario();
    setProdutoLista(null);
  }

  // "Salvar" do fim da lista: cada produto preenchido vira um registro na fila (que envia pro
  // servidor). Um por vez, tirando do rascunho a cada sucesso — se algo falhar no meio, o que já
  // foi continua enviado e o resto fica no rascunho pra tentar de novo, sem duplicar nada.
  async function salvarColeta() {
    if (!tipo || !visitaLocalId) return;
    const lista = listaGuiada;
    const jaEnviados = produtosColetados?.(tipo.id) ?? new Set<string>();
    const pendentes = lista.filter((p) => !jaEnviados.has(p.id) && rascunhos[p.id]);

    setSalvandoColeta(true);
    setErroColeta(null);
    let restantes = { ...rascunhos };
    try {
      for (const produto of pendentes) {
        const r = restantes[produto.id];
        const valores = r.ruptura ? {} : normalizarValores(r.valoresCampos);
        await Promise.resolve(
          onSubmit({
            tipoRegistroUuid: tipo.id,
            imagensUri: r.imagensUri.length > 0 ? r.imagensUri : undefined,
            produtoAuditoriaUuid: produto.id,
            tipoVinculo: 'PRODUTO',
            produtoDescricao: r.descricao,
            permanecerAberto: true,
            valoresCampos: Object.keys(valores).length > 0 ? valores : undefined,
            ruptura: r.ruptura || undefined,
          }),
        );
        const { [produto.id]: _enviado, ...resto } = restantes;
        restantes = resto;
        await salvarRascunhosColeta(visitaLocalId, tipo.id, restantes);
        setRascunhos(restantes);
      }
      onClose();
    } catch {
      setErroColeta('Não foi possível salvar tudo. O que faltou continua guardado — toque em Salvar de novo.');
    } finally {
      setSalvandoColeta(false);
    }
  }

  function confirmar() {
    const mensagemErro = validar();
    if (mensagemErro) {
      setErroLocal(mensagemErro);
      return;
    }
    setErroLocal(null);
    if (!tipo) return;

    if (modoLista && produtoLista) {
      void salvarRascunhoProduto();
      return;
    }

    // NUMERO/MOEDA vêm de teclado decimal — normaliza vírgula pra ponto antes de enviar
    // (a API valida com is_numeric, que não aceita "1,5"). Só os campos VISÍVEIS agora — uma
    // resposta escondida por uma condição não satisfeita nunca deveria ter sido dada (o backend
    // descartaria mesmo assim, ver StoreVisitaRegistroRequest, mas nem faz sentido mandar).
    const valoresNormalizados: Record<string, string> = {};
    for (const campo of ruptura ? [] : camposVisiveis) {
      const valor = valoresCampos[campo.chave];
      if (valor === undefined || valor === '') continue;
      // MOEDA vem mascarado ("1.234,56") — tira o milhar antes de trocar a vírgula.
      valoresNormalizados[campo.chave] =
        campo.tipo_campo === 'MOEDA' ? moedaParaApi(valor) : campo.tipo_campo === 'NUMERO' ? valor.replace(',', '.') : valor;
    }

    // Produtos marcados ausentes em campos SORTIMENTO com confirmar_ruptura_ausentes=true —
    // decisão 4 do doc 20. O pai decide o que fazer com isso (abrir a tela de confirmação) só
    // DEPOIS que este registro salvar com sucesso.
    const produtosAusentesConfirmaveis: { produtoUuid: string; descricao: string }[] = [];
    for (const campo of ruptura ? [] : camposVisiveis) {
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

    const resultado = onSubmit({
      tipoRegistroUuid: tipo.id,
      imagensUri: imagensUri.length > 0 ? imagensUri : undefined,
      produtoAuditoriaUuid: produtoEfetivo?.uuid ?? (vinculo?.categoria === 'PRODUTO' ? vinculo.uuid : undefined),
      tipoVinculo: recorte ? recorte.tipo : produtoLista ? 'PRODUTO' : !produtoContexto && vinculo ? vinculo.categoria : undefined,
      produtoDescricao: produtoEfetivo?.descricao ?? (vinculo?.categoria === 'PRODUTO' ? vinculo.label : undefined),
      permanecerAberto: modoLista || undefined,
      secaoUuid: recorte ? (recorte.tipo === 'SECAO' ? recorte.uuid : undefined) : vinculo?.categoria === 'SECAO' ? vinculo.uuid : undefined,
      departamentoUuid: recorte
        ? recorte.tipo === 'DEPARTAMENTO' ? recorte.uuid : undefined
        : vinculo?.categoria === 'DEPARTAMENTO' ? vinculo.uuid : undefined,
      // Marca inteira, ou a marca como filtro da seção/departamento (docs/82 §5.2).
      marcaUuid: recorte
        ? recorte.tipo === 'MARCA' ? recorte.uuid : (recorte.marca?.uuid ?? undefined)
        : vinculo?.categoria === 'MARCA' ? vinculo.uuid : undefined,
      vinculoLabel: recorte
        ? `${ROTULO_RECORTE[recorte.tipo]}: ${descricaoRecorte(recorte)}`
        : !produtoContexto && vinculo && vinculo.categoria !== 'PRODUTO' ? vinculo.label : undefined,
      valoresCampos: Object.keys(valoresNormalizados).length > 0 ? valoresNormalizados : undefined,
      ruptura: ruptura || undefined,
      produtosAusentesConfirmaveis: produtosAusentesConfirmaveis.length > 0 ? produtosAusentesConfirmaveis : undefined,
      acompanhamentoUuid: respostaAcompanhamento?.acompanhamentoUuid,
      // Por marca (docs/85): o vínculo é a marca + embalagem; o servidor completa com a linha do escopo.
      ...(modoMarca && marcaAtual
        ? {
            tipoVinculo: undefined,
            marcaUuid: marcaAtual.uuid,
            marcaNovaDescricao: marcaAtual.nova ? marcaAtual.descricao : undefined,
            embalagemQuantidade: quantidadeDigitada(embalagemQuantidade) ?? undefined,
            embalagemUnidade: embalagemUnidade ?? undefined,
            vinculoLabel: `${marcaAtual.descricao} · ${embalagemTexto ?? ''}`,
            permanecerAberto: true,
            ruptura: undefined,
          }
        : {}),
    });

    // Sempre trata a promise (o pai pode passar mutateAsync, que rejeita no erro — promise
    // rejeitada sem handler derruba o app em produção). Coleta guiada: salvou → volta pra lista (o
    // check verde vem de produtosColetados). Deu erro → fica no formulário com o que foi digitado;
    // o pai mostra a mensagem em `erro`, e a foto volta a ser "não enviada" pra limpeza ao fechar.
    void Promise.resolve(resultado).then(
      () => {
        // Por marca: salvou a embalagem → fica na marca pra adicionar outra (ou volta pra lista
        // quando o formulário aceita uma só).
        if (modoMarca) {
          limparFormulario();
          if (tipo && !tipo.varias_embalagens) setMarcaAtual(null);
          return;
        }
        if (!modoLista) return;
        limparFormulario();
        setProdutoLista(null);
      },
      () => {
        submetidoRef.current = false;
      },
    );
  }

  function itensDaCategoria(categoria: Categoria): { uuid: string; label: string }[] {
    if (categoria === 'PRODUTO') {
      // Formulário com lista predefinida (admin) — só esses produtos, em qualquer loja, estejam no
      // mix dela ou não (ex.: pesquisa de preço de concorrente). Sem lista: mix/campanha da visita.
      if (exigeProduto && listaGuiada.length) {
        return listaGuiada.map((p) => ({ uuid: p.id, label: p.descricao }));
      }
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

  const fotoObrigatoriaFaltando = !!tipo?.exige_foto && imagensUri.length === 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdropContainer} behavior="padding">
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.alcaWrap}>
            <View style={styles.alca} />
          </View>
          <View style={styles.cabecalho}>
            {marcaAtual ? (
              <Pressable onPress={voltarParaMarcas} hitSlop={12} style={styles.cabecalhoIconeBotao} accessibilityLabel="Voltar para as marcas">
                <MaterialCommunityIcons name="chevron-left" size={24} color={cores.primaria} />
              </Pressable>
            ) : produtoLista ? (
              <Pressable onPress={voltarParaLista} hitSlop={12} style={styles.cabecalhoIconeBotao}>
                <MaterialCommunityIcons name="chevron-left" size={24} color={cores.primaria} />
              </Pressable>
            ) : tipo && !tipoFixo ? (
              <Pressable onPress={() => setTipo(null)} hitSlop={12} style={styles.cabecalhoIconeBotao}>
                <MaterialCommunityIcons name="chevron-left" size={24} color={cores.primaria} />
              </Pressable>
            ) : (
              <View style={styles.cabecalhoIconeCirculo}>
                {tipo?.icone ? (
                  <IconeTipoRegistro icone={tipo.icone} size={18} color={cores.primaria} />
                ) : (
                  <MaterialCommunityIcons name="plus" size={18} color={cores.primaria} />
                )}
              </View>
            )}
            <View style={styles.cabecalhoTextos}>
              <Text style={styles.cabecalhoTitulo} numberOfLines={1}>
                {tipo ? tipo.descricao : 'Tipo de registro'}
              </Text>
              {!!(produtoEfetivo ?? marcaAtual) && (
                <Text style={styles.cabecalhoSubtitulo} numberOfLines={1}>
                  {(produtoEfetivo ?? marcaAtual)!.descricao}
                </Text>
              )}
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={styles.cabecalhoFecharBotao}>
              <MaterialCommunityIcons name="close" size={16} color={neutro[700]} />
            </Pressable>
          </View>

          {!tipo && (
            <ScrollView contentContainerStyle={[styles.lista, { paddingBottom: espaco.lg + insets.bottom }]}>
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

          {tipo && modoLista && !produtoLista && (
            <ListaProdutosColeta
              produtos={listaGuiada}
              enviados={produtosColetados?.(tipo.id) ?? new Set<string>()}
              preenchidos={new Set(Object.keys(rascunhos))}
              paddingInferior={espaco.lg + insets.bottom}
              salvando={salvandoColeta}
              erro={erroColeta}
              onAbrir={abrirProdutoDaLista}
              onSalvar={() => void salvarColeta()}
            />
          )}

          {tipo && modoMarca && !marcaAtual && (
            <ListaMarcasColeta
              marcas={marcasDaColeta}
              embalagensPorMarca={embalagensPorMarca}
              permiteNova={tipo.permite_marca_nova ?? true}
              paddingInferior={espaco.lg + insets.bottom}
              onAbrir={abrirMarca}
              onNova={cadastrarMarca}
              onConcluir={onClose}
            />
          )}

          {tipo && pedeRecorte && !recorte && (
            <EscolhaRecorte
              permitidos={permitidos}
              recortesDoMix={recortesDoMix}
              produtosDoMixDoCampo={mixQueSegueQuery.data?.produtos ?? []}
              mix={mixDaLojaQuery.data}
              carregando={
                (campoQueSegue ? mixQueSegueQuery.isLoading : false) ||
                mixDaLojaQuery.isLoading ||
                secoesQuery.isLoading ||
                departamentosQuery.isLoading ||
                marcasQuery.isLoading
              }
              catalogo={{ SECAO: secoesQuery.data ?? [], DEPARTAMENTO: departamentosQuery.data ?? [], MARCA: marcasQuery.data ?? [] }}
              lista={tipo.lista_recorte ?? 'PRIMEIRO_DA_LOJA'}
              filtraMarca={!!tipo.filtra_marca}
              permitirAutoEscolha={!recorteJaEscolhidoRef.current}
              paddingInferior={espaco.lg + insets.bottom}
              onEscolher={escolherRecorte}
            />
          )}

          {tipo && !(modoLista && !produtoLista) && !(modoMarca && !marcaAtual) && !(pedeRecorte && !recorte) && (
            <>
              <ScrollView contentContainerStyle={styles.lista}>
                {modoMarca && marcaAtual && (
                  <CampoEmbalagem
                    quantidade={embalagemQuantidade}
                    unidade={embalagemUnidade}
                    onQuantidade={setEmbalagemQuantidade}
                    onUnidade={setEmbalagemUnidade}
                    precoPorLitro={
                      porReferencia
                        ? `${porReferencia.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} por ${porReferencia.referencia}`
                        : null
                    }
                    jaRegistradas={embalagensPorMarca.get(marcaAtual.uuid) ?? []}
                  />
                )}
                {recorte && (
                  <View style={styles.recorteFaixa}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.recorteFaixaTipo}>
                        {ROTULO_RECORTE[recorte.tipo]}
                        {recorte.marca ? ' · Marca' : ''}
                      </Text>
                      <Text style={styles.recorteFaixaNome} numberOfLines={1}>{descricaoRecorte(recorte)}</Text>
                    </View>
                    {!respostaAcompanhamento?.vinculo && (
                      <Pressable onPress={trocarRecorte} hitSlop={8} style={styles.recorteFaixaBotao}>
                        <Text style={styles.recorteFaixaBotaoTexto}>Trocar</Text>
                      </Pressable>
                    )}
                  </View>
                )}
                <View style={styles.secaoForm}>
                  <Text style={styles.secaoLabel}>
                    Fotos <Text style={styles.secaoLabelFraco}>· {imagensUri.length > 0 ? `${imagensUri.length} adicionada${imagensUri.length > 1 ? 's' : ''}` : tipo.exige_foto ? 'obrigatória' : 'opcional'}</Text>
                  </Text>
                  <View style={styles.fotosGrade}>
                    <Pressable
                      style={({ pressed }) => [styles.fotoTileCamera, pressed && { backgroundColor: indigo[100] }]}
                      onPress={() => void capturarFoto()}
                    >
                      <MaterialCommunityIcons name="camera-plus-outline" size={22} color={cores.primaria} />
                      <Text style={styles.fotoTileCameraTexto}>Câmera</Text>
                    </Pressable>
                    {imagensUri.map((uri, indice) => (
                      <View key={uri} style={styles.fotoTile}>
                        <Image source={{ uri }} style={styles.fotoTileImagem} />
                        <Pressable onPress={() => removerFoto(indice)} hitSlop={8} style={styles.fotoTileRemover}>
                          <MaterialCommunityIcons name="close" size={11} color={cores.branco} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                </View>

                {ruptura && camposVisiveis.length > 0 && (
                  <Text style={styles.contextoTexto}>Produto em ruptura — não precisa responder as perguntas.</Text>
                )}
                {!ruptura && camposVisiveis.map((campo) => (
                <View key={campo.id} style={campo.depende_de_chave ? styles.campoCondicional : undefined}>
                  <CampoInput
                    campo={campo}
                    valor={valoresCampos[campo.chave] ?? ''}
                    onChange={(valor) => definirValorCampo(campo.chave, valor)}
                    pontoVendaUuid={pontoVendaUuid}
                    recorte={campo.sortimento_segue_escolha ? recorte : null}
                    nomesPorUuid={produtosSortimentoPorUuid}
                    onProdutosResolvidos={(produtos) =>
                      setProdutosSortimentoPorUuid((atual) => ({
                        ...atual,
                        ...Object.fromEntries(produtos.map((p) => [p.produto_uuid, p.descricao])),
                      }))
                    }
                  />
                </View>
              ))}

              {!modoMarca && (
              <Pressable
                style={[styles.rupturaLinha, ruptura && styles.rupturaLinhaMarcada]}
                onPress={() => setRuptura((r) => !r)}
              >
                <View style={styles.rupturaTextos}>
                  <Text style={[styles.rupturaTitulo, ruptura && styles.rupturaTituloMarcado]}>Produto em ruptura</Text>
                  <Text style={styles.rupturaSubtitulo}>Não encontrado na gôndola nem no depósito</Text>
                </View>
                <View style={[styles.toggleTrilho, ruptura && styles.toggleTrilhoLigado]}>
                  <View style={[styles.toggleBola, ruptura && styles.toggleBolaLigada]} />
                </View>
              </Pressable>
              )}

              {!produtoEfetivo && !modoMarca && !pedeRecorte && !recorte && (tipo.permite_vincular_catalogo || exigeProduto) && (
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

            <View style={[styles.rodape, { paddingBottom: espaco.lg + insets.bottom }]}>
              {(erroLocal ?? erro) && <Text style={styles.erroTexto}>{erroLocal ?? erro}</Text>}
              <Pressable
                style={({ pressed }) => [
                  styles.botaoPrimario,
                  fotoObrigatoriaFaltando && styles.botaoPrimarioFraco,
                  pressed && styles.itemPressionado,
                ]}
                onPress={confirmar}
                disabled={enviando}
              >
                {enviando ? (
                  <ActivityIndicator color={cores.branco} />
                ) : (
                  <Text style={styles.botaoPrimarioTexto}>
                    {fotoObrigatoriaFaltando
                      ? 'Adicione uma foto'
                      : modoMarca
                        ? embalagemTexto
                          ? `Salvar ${embalagemTexto}`
                          : 'Salvar embalagem'
                        : produtoLista
                          ? 'Salvar produto'
                          : 'Salvar registro'}
                  </Text>
                )}
              </Pressable>
            </View>
          </>
        )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function CampoInput({
  campo,
  valor,
  onChange,
  pontoVendaUuid,
  recorte,
  nomesPorUuid,
  onProdutosResolvidos,
}: {
  campo: CampoTipoRegistro;
  valor: string;
  onChange: (valor: string) => void;
  pontoVendaUuid?: string;
  recorte: RecorteEscolhido | null;
  nomesPorUuid: Record<string, string>;
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
          recorte={recorte}
          nomesPorUuid={nomesPorUuid}
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
          <CampoDataInput valor={valor} onChange={onChange} alerta={situacao !== null} />
          {situacao === 'vencida' && <Text style={styles.textoDataVencida}>Data já vencida.</Text>}
          {situacao === 'proxima' && <Text style={styles.textoDataProxima}>Vencimento próximo.</Text>}
        </>
      ) : (
        <TextInput
          style={styles.input}
          value={valor}
          // Valor em R$: máscara de caixa registradora (só dígitos, a vírgula anda sozinha) — ver
          // lib/mascaraMoeda.ts. Número segue livre (quantidade pode ser inteira ou quebrada).
          onChangeText={campo.tipo_campo === 'MOEDA' ? (texto) => onChange(mascararMoeda(texto)) : onChange}
          keyboardType={campo.tipo_campo === 'MOEDA' ? 'number-pad' : campo.tipo_campo === 'NUMERO' ? 'decimal-pad' : 'default'}
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
 *
 * Mix que segue a escolha do promotor (docs/79): `recorte` filtra o mix da loja; departamento e
 * marca viram grupos que abrem e fecham; "Adicionar produto" busca no catálogo do recorte um
 * produto fora do mix (entra em `fora_do_mix`, sempre presente).
 */
function CampoSortimentoInput({
  campo,
  valor,
  onChange,
  pontoVendaUuid,
  recorte,
  nomesPorUuid,
  onProdutosResolvidos,
}: {
  campo: CampoTipoRegistro;
  valor: string;
  onChange: (valor: string) => void;
  pontoVendaUuid?: string;
  recorte: RecorteEscolhido | null;
  nomesPorUuid: Record<string, string>;
  onProdutosResolvidos: (produtos: ProdutoSortimento[]) => void;
}) {
  const query = useQuery({
    queryKey: ['sortimento-campo', campo.id, pontoVendaUuid],
    queryFn: () => buscarSortimentoCampo(campo.id, pontoVendaUuid!),
    enabled: !!pontoVendaUuid,
  });
  const [fechados, setFechados] = useState<Set<string>>(new Set());
  const [adicionando, setAdicionando] = useState(false);

  const produtos = useMemo(() => {
    const todos = query.data?.produtos ?? [];
    return campo.sortimento_segue_escolha && recorte ? produtosDoRecorte(todos, recorte, query.data?.recortes) : todos;
  }, [query.data, campo.sortimento_segue_escolha, recorte]);

  const estado: EstadoSortimento | null = valor ? (JSON.parse(valor) as EstadoSortimento) : null;
  const foraDoMix = estado?.fora_do_mix ?? [];

  useEffect(() => {
    if (query.data) onProdutosResolvidos(query.data.produtos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  // Nasce com tudo pré-marcado como presente — só semeia se ainda não tem resposta (não
  // sobrescreve o que o promotor já ajustou se o componente re-renderizar).
  useEffect(() => {
    if (query.data && !valor) {
      onChange(JSON.stringify({ presentes: produtos.map((p) => p.produto_uuid), ausentes: [] } satisfies EstadoSortimento));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, valor, produtos]);

  function alternarProduto(produtoUuid: string) {
    if (!estado) return;
    // Fora do mix: desmarcar tira da lista (o backend só aceita fora do mix entre os presentes).
    if (foraDoMix.includes(produtoUuid)) {
      onChange(
        JSON.stringify({
          ...estado,
          presentes: estado.presentes.filter((u) => u !== produtoUuid),
          fora_do_mix: foraDoMix.filter((u) => u !== produtoUuid),
        } satisfies EstadoSortimento),
      );
      return;
    }
    const estaPresente = estado.presentes.includes(produtoUuid);
    const novoEstado: EstadoSortimento = estaPresente
      ? { ...estado, presentes: estado.presentes.filter((u) => u !== produtoUuid), ausentes: [...estado.ausentes, produtoUuid] }
      : { ...estado, presentes: [...estado.presentes, produtoUuid], ausentes: estado.ausentes.filter((u) => u !== produtoUuid) };
    onChange(JSON.stringify(novoEstado));
  }

  function adicionarForaDoMix(produto: { id: string; descricao: string }) {
    const atual = estado ?? { presentes: [], ausentes: [] };
    onProdutosResolvidos([{ produto_uuid: produto.id, descricao: produto.descricao } as ProdutoSortimento]);
    onChange(
      JSON.stringify({
        ...atual,
        presentes: [...atual.presentes, produto.id],
        ausentes: atual.ausentes.filter((u) => u !== produto.id),
        fora_do_mix: [...(atual.fora_do_mix ?? []), produto.id],
      } satisfies EstadoSortimento),
    );
    setAdicionando(false);
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

  const podeAdicionar = !!campo.sortimento_segue_escolha && !!recorte;

  if (produtos.length === 0 && !podeAdicionar) {
    return <Text style={styles.vazioTexto}>Nenhum produto no mix deste PDV pra este recorte.</Text>;
  }

  const linha = (produto: { produto_uuid: string; descricao: string }, fora: boolean) => {
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
        <Text style={[styles.subListaItemTexto, { flex: 1 }]}>{produto.descricao}</Text>
        {fora && <Text style={styles.etiquetaForaDoMix}>fora do mix</Text>}
      </Pressable>
    );
  };

  const grupos = recorte && campo.sortimento_segue_escolha ? agruparChecklist(produtos, recorte.tipo) : agruparChecklist(produtos, 'SECAO');
  const presentesNoGrupo = (g: { produtos: ProdutoSortimento[] }) =>
    g.produtos.filter((p) => estado?.presentes.includes(p.produto_uuid) ?? true).length;

  return (
    <View style={styles.subListaBox}>
      <ScrollView style={styles.subLista} nestedScrollEnabled>
        {produtos.length === 0 && <Text style={styles.vazioTexto}>A loja não tem produtos desta parte no mix.</Text>}
        {grupos.map((g) =>
          g.titulo === '' ? (
            g.produtos.map((p) => linha(p, false))
          ) : (
            <View key={g.chave}>
              <Pressable
                style={styles.grupoChecklistCabecalho}
                onPress={() =>
                  setFechados((atual) => {
                    const novo = new Set(atual);
                    if (novo.has(g.chave)) novo.delete(g.chave);
                    else novo.add(g.chave);
                    return novo;
                  })
                }
              >
                <View style={{ flex: 1 }}>
                  {g.supertitulo && <Text style={styles.grupoChecklistSupertitulo}>{g.supertitulo}</Text>}
                  <Text style={styles.grupoChecklistTitulo}>{g.titulo}</Text>
                </View>
                <Text style={styles.grupoChecklistContagem}>
                  {presentesNoGrupo(g)}/{g.produtos.length}
                </Text>
                <MaterialCommunityIcons name={fechados.has(g.chave) ? 'chevron-down' : 'chevron-up'} size={20} color={neutro[700]} />
              </Pressable>
              {!fechados.has(g.chave) && g.produtos.map((p) => linha(p, false))}
            </View>
          ),
        )}
        {foraDoMix.map((uuid) => linha({ produto_uuid: uuid, descricao: nomesPorUuid[uuid] ?? 'Produto adicionado' }, true))}
      </ScrollView>
      {podeAdicionar && !adicionando && (
        <Pressable style={styles.botaoAdicionarProduto} onPress={() => setAdicionando(true)}>
          <MaterialCommunityIcons name="plus" size={16} color={cores.primaria} />
          <Text style={styles.botaoAdicionarProdutoTexto}>Adicionar produto fora do mix</Text>
        </Pressable>
      )}
      {podeAdicionar && adicionando && recorte && (
        <BuscaProdutoForaDoMix
          recorte={recorte}
          jaNaLista={new Set([...produtos.map((p) => p.produto_uuid), ...foraDoMix])}
          onEscolher={adicionarForaDoMix}
          onCancelar={() => setAdicionando(false)}
        />
      )}
    </View>
  );
}

/** Busca no catálogo, dentro do recorte escolhido, um produto que não está no mix (docs/79 decisão 8). Precisa de rede. */
function BuscaProdutoForaDoMix({
  recorte,
  jaNaLista,
  onEscolher,
  onCancelar,
}: {
  recorte: RecorteEscolhido;
  jaNaLista: ReadonlySet<string>;
  onEscolher: (produto: { id: string; descricao: string }) => void;
  onCancelar: () => void;
}) {
  const [busca, setBusca] = useState('');
  const query = useQuery({
    queryKey: ['catalogo-fora-do-mix', recorte.tipo, recorte.uuid, recorte.marca?.uuid, busca.trim()],
    queryFn: () =>
      listarProdutosCatalogo({
        busca: busca.trim(),
        secaoUuid: recorte.tipo === 'SECAO' ? recorte.uuid : null,
        departamentoUuid: recorte.tipo === 'DEPARTAMENTO' ? recorte.uuid : null,
        marcaUuid: recorte.tipo === 'MARCA' ? recorte.uuid : (recorte.marca?.uuid ?? null),
      }),
    enabled: busca.trim().length >= 2,
  });
  const resultados = (query.data?.produtos ?? []).filter((p) => !jaNaLista.has(p.id));

  return (
    <View style={styles.buscaForaDoMix}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: espaco.sm }}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={busca}
          onChangeText={setBusca}
          placeholder={`Buscar em ${descricaoRecorte(recorte)}`}
          autoFocus
        />
        <Pressable onPress={onCancelar} hitSlop={8}>
          <Text style={styles.recorteFaixaBotaoTexto}>Cancelar</Text>
        </Pressable>
      </View>
      {busca.trim().length < 2 && <Text style={styles.vazioTexto}>Digite pelo menos 2 letras.</Text>}
      {query.isFetching && <ActivityIndicator color={cores.primaria} style={{ padding: 8 }} />}
      {query.isError && <Text style={styles.textoDataVencida}>Sem conexão — a busca precisa de internet.</Text>}
      {query.isSuccess && resultados.length === 0 && <Text style={styles.vazioTexto}>Nenhum produto encontrado.</Text>}
      {resultados.map((p) => (
        <Pressable
          key={p.id}
          style={({ pressed }) => [styles.subListaItem, pressed && styles.itemPressionado]}
          onPress={() => onEscolher({ id: p.id, descricao: p.descricao })}
        >
          <Text style={styles.subListaItemTexto}>{p.descricao}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** "Onde é?" — antes das perguntas, o promotor escolhe marca/departamento/seção (docs/79 decisão 3). */
function EscolhaRecorte({
  permitidos,
  recortesDoMix,
  produtosDoMixDoCampo,
  mix,
  catalogo,
  carregando,
  lista,
  filtraMarca,
  permitirAutoEscolha,
  paddingInferior,
  onEscolher,
}: {
  permitidos: TipoRecorte[];
  recortesDoMix: RecortesDoMix | undefined;
  produtosDoMixDoCampo: ProdutoSortimento[];
  // Mix da loja em cache (docs/82 §5.1): fonte do bloco "Na loja", offline.
  mix: SortimentoPontoVenda[] | undefined;
  catalogo: Record<TipoRecorte, CatalogoItem[]>;
  carregando: boolean;
  lista: 'PRIMEIRO_DA_LOJA' | 'SO_DA_LOJA';
  filtraMarca: boolean;
  // Só na primeira abertura: depois de um "Trocar", nunca escolhe sozinho de novo.
  permitirAutoEscolha: boolean;
  paddingInferior: number;
  onEscolher: (recorte: RecorteEscolhido) => void;
}) {
  const aprovados = useMemo(() => mixAprovado(mix), [mix]);
  // Loja sem Mix: "Só o que a loja tem" libera a lista inteira (decisão 5: nunca trava).
  const mixVazio = aprovados.length === 0 && !recortesDoMix?.secoes.length && !recortesDoMix?.departamentos.length && !recortesDoMix?.marcas.length;
  const soDaLoja = lista === 'SO_DA_LOJA' && !mixVazio;

  const porAba = useMemo(() => {
    const resultado = {} as Record<TipoRecorte, { naLoja: OpcaoRecorte[]; outras: OpcaoRecorte[] }>;
    for (const a of permitidos) {
      const todas = opcoesDaAba(a, catalogo[a], recortesDoMix);
      const naLoja = todas.filter((o) => estaNaLoja(a, o, aprovados, recortesDoMix));
      const naLojaUuids = new Set(naLoja.map((o) => o.uuid));
      resultado[a] = { naLoja, outras: todas.filter((o) => !naLojaUuids.has(o.uuid)) };
    }
    return resultado;
  }, [permitidos, catalogo, recortesDoMix, aprovados]);

  // Aba inicial: a primeira liberada que tenha algo "Na loja".
  const abaInicial = permitidos.find((a) => porAba[a].naLoja.length > 0) ?? (permitidos.includes('DEPARTAMENTO') ? 'DEPARTAMENTO' : permitidos[0]);
  const [abaEscolhida, setAba] = useState<TipoRecorte | null>(null);
  const aba = abaEscolhida ?? abaInicial;
  const [outrasAbertas, setOutrasAbertas] = useState(false);
  const [busca, setBusca] = useState('');
  // Passo 2 (docs/82 §5.2): seção/departamento escolhido, esperando a marca.
  const [pendente, setPendente] = useState<RecorteEscolhido | null>(null);

  function escolher(recorte: RecorteEscolhido) {
    if (filtraMarca && recorte.tipo !== 'MARCA') setPendente(recorte);
    else onEscolher(recorte);
  }

  // Uma opção só "Na loja" (decisão 3): já vem escolhida.
  const autoEscolhaFeita = useRef(false);
  useEffect(() => {
    if (!permitirAutoEscolha || carregando || autoEscolhaFeita.current) return;
    autoEscolhaFeita.current = true;
    const unicas = permitidos.flatMap((a) => porAba[a].naLoja.map((o) => ({ a, o })));
    if (unicas.length === 1) escolher({ tipo: unicas[0].a, uuid: unicas[0].o.uuid, descricao: unicas[0].o.descricao });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregando, permitirAutoEscolha]);

  if (pendente) {
    return (
      <PassoMarca
        recorte={pendente}
        marcas={marcasNaLoja(pendente, produtosDoMixDoCampo, aprovados, catalogo.MARCA)}
        catalogoMarcas={soDaLoja ? [] : catalogo.MARCA}
        paddingInferior={paddingInferior}
        onVoltar={() => setPendente(null)}
        onConfirmar={(marca) => onEscolher({ ...pendente, marca })}
      />
    );
  }

  const { naLoja, outras } = porAba[aba];
  const termo = busca.trim().toLowerCase();
  const outrasFiltradas = termo ? outras.filter((o) => o.descricao.toLowerCase().includes(termo)) : outras;
  // Sem nada "Na loja" (ou loja sem Mix), a lista inteira já aparece aberta.
  const mostrarOutrasDireto = naLoja.length === 0;

  const linha = (o: OpcaoRecorte, naLojaItem: boolean) => (
    <Pressable
      key={o.uuid}
      style={({ pressed }) => [styles.tipoCard, pressed && styles.itemPressionado]}
      onPress={() => escolher({ tipo: aba, uuid: o.uuid, descricao: o.descricao })}
    >
      <View style={styles.tipoCardConteudo}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.tipoNome}>{o.descricao}</Text>
          {aba === 'SECAO' && o.departamento?.descricao ? <Text style={styles.recorteOpcaoSub}>{o.departamento.descricao}</Text> : null}
        </View>
        {naLojaItem && (
          <View style={styles.seloNaLoja}>
            <Text style={styles.seloNaLojaTexto}>Na loja</Text>
          </View>
        )}
        <MaterialCommunityIcons name="chevron-right" size={20} color={neutro[700]} />
      </View>
    </Pressable>
  );

  return (
    <ScrollView contentContainerStyle={[styles.lista, { paddingBottom: paddingInferior }]} keyboardShouldPersistTaps="handled">
      <Text style={styles.escolhaTitulo}>Onde é este registro?</Text>
      <Text style={styles.escolhaSubtitulo}>Escolha a parte da loja. As perguntas e o checklist valem pra ela.</Text>
      {permitidos.length > 1 && (
        <View style={styles.abasRecorte}>
          {permitidos.map((t) => (
            <Pressable key={t} style={[styles.abaRecorte, aba === t && styles.abaRecorteAtiva]} onPress={() => setAba(t)}>
              <Text style={[styles.abaRecorteTexto, aba === t && styles.abaRecorteTextoAtivo]}>{ROTULO_RECORTE[t]}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {carregando && <ActivityIndicator color={cores.primaria} style={{ padding: 12 }} />}
      {lista === 'SO_DA_LOJA' && mixVazio && !carregando && (
        <Text style={styles.avisoRecorte}>Esta loja não tem Mix cadastrado. Mostrando a lista inteira.</Text>
      )}

      {naLoja.length > 0 && (
        <>
          <Text style={styles.blocoRecorteTitulo}>Na loja · {naLoja.length}</Text>
          {naLoja.map((o) => linha(o, true))}
        </>
      )}

      {!soDaLoja && (outras.length > 0 || busca !== '') && (
        <>
          {!mostrarOutrasDireto && (
            <Pressable style={styles.blocoRecorteToggle} onPress={() => setOutrasAbertas((v) => !v)} hitSlop={6}>
              <Text style={styles.blocoRecorteTitulo}>Outras · {outras.length}</Text>
              <MaterialCommunityIcons name={outrasAbertas ? 'chevron-up' : 'chevron-down'} size={20} color={neutro[700]} />
            </Pressable>
          )}
          {(outrasAbertas || mostrarOutrasDireto) && (
            <>
              <TextInput
                style={[styles.input, { marginBottom: espaco.sm }]}
                value={busca}
                onChangeText={setBusca}
                placeholder={`Buscar ${ROTULO_RECORTE[aba].toLowerCase()}`}
                placeholderTextColor={cores.textoTerciario}
              />
              {outrasFiltradas.map((o) => linha(o, false))}
            </>
          )}
        </>
      )}

      {!carregando && naLoja.length === 0 && (soDaLoja || outras.length === 0) && (
        <Text style={styles.vazioTexto}>Nada desta loja pra escolher aqui.</Text>
      )}
    </ScrollView>
  );
}

/** Passo 2 (docs/82 §5.2): marca depois da seção/departamento, com "Todas" já marcado. */
function PassoMarca({
  recorte,
  marcas,
  catalogoMarcas,
  paddingInferior,
  onVoltar,
  onConfirmar,
}: {
  recorte: RecorteEscolhido;
  marcas: { uuid: string; descricao: string }[];
  // Vazio = "Só o que a loja tem": sem "Outra marca".
  catalogoMarcas: CatalogoItem[];
  paddingInferior: number;
  onVoltar: () => void;
  onConfirmar: (marca: { uuid: string; descricao: string } | null) => void;
}) {
  const [marca, setMarca] = useState<{ uuid: string; descricao: string } | null>(null);
  const [buscandoOutra, setBuscandoOutra] = useState(false);
  const [busca, setBusca] = useState('');
  const naLoja = new Set(marcas.map((m) => m.uuid));
  const termo = busca.trim().toLowerCase();
  const outras = catalogoMarcas
    .filter((m) => !naLoja.has(m.id) && (!termo || m.descricao.toLowerCase().includes(termo)))
    .sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'));
  const marcaForaDaLoja = marca && !naLoja.has(marca.uuid) ? marca : null;

  const chip = (chave: string, rotulo: string, ativo: boolean, onPress: () => void) => (
    <Pressable key={chave} onPress={onPress} style={[styles.chipMarca, ativo && styles.chipMarcaAtivo]}>
      <Text style={[styles.chipMarcaTexto, ativo && styles.chipMarcaTextoAtivo]}>{rotulo}</Text>
    </Pressable>
  );

  return (
    <ScrollView contentContainerStyle={[styles.lista, { paddingBottom: paddingInferior }]} keyboardShouldPersistTaps="handled">
      <Text style={styles.escolhaTitulo}>Qual marca?</Text>
      <Text style={styles.escolhaSubtitulo}>
        Em {recorte.descricao}. Deixe em Todas se o registro não for de uma marca só.
      </Text>
      <View style={styles.chipsMarca}>
        {chip('todas', 'Todas', marca === null, () => setMarca(null))}
        {marcas.map((m) => chip(m.uuid, m.descricao, marca?.uuid === m.uuid, () => setMarca(m)))}
        {marcaForaDaLoja && chip(marcaForaDaLoja.uuid, marcaForaDaLoja.descricao, true, () => setMarca(marcaForaDaLoja))}
        {catalogoMarcas.length > 0 && chip('outra', 'Outra marca', false, () => setBuscandoOutra((v) => !v))}
      </View>
      {buscandoOutra && (
        <>
          <TextInput
            style={[styles.input, { marginTop: espaco.sm }]}
            value={busca}
            onChangeText={setBusca}
            placeholder="Buscar marca"
            placeholderTextColor={cores.textoTerciario}
            autoFocus
          />
          {outras.slice(0, 30).map((m) => (
            <Pressable
              key={m.id}
              style={({ pressed }) => [styles.tipoCard, pressed && styles.itemPressionado]}
              onPress={() => {
                setMarca({ uuid: m.id, descricao: m.descricao });
                setBuscandoOutra(false);
                setBusca('');
              }}
            >
              <View style={styles.tipoCardConteudo}>
                <Text style={[styles.tipoNome, { flex: 1 }]}>{m.descricao}</Text>
              </View>
            </Pressable>
          ))}
        </>
      )}
      <Pressable style={({ pressed }) => [styles.botaoContinuarMarca, pressed && { opacity: 0.85 }]} onPress={() => onConfirmar(marca)}>
        <Text style={styles.botaoContinuarMarcaTexto}>Continuar</Text>
      </Pressable>
      <Pressable style={styles.voltarMarca} onPress={onVoltar} hitSlop={8}>
        <Text style={styles.voltarMarcaTexto}>Voltar</Text>
      </Pressable>
    </ScrollView>
  );
}

/** Insere as barras automaticamente conforme o promotor digita — nunca um calendário nativo, ver docs/20-FORMULARIO-DINAMICO-CAMPANHA.md decisão 2. */
const MASCARA_DATA = '__/__/____';
// Posição de cada dígito dentro da máscara (pula as barras).
const POSICOES_DIGITO_DATA = [0, 1, 3, 4, 6, 7, 8, 9];

function formatarDataDigitada(digitos: string): string {
  if (digitos.length <= 2) return digitos;
  if (digitos.length <= 4) return `${digitos.slice(0, 2)}/${digitos.slice(2)}`;
  return `${digitos.slice(0, 2)}/${digitos.slice(2, 4)}/${digitos.slice(4)}`;
}

/** "120" → "12/0_/____" — o promotor vê o formato inteiro enquanto digita. */
function aplicarMascaraData(digitos: string): string {
  const chars = MASCARA_DATA.split('');
  digitos.split('').forEach((d, i) => {
    chars[POSICOES_DIGITO_DATA[i]] = d;
  });
  return chars.join('');
}

/**
 * Campo DATA com máscara visível __/__/____ (dd/mm/aaaa). O valor guardado continua sendo só o
 * que foi digitado ("12/0", "12/03/2026") — os "_" são apenas exibição, então validar/situacaoData
 * não mudam. O cursor fica preso logo depois do último dígito: backspace apaga dígito, nunca "_".
 */
function CampoDataInput({ valor, onChange, alerta }: { valor: string; onChange: (valor: string) => void; alerta: boolean }) {
  const [focado, setFocado] = useState(false);
  const digitos = valor.replace(/\D/g, '').slice(0, 8);
  const exibido = focado || digitos ? aplicarMascaraData(digitos) : '';
  const cursor = digitos.length === 0 ? 0 : POSICOES_DIGITO_DATA[digitos.length - 1] + 1;

  function aoDigitar(texto: string) {
    let novos = texto.replace(/\D/g, '').slice(0, 8);
    // Backspace em cima de uma "/" não remove dígito nenhum — trata como apagar o último.
    if (texto.length < exibido.length && novos === digitos) novos = novos.slice(0, -1);
    onChange(formatarDataDigitada(novos));
  }

  return (
    <TextInput
      style={[styles.input, alerta && styles.inputDataAlerta]}
      value={exibido}
      onChangeText={aoDigitar}
      selection={focado ? { start: cursor, end: cursor } : undefined}
      onFocus={() => setFocado(true)}
      onBlur={() => setFocado(false)}
      keyboardType="number-pad"
      placeholder={MASCARA_DATA}
      placeholderTextColor={cores.textoTerciario}
      maxLength={MASCARA_DATA.length + 1}
    />
  );
}

function dataValida(valor: string): boolean {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor);
  if (!match) return false;
  const [dia, mes, ano] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const data = new Date(ano, mes - 1, dia);
  return data.getDate() === dia && data.getMonth() === mes - 1 && data.getFullYear() === ano;
}

/**
 * `valor` já passou por dataValida() antes de chegar aqui — ver docs/35-LIMITE-RETROATIVO-
 * CAMPO-DATA.md (mesma regra do backend, StoreVisitaRegistroRequest::dentroDoLimiteRetroativo).
 * Data futura nunca é rejeitada por este limite, só controla o quanto pro passado é aceito.
 */
function dentroDoLimiteRetroativo(valor: string, limiteDias: number): boolean {
  const [dia, mes, ano] = valor.split('/').map(Number);
  const data = new Date(ano, mes - 1, dia);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const maisAntigaAceita = new Date(hoje);
  maisAntigaAceita.setDate(maisAntigaAceita.getDate() - limiteDias);
  return data.getTime() >= maisAntigaAceita.getTime();
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

// Coleta guiada (lista predefinida de produtos do formulário): um card por produto — verde quando
// já preenchido (rascunho) ou enviado, cinza quando falta — selo PENDENTE/CONCLUÍDO no topo e o
// "Salvar" no fim, que só libera com todos preenchidos e aí sim manda tudo pra fila de envio.
function ListaProdutosColeta({
  produtos,
  enviados,
  preenchidos,
  paddingInferior,
  salvando,
  erro,
  onAbrir,
  onSalvar,
}: {
  produtos: { id: string; descricao: string; codigo_externo: string | null; codigo_barras: string | null }[];
  enviados: ReadonlySet<string>;
  preenchidos: ReadonlySet<string>;
  paddingInferior: number;
  salvando: boolean;
  erro: string | null;
  onAbrir: (produto: { uuid: string; descricao: string }) => void;
  onSalvar: () => void;
}) {
  const feitos = produtos.filter((p) => enviados.has(p.id) || preenchidos.has(p.id)).length;
  const faltam = produtos.length - feitos;
  const paraEnviar = produtos.filter((p) => !enviados.has(p.id) && preenchidos.has(p.id)).length;
  const tudoEnviado = produtos.every((p) => enviados.has(p.id));

  return (
    <>
      <ScrollView contentContainerStyle={styles.lista}>
        <View style={styles.coletaTopo}>
          <Text style={styles.coletaProgresso}>
            {feitos} de {produtos.length} produto{produtos.length === 1 ? '' : 's'} preenchido{feitos === 1 ? '' : 's'}
          </Text>
          <View style={[styles.coletaSelo, tudoEnviado ? styles.coletaSeloConcluido : styles.coletaSeloPendente]}>
            <Text style={[styles.coletaSeloTexto, tudoEnviado ? styles.coletaSeloTextoConcluido : styles.coletaSeloTextoPendente]}>
              {tudoEnviado ? 'CONCLUÍDO' : 'PENDENTE'}
            </Text>
          </View>
        </View>
        <Text style={styles.coletaInstrucao}>Preencha cada produto e toque em Salvar no fim da lista.</Text>
        {produtos.map((p) => {
          const enviado = enviados.has(p.id);
          const feito = enviado || preenchidos.has(p.id);
          return (
            <Pressable
              key={p.id}
              style={({ pressed }) => [styles.coletaCard, feito && styles.coletaCardFeito, pressed && styles.itemPressionado]}
              onPress={() => onAbrir({ uuid: p.id, descricao: p.descricao })}
            >
              <View style={styles.coletaCardTextos}>
                <Text style={styles.coletaCardNome} numberOfLines={1}>
                  {p.descricao}
                </Text>
                {enviado ? (
                  <Text style={styles.coletaCardCodigo}>Enviado</Text>
                ) : (
                  !!(p.codigo_externo ?? p.codigo_barras) && (
                    <Text style={styles.coletaCardCodigo}>{p.codigo_externo ?? p.codigo_barras}</Text>
                  )
                )}
              </View>
              <View style={[styles.coletaStatus, feito ? styles.coletaStatusFeito : styles.coletaStatusPendente]}>
                {feito && <MaterialCommunityIcons name="check" size={14} color={cores.branco} />}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      {!tudoEnviado && (
        <View style={[styles.rodape, { paddingBottom: paddingInferior }]}>
          {erro && <Text style={styles.erroTexto}>{erro}</Text>}
          <Pressable
            style={({ pressed }) => [
              styles.botaoPrimario,
              (faltam > 0 || paraEnviar === 0) && styles.botaoPrimarioFraco,
              pressed && styles.itemPressionado,
            ]}
            onPress={onSalvar}
            disabled={faltam > 0 || paraEnviar === 0 || salvando}
          >
            {salvando ? (
              <ActivityIndicator color={cores.branco} />
            ) : (
              <Text style={styles.botaoPrimarioTexto}>
                {faltam > 0 ? `Salvar (falta${faltam === 1 ? '' : 'm'} ${faltam})` : 'Salvar'}
              </Text>
            )}
          </Pressable>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  // docs/79 — "Onde é?", faixa do recorte escolhido e checklist agrupado.
  recorteFaixa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm,
    backgroundColor: cores.primariaClara,
    borderRadius: raio.lg,
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
    marginBottom: espaco.md,
  },
  recorteFaixaTipo: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', color: cores.primaria },
  recorteFaixaNome: { fontSize: 15, fontWeight: '700', color: cores.texto },
  recorteFaixaBotao: { backgroundColor: cores.fundoCard, borderRadius: raio.md, paddingHorizontal: espaco.md, minHeight: 40, justifyContent: 'center' },
  recorteFaixaBotaoTexto: { fontSize: 13, fontWeight: '600', color: cores.primaria },
  escolhaTitulo: { fontSize: 18, fontWeight: '700', color: cores.texto },
  // docs/82 — blocos "Na loja"/"Outras", selo, aviso e passo da marca.
  blocoRecorteTitulo: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', color: neutro[500], marginTop: espaco.sm, marginBottom: 6 },
  blocoRecorteToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40 },
  recorteOpcaoSub: { fontSize: 12, color: cores.textoTerciario, marginTop: 1 },
  seloNaLoja: { backgroundColor: cores.sucessoFundo, borderRadius: raio.pill, paddingHorizontal: 8, paddingVertical: 2, marginRight: 4 },
  seloNaLojaTexto: { fontSize: 11, fontWeight: '700', color: cores.sucesso },
  avisoRecorte: { fontSize: 13, color: cores.acentoTexto, backgroundColor: cores.acentoClaro, borderRadius: raio.md, padding: espaco.md, marginBottom: espaco.sm },
  chipsMarca: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.sm },
  chipMarca: { minHeight: 40, paddingHorizontal: espaco.md, borderRadius: raio.pill, borderWidth: 1, borderColor: cores.borda, backgroundColor: cores.fundoCard, justifyContent: 'center' },
  chipMarcaAtivo: { backgroundColor: cores.primaria, borderColor: cores.primaria },
  chipMarcaTexto: { fontSize: 14, fontWeight: '600', color: neutro[700] },
  chipMarcaTextoAtivo: { color: cores.branco },
  botaoContinuarMarca: { minHeight: 52, borderRadius: raio.md, backgroundColor: cores.primaria, alignItems: 'center', justifyContent: 'center', marginTop: espaco.lg },
  botaoContinuarMarcaTexto: { fontSize: 16, fontWeight: '700', color: cores.branco },
  voltarMarca: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  voltarMarcaTexto: { fontSize: 14, fontWeight: '600', color: cores.textoSecundario },
  escolhaSubtitulo: { fontSize: 13, color: cores.textoTerciario, marginTop: 4, marginBottom: espaco.md },
  abasRecorte: { flexDirection: 'row', gap: 4, backgroundColor: neutro[100], padding: 4, borderRadius: raio.md, marginBottom: espaco.md },
  abaRecorte: { flex: 1, minHeight: 40, borderRadius: raio.sm, alignItems: 'center', justifyContent: 'center' },
  abaRecorteAtiva: { backgroundColor: cores.fundoCard },
  abaRecorteTexto: { fontSize: 14, fontWeight: '600', color: neutro[700] },
  abaRecorteTextoAtivo: { color: cores.texto },
  grupoChecklistCabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm,
    paddingVertical: espaco.sm,
    paddingHorizontal: 4,
    minHeight: 44,
    borderBottomWidth: 1,
    borderBottomColor: cores.borda,
  },
  grupoChecklistSupertitulo: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: cores.textoTerciario,
    marginTop: espaco.sm,
  },
  grupoChecklistTitulo: { fontSize: 14, fontWeight: '700', color: cores.texto },
  grupoChecklistContagem: { fontSize: 12, fontWeight: '600', color: cores.textoTerciario },
  etiquetaForaDoMix: {
    fontSize: 11,
    fontWeight: '600',
    color: cores.primaria,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: cores.primaria,
    borderRadius: raio.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  botaoAdicionarProduto: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: espaco.md, minHeight: 44 },
  botaoAdicionarProdutoTexto: { fontSize: 14, fontWeight: '600', color: cores.primaria },
  buscaForaDoMix: { padding: espaco.sm, gap: espaco.sm, borderTopWidth: 1, borderTopColor: cores.borda },
  coletaTopo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: espaco.xs },
  coletaProgresso: { ...tipografia.destaque, color: cores.texto },
  coletaSelo: { borderRadius: raio.pill, paddingHorizontal: 10, paddingVertical: 3 },
  coletaSeloPendente: { backgroundColor: neutro[900] },
  coletaSeloConcluido: { backgroundColor: cores.sucessoFundo },
  coletaSeloTexto: { ...tipografia.legenda },
  coletaSeloTextoPendente: { color: cores.branco },
  coletaSeloTextoConcluido: { color: cores.sucesso },
  coletaInstrucao: { ...tipografia.corpoSecundario, color: cores.textoSecundario, marginBottom: 0},
  coletaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.xs,
    backgroundColor: cores.fundoCard,
    borderRadius: raio.sm,
    borderWidth: 1,
    borderColor: cores.borda,
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.md,
    marginBottom: 0,
  },
  coletaCardFeito: { borderColor: cores.sucesso },
  coletaCardTextos: { flex: 1 },
  coletaCardNome: { fontSize: 14, fontWeight: '600', color: cores.texto },
  coletaCardCodigo: { fontSize: 11, color: cores.textoSecundario },
  coletaStatus: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  coletaStatusFeito: { backgroundColor: cores.sucesso },
  coletaStatusPendente: { backgroundColor: indigo[100] },
  backdropContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(17,24,39,0.45)',
  },
  sheet: {
    maxHeight: '92%',
    backgroundColor: cores.fundoCard,
    borderTopLeftRadius: raio.xl,
    borderTopRightRadius: raio.xl,
    overflow: 'hidden',
  },
  alcaWrap: {
    alignItems: 'center',
    paddingTop: espaco.sm,
  },
  alca: {
    width: 40,
    height: 5,
    borderRadius: raio.pill,
    backgroundColor: neutro[300],
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingHorizontal: espaco.lg,
    paddingTop: espaco.sm,
    paddingBottom: espaco.md,
    borderBottomWidth: 1,
    borderBottomColor: cores.divisor,
  },
  cabecalhoIconeBotao: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cabecalhoIconeCirculo: {
    width: 40,
    height: 40,
    borderRadius: raio.md,
    backgroundColor: cores.primariaClara,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cabecalhoTextos: {
    flex: 1,
    minWidth: 0,
  },
  cabecalhoTitulo: {
    fontSize: 17,
    fontWeight: '700',
    color: cores.texto,
  },
  cabecalhoSubtitulo: {
    fontSize: 13,
    color: cores.textoSecundario,
  },
  cabecalhoFecharBotao: {
    width: 36,
    height: 36,
    borderRadius: raio.pill,
    backgroundColor: neutro[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  lista: {
    padding: espaco.lg,
    gap: espaco.sm,
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
  secaoLabelFraco: {
    fontWeight: '500',
    color: cores.textoTerciario,
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
  fotosGrade: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: espaco.sm,
  },
  fotoTileCamera: {
    width: 72,
    height: 72,
    borderRadius: raio.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: indigo[300],
    backgroundColor: cores.primariaClara,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  fotoTileCameraTexto: {
    fontSize: 11,
    fontWeight: '700',
    color: cores.primariaEscura,
  },
  fotoTile: {
    width: 72,
    height: 72,
    borderRadius: raio.md,
    overflow: 'visible',
  },
  fotoTileImagem: {
    width: '100%',
    height: '100%',
    borderRadius: raio.md,
  },
  fotoTileRemover: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: raio.pill,
    borderWidth: 2,
    borderColor: cores.branco,
    backgroundColor: neutro[900],
    alignItems: 'center',
    justifyContent: 'center',
  },
  rupturaLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    padding: espaco.md,
    borderRadius: raio.lg,
    borderWidth: 1,
    borderColor: cores.borda,
    backgroundColor: cores.fundoCard,
  },
  rupturaLinhaMarcada: {
    borderColor: cores.erroBorda,
    backgroundColor: cores.erroFundo,
  },
  rupturaTextos: {
    flex: 1,
  },
  rupturaTitulo: {
    fontSize: 15,
    fontWeight: '700',
    color: cores.texto,
  },
  rupturaTituloMarcado: {
    color: cores.erro,
  },
  rupturaSubtitulo: {
    fontSize: 12,
    color: cores.textoSecundario,
    marginTop: 1,
  },
  toggleTrilho: {
    width: 46,
    height: 28,
    borderRadius: raio.pill,
    backgroundColor: neutro[300],
    padding: 3,
  },
  toggleTrilhoLigado: {
    backgroundColor: cores.erro,
  },
  toggleBola: {
    width: 22,
    height: 22,
    borderRadius: raio.pill,
    backgroundColor: cores.branco,
  },
  toggleBolaLigada: {
    transform: [{ translateX: 18 }],
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
  },
  botaoPrimarioFraco: {
    backgroundColor: indigo[300],
  },
  botaoPrimarioTexto: {
    color: cores.branco,
    fontSize: 15,
    fontWeight: '700',
  },
});
