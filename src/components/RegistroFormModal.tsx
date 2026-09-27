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
import { buscarSortimentoCampo, type ProdutoSortimento } from '../lib/api/campoSortimento';
import { listarDepartamentos, listarMarcas, listarSecoes } from '../lib/api/catalogo';
import { apagarImagemPersistente, copiarImagemParaArmazenamentoPersistente } from '../lib/db/filaRegistros';
import { lerRascunhosColeta, salvarRascunhosColeta, type RascunhoProduto, type RascunhosColeta } from '../lib/db/rascunhosColeta';
import { mascararMoeda, moedaParaApi } from '../lib/mascaraMoeda';
import type { CampoTipoRegistro, CatalogoItem, ProdutoDisponivel, TipoRegistro, TipoVinculoRegistro } from '../types/api';
import { cores, espaco, indigo, neutro, raio, sombraCard, tipografia } from '../theme';

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
  // Nome do produto vinculado — pro registro na fila local mostrar o nome mesmo offline (produto
  // da lista predefinida pode nem estar no mix da loja, então não dá pra achar por lá).
  produtoDescricao?: string;
  // Coleta guiada por lista de produtos: depois de salvar, o modal volta pra lista em vez de
  // fechar — o pai não deve fechar o modal no sucesso.
  permanecerAberto?: boolean;
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
  const [categoriaAberta, setCategoriaAberta] = useState<Categoria | null>(null);
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  // Coleta guiada: produto da lista predefinida que está sendo respondido agora (null = na lista).
  const [produtoLista, setProdutoLista] = useState<{ uuid: string; descricao: string } | null>(null);
  // Rascunho da coleta guiada — produto por produto, só vira registro no "Salvar" final da lista.
  const [rascunhos, setRascunhos] = useState<RascunhosColeta>({});
  const [salvandoColeta, setSalvandoColeta] = useState(false);
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
      setValoresCampos({});
      setProdutosSortimentoPorUuid({});
      setImagensUri([]);
      setRuptura(false);
      setVinculo(null);
      setCategoriaAberta(null);
      setErroLocal(null);
      setProdutoLista(null);
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
  const modoLista =
    !!tipo && !produtoContexto && tipo.granularidade_padrao === 'PRODUTO' && (tipo.produtos_predefinidos?.length ?? 0) > 0;
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
  const categoriasDisponiveis = exigeProduto ? CATEGORIAS.filter((c) => c.valor === 'PRODUTO') : CATEGORIAS;

  function validar(): string | null {
    if (!tipo) return 'Escolha um tipo de registro.';
    if (tipo.exige_foto && imagensUri.length === 0) return `O tipo "${tipo.descricao}" exige uma foto.`;
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
    const lista = tipo.produtos_predefinidos ?? [];
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
      tipoVinculo: produtoLista ? 'PRODUTO' : !produtoContexto && vinculo ? vinculo.categoria : undefined,
      produtoDescricao: produtoEfetivo?.descricao ?? (vinculo?.categoria === 'PRODUTO' ? vinculo.label : undefined),
      permanecerAberto: modoLista || undefined,
      secaoUuid: vinculo?.categoria === 'SECAO' ? vinculo.uuid : undefined,
      departamentoUuid: vinculo?.categoria === 'DEPARTAMENTO' ? vinculo.uuid : undefined,
      marcaUuid: vinculo?.categoria === 'MARCA' ? vinculo.uuid : undefined,
      vinculoLabel: !produtoContexto && vinculo && vinculo.categoria !== 'PRODUTO' ? vinculo.label : undefined,
      valoresCampos: Object.keys(valoresNormalizados).length > 0 ? valoresNormalizados : undefined,
      ruptura: ruptura || undefined,
      produtosAusentesConfirmaveis: produtosAusentesConfirmaveis.length > 0 ? produtosAusentesConfirmaveis : undefined,
    });

    // Sempre trata a promise (o pai pode passar mutateAsync, que rejeita no erro — promise
    // rejeitada sem handler derruba o app em produção). Coleta guiada: salvou → volta pra lista (o
    // check verde vem de produtosColetados). Deu erro → fica no formulário com o que foi digitado;
    // o pai mostra a mensagem em `erro`, e a foto volta a ser "não enviada" pra limpeza ao fechar.
    void Promise.resolve(resultado).then(
      () => {
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
      if (exigeProduto && tipo?.produtos_predefinidos?.length) {
        return tipo.produtos_predefinidos.map((p) => ({ uuid: p.id, label: p.descricao }));
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
            {produtoLista ? (
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
              {!!produtoEfetivo && (
                <Text style={styles.cabecalhoSubtitulo} numberOfLines={1}>
                  {produtoEfetivo.descricao}
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
              produtos={tipo.produtos_predefinidos ?? []}
              enviados={produtosColetados?.(tipo.id) ?? new Set<string>()}
              preenchidos={new Set(Object.keys(rascunhos))}
              paddingInferior={espaco.lg + insets.bottom}
              salvando={salvandoColeta}
              erro={erroColeta}
              onAbrir={abrirProdutoDaLista}
              onSalvar={() => void salvarColeta()}
            />
          )}

          {tipo && !(modoLista && !produtoLista) && (
            <>
              <ScrollView contentContainerStyle={styles.lista}>
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
                    onProdutosResolvidos={(produtos) =>
                      setProdutosSortimentoPorUuid((atual) => ({
                        ...atual,
                        ...Object.fromEntries(produtos.map((p) => [p.produto_uuid, p.descricao])),
                      }))
                    }
                  />
                </View>
              ))}

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

              {!produtoEfetivo && (tipo.permite_vincular_catalogo || exigeProduto) && (
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
                    {fotoObrigatoriaFaltando ? 'Adicione uma foto' : produtoLista ? 'Salvar produto' : 'Salvar registro'}
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
