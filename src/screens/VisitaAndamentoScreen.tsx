import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AdicionarProdutoSortimentoModal } from '../components/AdicionarProdutoSortimentoModal';
import { AbasLoja, type AbaLoja } from '../components/AbasLoja';
import { ComentariosRegistroModal } from '../components/ComentariosRegistroModal';
import { DadosCadastraisLoja } from '../components/DadosCadastraisLoja';
import { HistoricoLojaPanel } from '../components/HistoricoLojaPanel';
import { ConfirmarRupturaModal } from '../components/ConfirmarRupturaModal';
import { ProdutoDetalheModal, type ProdutoDetalhe } from '../components/ProdutoDetalheModal';
import { RegistroDetalheModal, type RegistroDetalhe } from '../components/RegistroDetalheModal';
import { RegistroFormModal, type RegistroFormResultado } from '../components/RegistroFormModal';
import { buscarProdutosDisponiveis } from '../lib/api/campanhas';
import { buscarNaoLidos } from '../lib/api/comentarios';
import { buscarOrdemServico } from '../lib/api/ordensServico';
import {
  buscarAutonomiaCatalogo,
  buscarAutonomiaSortimento,
  buscarCancelamentoRegistroPermitido,
  buscarCancelamentoVisitaPermitido,
} from '../lib/api/parametros';
import { buscarSortimento } from '../lib/api/sortimentoPontoVenda';
import { listarTiposRegistro } from '../lib/api/tiposRegistro';
import { useAuth } from '../lib/auth/AuthContext';
import { obterLocalizacaoAtual } from '../lib/location/useLocalizacaoAtual';
import { useEstaOnline } from '../lib/network';
import type { PontosVendaStackParamList } from '../navigation/PontosVendaStack';
import type { ProdutoDisponivel, SortimentoPontoVenda, TipoRegistro } from '../types/api';
import { copiarImagemParaArmazenamentoPersistente, type RegistroLocal } from '../lib/db/filaRegistros';
import {
  cancelarRegistroVisitaLocal,
  cancelarVisitaLocal,
  criarRegistroVisitaLocal,
  descartarVisitaLocalForcado,
  descartarVisitaRejeitada,
  finalizarVisitaLocal,
  lerVisitaLocal,
  listarRegistrosLocais,
  reabrirVisitaLocal,
  tentarEnviarAgora,
} from '../lib/visitaLocal';
import { useAoAtualizarFilaEnvio } from '../lib/useFilaEnvioAtualizada';
import { useDescarteVisita } from '../lib/useDescarteVisita';
import { cores, espaco, neutro, raio, sombraCard, sombraFlutuante, tipografia } from '../theme';

type Props = NativeStackScreenProps<PontosVendaStackParamList, 'VisitaAndamento'>;
type Aba = 'DADOS' | 'HISTORICO' | 'ACOES' | 'PRODUTOS' | 'REGISTROS';

interface GrupoCampanha {
  campanhaUuid: string;
  titulo: string;
  produtos: ProdutoDisponivel[];
}

// Item de sortimento já reduzido ao que o checklist precisa — só os de tipo_item PRODUTO viram
// linha aqui (SECAO/DEPARTAMENTO/MARCA inteiros ainda não são resolvidos em produtos individuais
// no app, ver docs/14-SORTIMENTO-PONTO-VENDA.md §6/§9).
interface ItemSortimentoProduto {
  produtoUuid: string;
  descricao: string;
  imagemUrl: string | null;
  codigoBarras: string | null;
  propriedade: string | null;
  pendente: boolean;
  produtoChave: boolean;
  secaoUuid: string | null;
  secaoDescricao: string | null;
  departamentoUuid: string | null;
  departamentoDescricao: string | null;
}

// Critério de agrupamento da aba Mix — "Produto" é a opção "sem agrupamento" (lista plana).
// Marca ainda não tem dado real (ProdutoAuditoria não tem marca_id até
// docs/27-BUSCA-MULTIPLA-DE-PRODUTOS.md sair do papel), então cai tudo num grupo único e
// honesto ("Sem marca cadastrada") em vez de fingir que funciona.
type CriterioAgrupamentoMix = 'DEPARTAMENTO' | 'SECAO' | 'MARCA' | 'PRODUTO';

// docs/05-APP-MOBILE-UX.md §3.5 — tela mais usada do app: lista de produtos a auditar
// (agrupada por campanha) + "Registro geral" + finalizar visita. A visita e os registros vivem
// na fila de envio local (ver docs/04-APP-MOBILE.md "Fila offline de envio") até serem
// confirmados pelo servidor — esta tela nunca fala com a API diretamente, só lê/escreve o
// SQLite local (lib/visitaLocal.ts) e deixa o motor de sincronização (lib/filaEnvio.ts) cuidar
// do envio sozinho, em segundo plano, quando houver rede.
// Três abas com papéis bem separados — correção feita depois de uma primeira modelagem errada
// (a aba de produtos virou um segundo caminho de preencher formulário, concorrendo com Ações):
// "Ações" é TUDO que preenche um registro nesta visita — ações obrigatórias
// (TipoRegistro.acao_obrigatoria, resolvida por escopo SEMPRE/CAMPANHA/CONTRATO) e formulários de
// Ordem de Serviço/Direcionamento. "Mix" é só REFERÊNCIA — lista o mix do PDV (docs/14-SORTIMENTO-PONTO-VENDA.md,
// termo "Mix" ver docs/27-BUSCA-MULTIPLA-DE-PRODUTOS.md §4), sem abrir formulário nenhum ao
// tocar; pra registrar algo sobre um produto do mix, o caminho é Ações → Registro geral →
// "Vincular a" (que já enxerga campanha + mix juntos pra busca). "Registros" lista TODOS os
// registros já feitos nesta visita — geral ou vinculado a produto, campanha ou avulso — pra nada
// "sumir" da vista do promotor. Cancelar (com confirmação) é permitido ali, parametrizável por
// empresa — ver REGISTRO_CANCELAMENTO_PERMITIDO em lib/api/parametros.ts.
export function VisitaAndamentoScreen({ route, navigation }: Props) {
  const { visitaLocalId } = route.params;
  const { usuario } = useAuth();
  const queryClient = useQueryClient();
  const online = useEstaOnline();
  const [erroRegistro, setErroRegistro] = useState<string | null>(null);
  const [modalAberto, setModalAberto] = useState(false);
  // Só preenchido quando o formulário abre a partir da aba Ações — pula a etapa de escolher o
  // tipo, já que a Ação em si já É um TipoRegistro específico. Ver RegistroFormModal.tipoFixo.
  const [tipoFixoModal, setTipoFixoModal] = useState<TipoRegistro | null>(null);
  // Preenchido quando o formulário abre a partir de um produto do Mix — o produto já é o
  // contexto, não faz sentido pedir "vincular a" de novo. Ver RegistroFormModal.produtoContexto.
  const [produtoContextoModal, setProdutoContextoModal] = useState<{ uuid: string; descricao: string } | null>(null);
  const [aba, setAba] = useState<Aba>('ACOES');
  const [modalAdicionarProdutoAberto, setModalAdicionarProdutoAberto] = useState(false);
  const [produtoDetalhe, setProdutoDetalhe] = useState<ProdutoDetalhe | null>(null);
  const [registroDetalhe, setRegistroDetalhe] = useState<RegistroDetalhe | null>(null);
  // Feedback do gestor (docs/28 §3) já durante a visita, não só depois no Histórico — só faz
  // sentido pra registro que já sincronizou (tem servidorId), comentário é conversa online, não
  // faz parte da fila offline. Ver docs/29-NOTIFICACOES-MOBILE.md (item que motivou isto).
  const [feedbackRegistro, setFeedbackRegistro] = useState<RegistroLocal | null>(null);
  const naoLidosQuery = useQuery({ queryKey: ['comentarios-nao-lidos'], queryFn: buscarNaoLidos, retry: false });
  const registrosComNaoLido = useMemo(
    () => new Set((naoLidosQuery.data?.registros ?? []).map((r) => r.registro_id)),
    [naoLidosQuery.data],
  );
  // Só pra distinguir "nunca existiu" de "existiu e acabou de ser apagada porque terminou de
  // sincronizar" quando a query de baixo devolve null — ver useEffect mais abaixo.
  const jaViuVisita = useRef(false);
  // Último estado visto antes da visita sumir — é o que diz SE ela terminou de verdade (estava
  // FINALIZADA_LOCAL) ou se foi apagada no meio do caminho (descartada/cancelada).
  const ultimoStatusVisto = useRef<string | null>(null);

  const visitaQuery = useQuery({
    queryKey: ['visita-local', visitaLocalId],
    queryFn: () => lerVisitaLocal(visitaLocalId),
  });
  const visita = visitaQuery.data ?? null;
  if (visita) {
    jaViuVisita.current = true;
    ultimoStatusVisto.current = visita.status;
  }

  // A visita já apareceu e agora a query devolve vazio. Antes de concluir "sumiu", relê o SQLite
  // direto: se a linha ainda existe, o problema é a query (não os dados) — restaura na tela e
  // registra no log; se não existe, registra isso também. Sem este passo, um retorno vazio
  // transitório da query virava "visita sincronizada/saiu do aparelho" mesmo com a visita intacta.
  useEffect(() => {
    if (visita || !jaViuVisita.current) return;
    let ativo = true;
    void lerVisitaLocal(visitaLocalId).then((linha) => {
      if (!ativo) return;
      console.log(
        `[visita-tela] query devolveu vazio (status=${visitaQuery.status}/${visitaQuery.fetchStatus}, erro=${String(visitaQuery.error)}) — linha no banco: ${linha ? linha.status : 'AUSENTE'}`,
      );
      if (linha) queryClient.setQueryData(['visita-local', visitaLocalId], linha);
    });
    return () => {
      ativo = false;
    };
  }, [visita, visitaLocalId, visitaQuery.status, visitaQuery.fetchStatus, visitaQuery.error, queryClient]);

  const registrosQuery = useQuery({
    queryKey: ['registros-local', visitaLocalId],
    queryFn: () => listarRegistrosLocais(visitaLocalId),
  });
  const registrosLocais = useMemo(
    () => (registrosQuery.data ?? []).filter((r) => r.status !== 'DESCARTADO'),
    [registrosQuery.data],
  );

  // O motor de sincronização roda em segundo plano (nunca via React Query) — sem isso, a tela
  // não saberia quando o check-in foi aceito/recusado ou um registro terminou de enviar.
  const releLocal = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['visita-local', visitaLocalId] });
    void queryClient.invalidateQueries({ queryKey: ['registros-local', visitaLocalId] });
    // A fila de envio pode ter acabado de mandar um registro que confirma um formulário de
    // Direcionamento (respondido_em) — reler a OS reflete isso na aba Ações assim que a rede
    // voltar, sem o promotor precisar sair e voltar da tela.
    void queryClient.invalidateQueries({ queryKey: ['ordem-servico', visita?.ordemServicoId] });
  }, [queryClient, visitaLocalId, visita?.ordemServicoId]);
  useAoAtualizarFilaEnvio(releLocal);

  const pontoVenda = visita?.pontoVenda;
  const pontoVendaUuid = pontoVenda?.id;

  // Formulários exigidos pela Ordem de Serviço desta visita (de um Direcionamento, ou
  // vinculados direto numa OS manual avulsa) — ver docs/25-DIRECIONAMENTO-ORDEM-SERVICO.md §6.
  // Só online: é dado que pode ter mudado desde o check-in (outro promotor pode ter respondido
  // o mesmo formulário, se a OS for de fila aberta), sem sentido de cache offline aqui, e a
  // visita não fica bloqueada por essa consulta falhar (mesmo padrão de produtosQuery/
  // sortimentoQuery nesta mesma tela).
  const ordemServicoQuery = useQuery({
    queryKey: ['ordem-servico', visita?.ordemServicoId],
    queryFn: () => buscarOrdemServico(visita!.ordemServicoId!),
    enabled: Boolean(visita?.ordemServicoId) && online,
  });

  const produtosQuery = useQuery({
    queryKey: ['campanhas-disponiveis', pontoVendaUuid],
    queryFn: () => buscarProdutosDisponiveis(pontoVendaUuid as string),
    enabled: Boolean(pontoVendaUuid),
  });
  const produtos = produtosQuery.data ?? [];

  const sortimentoQuery = useQuery({
    queryKey: ['sortimento', pontoVendaUuid],
    queryFn: () => buscarSortimento(pontoVendaUuid as string),
    enabled: Boolean(pontoVendaUuid),
  });
  const autonomiaSortimentoQuery = useQuery({
    queryKey: ['autonomia-sortimento'],
    queryFn: buscarAutonomiaSortimento,
  });
  const autonomiaSortimento = autonomiaSortimentoQuery.data ?? 'AUTONOMO';
  const autonomiaCatalogoQuery = useQuery({
    queryKey: ['autonomia-catalogo'],
    queryFn: buscarAutonomiaCatalogo,
  });
  const autonomiaCatalogo = autonomiaCatalogoQuery.data ?? 'REQUER_APROVACAO';
  const cancelamentoPermitidoQuery = useQuery({
    queryKey: ['cancelamento-registro-permitido'],
    queryFn: buscarCancelamentoRegistroPermitido,
  });
  const cancelamentoPermitido = cancelamentoPermitidoQuery.data ?? false;
  const cancelamentoVisitaPermitidoQuery = useQuery({
    queryKey: ['cancelamento-visita-permitido'],
    queryFn: buscarCancelamentoVisitaPermitido,
  });
  const cancelamentoVisitaPermitido = cancelamentoVisitaPermitidoQuery.data ?? false;

  // Só os itens de tipo_item PRODUTO viram linha no checklist — ver ItemSortimentoProduto.
  const itensSortimento = useMemo<ItemSortimentoProduto[]>(() => {
    return (sortimentoQuery.data ?? [])
      .filter((item): item is SortimentoPontoVenda & { produto: NonNullable<SortimentoPontoVenda['produto']> } =>
        item.tipo_item === 'PRODUTO' && item.produto !== null,
      )
      .map((item) => ({
        produtoUuid: item.produto.id,
        descricao: item.produto.descricao,
        imagemUrl: item.produto.imagem_url,
        codigoBarras: item.produto.codigo_barras,
        propriedade: item.produto.propriedade,
        pendente: item.status_aprovacao === 'PENDENTE',
        produtoChave: item.produto.produto_chave,
        secaoUuid: item.produto.secao_uuid,
        secaoDescricao: item.produto.secao_descricao,
        departamentoUuid: item.produto.departamento_uuid,
        departamentoDescricao: item.produto.departamento_descricao,
      }));
  }, [sortimentoQuery.data]);
  const produtosJaNoSortimento = useMemo(() => new Set(itensSortimento.map((i) => i.produtoUuid)), [itensSortimento]);

  // Agrupamento da aba Mix — "níveis de exibição" do catálogo (Departamento/Seção/Marca), mais
  // "Produto" como lista plana sem agrupamento. Ver docs/27-BUSCA-MULTIPLA-DE-PRODUTOS.md §4.
  const [agrupamentoMix, setAgrupamentoMix] = useState<CriterioAgrupamentoMix>('SECAO');
  const gruposMix = useMemo(() => {
    if (agrupamentoMix === 'PRODUTO') {
      return itensSortimento.length > 0 ? [{ chave: 'todos', titulo: null as string | null, itens: itensSortimento }] : [];
    }
    const porGrupo = new Map<string, { titulo: string; itens: ItemSortimentoProduto[] }>();
    for (const item of itensSortimento) {
      let chave: string;
      let titulo: string;
      if (agrupamentoMix === 'DEPARTAMENTO') {
        chave = item.departamentoUuid ?? '__sem_departamento__';
        titulo = item.departamentoDescricao ?? 'Sem departamento';
      } else if (agrupamentoMix === 'SECAO') {
        chave = item.secaoUuid ?? '__sem_secao__';
        titulo = item.secaoDescricao ?? 'Sem seção';
      } else {
        chave = '__sem_marca__';
        titulo = 'Sem marca cadastrada';
      }
      const grupo = porGrupo.get(chave) ?? { titulo, itens: [] };
      grupo.itens.push(item);
      porGrupo.set(chave, grupo);
    }
    return Array.from(porGrupo.entries())
      .map(([chave, grupo]) => ({ chave, ...grupo }))
      .sort((a, b) => a.titulo.localeCompare(b.titulo));
  }, [itensSortimento, agrupamentoMix]);

  const tiposRegistroQuery = useQuery({
    queryKey: ['tipos-registro'],
    queryFn: listarTiposRegistro,
  });
  const tiposRegistroAtivos = useMemo(
    () => (tiposRegistroQuery.data ?? []).filter((t) => t.ativo),
    [tiposRegistroQuery.data],
  );
  // Formulário sem ícone não aparece pro promotor (pedido explícito — o ícone é o que identifica
  // o formulário na lista/ações). Só o tipo de ruptura escapa dessa regra, ver tipoRuptura.
  const tiposRegistro = useMemo(() => tiposRegistroAtivos.filter((t) => !!t.icone), [tiposRegistroAtivos]);
  // Dropdown de "Registro geral" — só os tipos que podem aparecer soltos (decisão 8 de
  // docs/20-FORMULARIO-DINAMICO-CAMPANHA.md). Um tipo com disponivel_registro_livre=false ainda
  // aparece normalmente via Ação obrigatória (acoesPendentes, abaixo usa `tiposRegistro` cheio,
  // não esta lista filtrada) — só não deveria se repetir aqui, duplicando a mesma pendência.
  const tiposRegistroParaDropdown = useMemo(
    () => tiposRegistro.filter((t) => t.disponivel_registro_livre),
    [tiposRegistro],
  );
  const tipoRegistroPorUuid = useMemo(() => {
    const mapa = new Map<string, TipoRegistro>();
    for (const tipo of tiposRegistroQuery.data ?? []) mapa.set(tipo.id, tipo);
    return mapa;
  }, [tiposRegistroQuery.data]);

  const registrosPorProduto = useMemo(() => {
    const mapa = new Map<string, RegistroLocal[]>();
    for (const registro of registrosLocais) {
      if (!registro.produtoAuditoriaUuid) continue;
      const lista = mapa.get(registro.produtoAuditoriaUuid) ?? [];
      lista.push(registro);
      mapa.set(registro.produtoAuditoriaUuid, lista);
    }
    return mapa;
  }, [registrosLocais]);

  const registrosAvulsos = useMemo(() => registrosLocais.filter((r) => !r.produtoAuditoriaUuid), [registrosLocais]);

  const gruposPorCampanha = useMemo(() => {
    const grupos = new Map<string, GrupoCampanha>();
    for (const produto of produtos) {
      const grupo = grupos.get(produto.campanha_uuid) ?? {
        campanhaUuid: produto.campanha_uuid,
        titulo: produto.campanha_descricao,
        produtos: [],
      };
      grupo.produtos.push(produto);
      grupos.set(produto.campanha_uuid, grupo);
    }
    return Array.from(grupos.values());
  }, [produtos]);

  const registrosPorTipoRegistro = useMemo(() => {
    const mapa = new Map<string, RegistroLocal[]>();
    for (const registro of registrosLocais) {
      const lista = mapa.get(registro.tipoRegistroUuid) ?? [];
      lista.push(registro);
      mapa.set(registro.tipoRegistroUuid, lista);
    }
    return mapa;
  }, [registrosLocais]);

  // Ações pendentes desta visita — TipoRegistro com acao_obrigatoria=true, resolvido por
  // escopo (ver App\Enums\EscopoAcaoTipoRegistro no backend): SEMPRE entra sempre; CAMPANHA só
  // quando alguma campanha desta visita bate com a campanha configurada no tipo; CONTRATO só
  // quando o PDV tem contrato ativo (booleano vindo pronto do backend, o app nunca lida com
  // dado de contrato em si — ver docs/04-APP-MOBILE.md).
  const campanhasDaVisita = useMemo(() => new Set(gruposPorCampanha.map((g) => g.campanhaUuid)), [gruposPorCampanha]);
  const acoesPendentes = useMemo(
    () =>
      tiposRegistro.filter((t) => {
        if (!t.acao_obrigatoria) return false;
        if (t.escopo_acao === 'CAMPANHA') return !!t.campanha_auditoria_uuid && campanhasDaVisita.has(t.campanha_auditoria_uuid);
        if (t.escopo_acao === 'CONTRATO') return pontoVenda?.tem_contrato_ativo ?? false;
        return t.escopo_acao === 'SEMPRE';
      }),
    [tiposRegistro, campanhasDaVisita, pontoVenda],
  );

  // Formulários da Ordem de Serviço ainda não respondidos — soma "de servidor" (respondido_em)
  // com "local, ainda não sincronizado" (já existe um RegistroLocal pra esse tipo_registro,
  // mesmo que a fila de envio não tenha confirmado com o servidor ainda) pra não mostrar de
  // novo algo que o promotor acabou de responder offline. Cabeçalho da seção usa o nome do
  // Direcionamento quando existe; cai pra um rótulo genérico numa OS manual com formulário
  // vinculado direto (§7.2 do doc).
  const formulariosPendentesOS = useMemo(() => {
    const formularios = ordemServicoQuery.data?.formularios ?? [];
    return formularios.filter((f) => {
      if (f.respondido_em) return false;
      if ((registrosPorTipoRegistro.get(f.tipo_registro.id)?.length ?? 0) > 0) return false;
      return true;
    });
  }, [ordemServicoQuery.data, registrosPorTipoRegistro]);
  const abasDaVisita: AbaLoja<Aba>[] = [
    { chave: 'DADOS', rotulo: 'Dados cadastrais', icone: 'store-outline' },
    { chave: 'HISTORICO', rotulo: 'Histórico da loja', icone: 'history' },
    { chave: 'ACOES', rotulo: 'Ações', icone: 'clipboard-check-outline', selo: acoesPendentes.length + formulariosPendentesOS.length },
    { chave: 'PRODUTOS', rotulo: 'Mix', icone: 'package-variant-closed' },
    { chave: 'REGISTROS', rotulo: 'Registros', icone: 'format-list-checks' },
  ];
  const tituloFormulariosOS = ordemServicoQuery.data?.direcionamento?.descricao ?? 'Formulários desta ordem de serviço';

  // "Vincular a" (busca de produto no registro geral) enxerga campanha + sortimento juntos —
  // são só duas fontes alimentando a mesma lista de escolha, sem relação com os checklists
  // separados acima. campanha_uuid/campanha_descricao ficam vazios pros itens de sortimento
  // (não são usados fora do agrupamento por campanha, que não se aplica aqui).
  const produtosParaVincular = useMemo<ProdutoDisponivel[]>(() => {
    const extras = itensSortimento
      .filter((i) => !produtos.some((p) => p.produto_uuid === i.produtoUuid))
      .map((i) => ({
        produto_uuid: i.produtoUuid,
        descricao: i.descricao,
        imagem_url: i.imagemUrl,
        codigo_barras: i.codigoBarras,
        propriedade: i.propriedade,
        produto_chave: i.produtoChave,
        secao_uuid: i.secaoUuid,
        secao_descricao: i.secaoDescricao,
        campanha_uuid: '',
        campanha_descricao: '',
      }));
    return [...produtos, ...extras];
  }, [produtos, itensSortimento]);

  // Contagem de referência do Mix — quantos itens do mix já têm pelo menos um registro nesta
  // visita. Só informativo (a aba Mix é referência livre, não tem "completar" obrigatório).
  const totalMixRegistrados = itensSortimento.filter(
    (i) => (registrosPorProduto.get(i.produtoUuid)?.length ?? 0) > 0,
  ).length;

  // Produtos-chave do Mix sem nenhum registro — nomeados na confirmação de finalizar em vez de
  // só contados, ver confirmarFinalizacao() e docs/16-GRANULARIDADE-CHECKLIST-AUDITORIA.md §6.
  const produtosChaveFaltando = useMemo(() => {
    const nomes = new Map<string, string>();
    for (const i of itensSortimento) {
      if (i.produtoChave && (registrosPorProduto.get(i.produtoUuid)?.length ?? 0) === 0) {
        nomes.set(i.produtoUuid, i.descricao);
      }
    }
    return Array.from(nomes.values());
  }, [itensSortimento, registrosPorProduto]);

  const criarRegistroMutation = useMutation({
    mutationFn: (resultado: RegistroFormResultado) =>
      criarRegistroVisitaLocal({
        usuarioId: usuario!.id,
        visitaLocalId,
        resultado,
      }),
    onSuccess: (_dados, resultado) => {
      setErroRegistro(null);
      setModalAberto(false);
      setProdutoContextoModal(null);
      releLocal();
      // Ruptura confirmada (decisão 4 de docs/20-FORMULARIO-DINAMICO-CAMPANHA.md) — só abre a
      // tela de confirmação DEPOIS que o registro principal (com o campo SORTIMENTO) já salvou.
      // Guarda também as fotos do registro principal — decisão 4/§4.5: "os registros de ruptura
      // também recebem a mesma evidência (foto) da coleta que os gerou".
      if (resultado.produtosAusentesConfirmaveis?.length) {
        setConfirmacaoRuptura({
          produtos: resultado.produtosAusentesConfirmaveis,
          imagensUriOrigem: resultado.imagensUri ?? [],
        });
      }
    },
    onError: () => setErroRegistro('Não foi possível salvar o registro neste aparelho. Tente de novo.'),
  });

  // Ruptura confirmada — cria um VisitaRegistro de ruptura por produto confirmado, apontando pro
  // TipoRegistro com eh_ruptura=true da empresa (o mesmo que a Grade de Coleta já usa). Ver
  // App\Support\GranularidadeChecklist e docs/20-FORMULARIO-DINAMICO-CAMPANHA.md §4.5.
  const [confirmacaoRuptura, setConfirmacaoRuptura] = useState<{
    produtos: { produtoUuid: string; descricao: string }[];
    imagensUriOrigem: string[];
  } | null>(null);
  const tipoRuptura = useMemo(() => tiposRegistroAtivos.find((t) => t.eh_ruptura) ?? null, [tiposRegistroAtivos]);

  const confirmarRupturaMutation = useMutation({
    mutationFn: async (produtosConfirmados: { produtoUuid: string; descricao: string }[]) => {
      if (!tipoRuptura || !confirmacaoRuptura) return;
      for (const produto of produtosConfirmados) {
        // Cópia própria pra cada registro de ruptura (não reaproveita o mesmo caminho de
        // arquivo do registro principal) — a fila local assume que cada linha "dona" das
        // próprias fotos as apaga sozinha ao cancelar (ver cancelarRegistroVisitaLocal); um
        // caminho compartilhado entre registros locais diferentes quebraria essa suposição
        // (cancelar um apagaria a foto debaixo do outro).
        const imagensUri = await Promise.all(
          confirmacaoRuptura.imagensUriOrigem.map((uri) => copiarImagemParaArmazenamentoPersistente(uri)),
        );
        await criarRegistroVisitaLocal({
          usuarioId: usuario!.id,
          visitaLocalId,
          produtoDescricao: produto.descricao,
          resultado: {
            tipoRegistroUuid: tipoRuptura.id,
            produtoAuditoriaUuid: produto.produtoUuid,
            ruptura: true,
            imagensUri: imagensUri.length > 0 ? imagensUri : undefined,
          },
        });
      }
    },
    onSuccess: () => {
      setConfirmacaoRuptura(null);
      releLocal();
    },
    onError: () =>
      Alert.alert('Erro', 'Não foi possível registrar as rupturas confirmadas. Tente de novo pela aba Mix.'),
  });

  const cancelarRegistroMutation = useMutation({
    mutationFn: (registro: RegistroLocal) => cancelarRegistroVisitaLocal(visita?.servidorId ?? null, registro),
    onSuccess: () => {
      setErroRegistro(null);
      releLocal();
    },
    onError: () => setErroRegistro('Não foi possível cancelar o registro agora. Tente de novo.'),
  });

  function confirmarCancelamentoRegistro(registro: RegistroLocal) {
    Alert.alert('Cancelar registro', 'Tem certeza? Essa ação não pode ser desfeita.', [
      { text: 'Voltar', style: 'cancel' },
      { text: 'Cancelar registro', style: 'destructive', onPress: () => cancelarRegistroMutation.mutate(registro) },
    ]);
  }

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const coords = await obterLocalizacaoAtual();
      await finalizarVisitaLocal({ usuarioId: usuario!.id, visitaLocalId, latitude: coords.latitude, longitude: coords.longitude });
    },
    onSuccess: () => {
      Alert.alert(
        'Visita finalizada',
        online
          ? 'Enviando pro servidor agora — pode fechar o app, o envio continua sozinho.'
          : 'Sem conexão no momento — será enviada automaticamente assim que o sinal voltar.',
      );
      navigation.popToTop();
    },
    onError: () => Alert.alert('Erro ao finalizar', 'Não foi possível confirmar sua localização. Tente de novo.'),
  });

  const descartarMutation = useMutation({
    mutationFn: () => descartarVisitaRejeitada(visitaLocalId),
    onSuccess: () => navigation.popToTop(),
    onError: () => Alert.alert('Erro', 'Não foi possível descartar esta visita. Tente de novo.'),
  });

  // Saídas pra visita TRAVADA na fila — ver descartarVisitaLocalForcado / reabrirVisitaLocal em
  // lib/visitaLocal.ts. Funcionam sem rede e sem depender do parâmetro de cancelamento da empresa.
  const descarteSeguro = useDescarteVisita(() => navigation.popToTop());

  const descartarForcadoMutation = useMutation({
    mutationFn: () => descartarVisitaLocalForcado(visita!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['visitas-locais-abertas'] });
      void queryClient.invalidateQueries({ queryKey: ['visitas-locais-pendentes'] });
      navigation.popToTop();
    },
    onError: () => Alert.alert('Erro', 'Não foi possível descartar esta visita. Tente de novo.'),
  });

  const reabrirMutation = useMutation({
    mutationFn: () => reabrirVisitaLocal(visitaLocalId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['visita-local', visitaLocalId] });
      void queryClient.invalidateQueries({ queryKey: ['visitas-locais-abertas'] });
    },
    onError: () => Alert.alert('Erro', 'Não foi possível reabrir a visita. Tente de novo.'),
  });

  const tentarNovamenteMutation = useMutation({
    mutationFn: () => tentarEnviarAgora(usuario!.id),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['visita-local', visitaLocalId] }),
  });

  function confirmarDescarteForcado() {
    const servidor = visita?.servidorId
      ? ' O servidor já conhece esta visita: vamos tentar cancelá-la lá, mas se não der o gestor pode ter que encerrá-la pelo admin.'
      : '';
    Alert.alert(
      'Descartar visita',
      `Tudo o que foi registrado nesta visita (inclusive fotos) será perdido e ela some do app.${servidor} Descartar mesmo assim?`,
      [
        { text: 'Voltar', style: 'cancel' },
        { text: 'Descartar', style: 'destructive', onPress: () => descartarForcadoMutation.mutate() },
      ],
    );
  }

  function confirmarReabertura() {
    Alert.alert(
      'Reabrir visita',
      'A visita volta para "em andamento" e o checkout pendente é cancelado. Você pode responder o que faltar e finalizar de novo.',
      [
        { text: 'Voltar', style: 'cancel' },
        { text: 'Reabrir', onPress: () => reabrirMutation.mutate() },
      ],
    );
  }

  const cancelarVisitaMutation = useMutation({
    mutationFn: () => cancelarVisitaLocal(visita!),
    onSuccess: () => navigation.popToTop(),
    onError: () => Alert.alert('Erro', 'Não foi possível cancelar a visita agora. Tente de novo.'),
  });

  function confirmarCancelamentoVisita() {
    Alert.alert(
      'Cancelar visita',
      'Os registros já feitos aqui (inclusive fotos) não contam mais. Essa ação não pode ser desfeita. Cancelar mesmo assim?',
      [
        { text: 'Voltar', style: 'cancel' },
        { text: 'Cancelar visita', style: 'destructive', onPress: () => cancelarVisitaMutation.mutate() },
      ],
    );
  }

  function abrirModalGeral() {
    setErroRegistro(null);
    setTipoFixoModal(null);
    setProdutoContextoModal(null);
    setModalAberto(true);
  }

  function abrirModalAcao(tipo: TipoRegistro) {
    setErroRegistro(null);
    setTipoFixoModal(tipo);
    setProdutoContextoModal(null);
    setModalAberto(true);
  }

  // Toque num item do Mix: a ação principal é registrar a coleta já vinculada a este produto
  // (era o que abria o detalhe do produto antes, sem opção de coletar). Ver "ⓘ" pro detalhe.
  function abrirModalParaProduto(item: { produtoUuid: string; descricao: string }) {
    setErroRegistro(null);
    setTipoFixoModal(null);
    setProdutoContextoModal({ uuid: item.produtoUuid, descricao: item.descricao });
    setModalAberto(true);
  }

  function confirmarFinalizacao() {
    const rupturas = registrosLocais.filter((r) => r.ruptura).length;

    const partes: string[] = [`${registrosAvulsos.length} registro(s) geral(is)`];
    if (rupturas > 0) partes.push(`${rupturas} ruptura(s)`);

    let mensagem = `${partes.join(', ')}.`;
    if (produtosChaveFaltando.length > 0) {
      const verbo = produtosChaveFaltando.length === 1 ? 'não foi registrado' : 'não foram registrados';
      mensagem += ` Cadê ${produtosChaveFaltando.join(', ')}? ${verbo}.`;
    }
    mensagem += ' Deseja finalizar a visita?';

    Alert.alert('Finalizar visita', mensagem, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Finalizar', style: 'destructive', onPress: () => checkoutMutation.mutate() },
    ]);
  }

  function confirmarDescarte() {
    Alert.alert(
      'Descartar visita',
      `O check-in foi recusado pelo servidor${visita?.erro ? `: ${visita.erro}` : ''}. Os registros feitos aqui (inclusive fotos) serão perdidos. Descartar mesmo assim?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Descartar', style: 'destructive', onPress: () => descartarMutation.mutate() },
      ],
    );
  }

  if (visitaQuery.isLoading) {
    return (
      <View style={styles.centroTela}>
        <ActivityIndicator size="large" color={cores.primaria} />
      </View>
    );
  }

  if (!visita) {
    // Se a visita já tinha aparecido antes e sumiu, é porque terminou de sincronizar (check-in +
    // registros + checkout todos confirmados) enquanto o promotor ainda estava nesta tela —
    // sucesso, não erro. Ver excluirVisitaLocalCompleta em lib/db/filaVisitas.ts.
    if (jaViuVisita.current) {
      const terminou = ultimoStatusVisto.current === 'FINALIZADA_LOCAL';
      return (
        <View style={styles.centroTela}>
          <Text style={styles.vazioTexto}>
            {terminou
              ? 'Visita finalizada e enviada ao servidor com sucesso.'
              : 'Esta visita saiu deste aparelho sem ter sido finalizada (foi descartada ou cancelada). Se você não fez isso, avise o suporte informando o horário.'}
          </Text>
          <Pressable style={styles.botaoRetry} onPress={() => navigation.popToTop()}>
            <Text style={styles.botaoRetryTexto}>Voltar</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.centroTela}>
        <Text style={styles.vazioTexto}>Visita não encontrada.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.cabecalho}>
        <Text style={styles.pdvNome}>{pontoVenda?.fantasia}</Text>
        <Text style={styles.inicioTexto}>
          Iniciada às{' '}
          {new Date(visita.inicioEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </Text>
        {itensSortimento.length > 0 && (
          <Text style={styles.mixStat}>
            {itensSortimento.length} produto(s) no mix desta loja
            {totalMixRegistrados > 0 ? ` (${totalMixRegistrados} com registro nesta visita)` : ''}
          </Text>
        )}

        {visita.status === 'REJEITADA' ? (
          <View style={[styles.statusBox, styles.statusBoxErro]}>
            <Text style={styles.statusBoxTexto}>
              Check-in recusado pelo servidor{visita.erro ? `: ${visita.erro}` : ''}.
            </Text>
            <Pressable style={styles.botaoDescartar} onPress={() => setAba('REGISTROS')}>
              <Text style={styles.botaoDescartarTexto}>Descartar na aba Registros</Text>
            </Pressable>
          </View>
        ) : visita.status === 'FINALIZADA_LOCAL' ? (
          // Visita finalizada aqui, mas o checkout ainda não foi confirmado pelo servidor. Antes esta
          // tela não dizia nada disso e ainda oferecia "Finalizar visita" de novo — parecia uma
          // visita nova, e não havia como sair. Agora mostra o motivo e as três saídas.
          <View style={[styles.statusBox, !!visita.erro && styles.statusBoxErro]}>
            <Text style={styles.statusBoxTexto}>
              Visita finalizada, aguardando confirmação do servidor.
              {visita.erro ? `\n${visita.erro}` : online ? '' : '\nSem conexão — envia sozinha quando o sinal voltar.'}
              {/formul[aá]rio/i.test(visita.erro ?? '')
                ? '\nÉ só responder o formulário pendente em Ações: assim que ele sobe, a visita é enviada sozinha.'
                : ''}
            </Text>
            <View style={{ flexDirection: 'row', gap: espaco.sm, flexWrap: 'wrap' }}>
              <Pressable
                style={[styles.botaoDescartar, { backgroundColor: cores.primaria }]}
                onPress={() => tentarNovamenteMutation.mutate()}
                disabled={tentarNovamenteMutation.isPending}
              >
                <Text style={styles.botaoDescartarTexto}>
                  {tentarNovamenteMutation.isPending ? 'Enviando...' : 'Tentar enviar agora'}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.botaoDescartar, { backgroundColor: neutro[700] }]}
                onPress={confirmarReabertura}
                disabled={reabrirMutation.isPending}
              >
                <Text style={styles.botaoDescartarTexto}>Reabrir visita</Text>
              </Pressable>
            </View>
          </View>
        ) : !visita.servidorId ? (
          <View style={[styles.statusBox, !!visita.erro && styles.statusBoxErro]}>
            <Text style={styles.statusBoxTexto}>
              {online ? 'Enviando check-in...' : 'Sem conexão — check-in será enviado quando o sinal voltar.'}
              {visita.erro ? `\n${visita.erro}` : ''}
            </Text>
          </View>
        ) : null}
      </View>

      {erroRegistro && !modalAberto && (
        <View style={styles.erroBox}>
          <Text style={styles.erroTexto}>{erroRegistro}</Text>
        </View>
      )}

      <AbasLoja
        ativa={aba}
        onChange={setAba}
        abas={abasDaVisita}
      />

      {aba === 'DADOS' ? (
        <ScrollView>
          {pontoVenda && <DadosCadastraisLoja pontoVenda={pontoVenda} />}
        </ScrollView>
      ) : aba === 'HISTORICO' ? (
        <ScrollView>{!!pontoVendaUuid && <HistoricoLojaPanel pontoVendaUuid={pontoVendaUuid} />}</ScrollView>
      ) : aba === 'ACOES' ? (
        <ScrollView contentContainerStyle={styles.lista}>
          <View style={styles.secao}>
            <Text style={styles.secaoTitulo}>Ações</Text>
            <Text style={styles.secaoSubtitulo}>Tarefas obrigatórias desta visita — toque pra registrar.</Text>
            {tiposRegistroQuery.isLoading ? (
              <View style={styles.centro}>
                <ActivityIndicator color={cores.primaria} />
              </View>
            ) : acoesPendentes.length === 0 ? (
              <Text style={styles.vazioTexto}>Nenhuma ação obrigatória pra esta visita.</Text>
            ) : (
              acoesPendentes.map((acao) => (
                <ProdutoItem
                  key={acao.id}
                  descricao={acao.descricao}
                  registros={registrosPorTipoRegistro.get(acao.id) ?? []}
                  onPress={() => abrirModalAcao(acao)}
                />
              ))
            )}
          </View>

          {/* Formulários de Ordem de Serviço (Direcionamento, ou vinculado direto numa OS
              manual) — seção própria, só aparece quando há alguma pendência. Ver
              docs/25-DIRECIONAMENTO-ORDEM-SERVICO.md §6. */}
          {formulariosPendentesOS.length > 0 && (
            <View style={styles.secao}>
              <Text style={styles.secaoTitulo}>{tituloFormulariosOS}</Text>
              <Text style={styles.secaoSubtitulo}>Formulários que você precisa responder nesta visita.</Text>
              {formulariosPendentesOS.map((formulario) => {
                const tipo = tipoRegistroPorUuid.get(formulario.tipo_registro.id);
                if (!tipo) return null;
                return (
                  <ProdutoItem
                    key={formulario.tipo_registro.id}
                    descricao={formulario.obrigatorio ? tipo.descricao : `${tipo.descricao} (opcional)`}
                    registros={[]}
                    onPress={() => abrirModalAcao(tipo)}
                  />
                );
              })}
            </View>
          )}

        </ScrollView>
      ) : aba === 'PRODUTOS' ? (
        <ScrollView contentContainerStyle={styles.lista}>
          {sortimentoQuery.isLoading && (
            <View style={styles.centro}>
              <ActivityIndicator color={cores.primaria} />
            </View>
          )}

          {sortimentoQuery.isError && (
            <View style={styles.centro}>
              <Text style={styles.vazioTexto}>Não foi possível carregar o mix desta loja.</Text>
              <Pressable style={styles.botaoRetry} onPress={() => void sortimentoQuery.refetch()}>
                <Text style={styles.botaoRetryTexto}>Tentar novamente</Text>
              </Pressable>
            </View>
          )}

          {itensSortimento.length > 0 && (
            <View style={styles.agrupamentoRow}>
              {(
                [
                  { valor: 'DEPARTAMENTO', rotulo: 'Departamento' },
                  { valor: 'SECAO', rotulo: 'Seção' },
                  { valor: 'MARCA', rotulo: 'Marca' },
                  { valor: 'PRODUTO', rotulo: 'Produto' },
                ] as { valor: CriterioAgrupamentoMix; rotulo: string }[]
              ).map((opcao) => (
                <Pressable
                  key={opcao.valor}
                  style={[styles.agrupamentoPill, agrupamentoMix === opcao.valor && styles.agrupamentoPillAtiva]}
                  onPress={() => setAgrupamentoMix(opcao.valor)}
                >
                  <Text
                    style={[
                      styles.agrupamentoPillTexto,
                      agrupamentoMix === opcao.valor && styles.agrupamentoPillTextoAtivo,
                    ]}
                  >
                    {opcao.rotulo}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {gruposMix.map((grupo) => (
            <View key={grupo.chave} style={styles.secao}>
              {grupo.titulo && <Text style={styles.secaoTitulo}>{grupo.titulo}</Text>}
              {grupo.itens.map((item) => (
                <ProdutoItem
                  key={item.produtoUuid}
                  descricao={item.descricao}
                  registros={registrosPorProduto.get(item.produtoUuid) ?? []}
                  tagPendente={item.pendente}
                  imagemUrl={item.imagemUrl}
                  produtoChave={item.produtoChave}
                  propriedade={item.propriedade}
                  onPress={() => abrirModalParaProduto({ produtoUuid: item.produtoUuid, descricao: item.descricao })}
                  onVerDetalhes={() =>
                    setProdutoDetalhe({
                      descricao: item.descricao,
                      imagemUrl: item.imagemUrl,
                      codigoBarras: item.codigoBarras,
                      propriedade: item.propriedade,
                      secaoDescricao: item.secaoDescricao,
                      produtoChave: item.produtoChave,
                    })
                  }
                />
              ))}
            </View>
          ))}

          {!sortimentoQuery.isLoading && itensSortimento.length === 0 && (
            <View style={styles.centro}>
              <Text style={styles.vazioTexto}>Nenhum produto no mix deste PDV ainda.</Text>
            </View>
          )}

          {autonomiaSortimento !== 'DESABILITADO' && (
            <Pressable
              style={({ pressed }) => [styles.botaoSecundario, pressed && styles.botaoPressionado]}
              onPress={() => setModalAdicionarProdutoAberto(true)}
            >
              <Text style={styles.botaoSecundarioTexto}>+ Adicionar produto da loja</Text>
            </Pressable>
          )}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.lista}>
          <View style={styles.secao}>
            <Text style={styles.secaoTitulo}>Registros da visita</Text>
            <Text style={styles.secaoSubtitulo}>
              Tudo que já foi registrado até agora, geral ou vinculado a um produto do mix.
            </Text>
            {registrosLocais.length === 0 ? (
              <Text style={styles.vazioTexto}>
                Nenhum registro ainda. Toque em "Ações" pras tarefas obrigatórias, ou em
                "Registro geral" aqui embaixo pra registrar algo do mix.
              </Text>
            ) : (
              registrosLocais.map((registro) => (
                <RegistroCard
                  key={registro.id}
                  registro={registro}
                  tipoRegistro={tipoRegistroPorUuid.get(registro.tipoRegistroUuid)}
                  podeCancelar={cancelamentoPermitido}
                  cancelando={cancelarRegistroMutation.isPending}
                  onCancelar={() => confirmarCancelamentoRegistro(registro)}
                  onDetalhar={() =>
                    setRegistroDetalhe({
                      tipoDescricao: tipoRegistroPorUuid.get(registro.tipoRegistroUuid)?.descricao ?? 'Registro',
                      vinculoLabel: registro.produtoDescricao ?? registro.vinculoDescricao,
                      valoresCampos: registro.valoresCampos ? Object.entries(registro.valoresCampos) : [],
                      ruptura: !!registro.ruptura,
                      observacao: registro.observacao,
                      imagensLocais: registro.imagensLocais,
                      criadoEm: registro.criadoEm,
                      erro: registro.status === 'ERRO' ? (registro.erro ?? 'Não foi aceito pelo servidor') : null,
                    })
                  }
                  podeComentar={!!registro.servidorId && !!visita?.servidorId}
                  naoLido={!!registro.servidorId && registrosComNaoLido.has(registro.servidorId)}
                  onFeedback={() => setFeedbackRegistro(registro)}
                />
              ))
            )}
          </View>

          {/* Descartar visita mora aqui, não no topo: é ação rara e destrutiva. Funciona sem rede e
              sem depender do parâmetro de cancelamento (descartarVisitaLocalForcado). */}
          <View style={styles.zonaRisco}>
            <Text style={styles.zonaRiscoTitulo}>Zona de risco</Text>
            <Text style={styles.zonaRiscoTexto}>
              Apaga esta visita e tudo o que foi registrado nela, inclusive fotos. Use quando a visita travou
              ou foi aberta por engano.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.botaoZonaRisco, pressed && { opacity: 0.85 }]}
              onPress={() => descarteSeguro.descartar(visita)}
              disabled={descarteSeguro.ocupado}
            >
              <Text style={styles.botaoZonaRiscoTexto}>
                {descarteSeguro.ocupado ? 'Descartando...' : 'Descartar visita'}
              </Text>
            </Pressable>
            {cancelamentoVisitaPermitido && (visita.status === 'RASCUNHO' || visita.status === 'CHECKIN_ENVIADO') && (
              <Pressable onPress={confirmarCancelamentoVisita} disabled={cancelarVisitaMutation.isPending} hitSlop={8}>
                <Text style={styles.zonaRiscoLink}>
                  {cancelarVisitaMutation.isPending ? 'Cancelando...' : 'Cancelar visita no servidor (com registro do motivo)'}
                </Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      )}

      <View style={styles.rodape}>
        <Pressable
          style={({ pressed }) => [styles.botaoSecundario, pressed && styles.botaoPressionado]}
          onPress={abrirModalGeral}
        >
          <MaterialCommunityIcons name="plus-circle-outline" size={18} color={cores.primaria} />
          <Text style={styles.botaoSecundarioTexto}>Registro geral</Text>
        </Pressable>

        {visita.status !== 'FINALIZADA_LOCAL' && visita.status !== 'REJEITADA' && (
        <Pressable
          style={({ pressed }) => [styles.botaoPrimario, pressed && styles.botaoPressionado]}
          onPress={confirmarFinalizacao}
          disabled={checkoutMutation.isPending}
        >
          {checkoutMutation.isPending ? (
            <ActivityIndicator color={cores.onPrimaria} />
          ) : (
            <>
              <MaterialCommunityIcons name="flag-checkered" size={18} color={cores.onPrimaria} />
              <Text style={styles.botaoPrimarioTexto}>Finalizar visita</Text>
            </>
          )}
        </Pressable>
        )}
      </View>

      {descarteSeguro.elemento}

      <RegistroFormModal
        visible={modalAberto}
        tiposRegistro={tiposRegistroParaDropdown}
        produtosDisponiveis={produtosParaVincular}
        produtoContexto={produtoContextoModal}
        tipoFixo={tipoFixoModal}
        pontoVendaUuid={pontoVendaUuid}
        enviando={criarRegistroMutation.isPending}
        erro={erroRegistro}
        onClose={() => {
          setModalAberto(false);
          setErroRegistro(null);
          setProdutoContextoModal(null);
        }}
        onSubmit={(resultado) => criarRegistroMutation.mutate(resultado)}
      />

      {pontoVendaUuid && (
        <AdicionarProdutoSortimentoModal
          visible={modalAdicionarProdutoAberto}
          pontoVendaUuid={pontoVendaUuid}
          produtosJaVinculados={produtosJaNoSortimento}
          autonomiaCatalogo={autonomiaCatalogo}
          onClose={() => setModalAdicionarProdutoAberto(false)}
          onAdicionado={() => setModalAdicionarProdutoAberto(false)}
        />
      )}

      <ProdutoDetalheModal produto={produtoDetalhe} onClose={() => setProdutoDetalhe(null)} />
      <RegistroDetalheModal registro={registroDetalhe} onClose={() => setRegistroDetalhe(null)} />

      <ComentariosRegistroModal
        visible={feedbackRegistro !== null}
        visitaUuid={visita?.servidorId ?? ''}
        registroUuid={feedbackRegistro?.servidorId ?? null}
        titulo={
          feedbackRegistro
            ? (feedbackRegistro.produtoDescricao ??
              feedbackRegistro.vinculoDescricao ??
              tipoRegistroPorUuid.get(feedbackRegistro.tipoRegistroUuid)?.descricao ??
              'Registro')
            : 'Registro'
        }
        onClose={() => setFeedbackRegistro(null)}
      />

      <ConfirmarRupturaModal
        visible={confirmacaoRuptura !== null}
        produtos={confirmacaoRuptura?.produtos ?? []}
        enviando={confirmarRupturaMutation.isPending}
        onCancelar={() => setConfirmacaoRuptura(null)}
        onConfirmar={(produtosConfirmados) => confirmarRupturaMutation.mutate(produtosConfirmados)}
      />
    </View>
  );
}

function ProdutoItem({
  descricao,
  registros,
  tagPendente,
  imagemUrl,
  produtoChave,
  propriedade,
  onPress,
  onVerDetalhes,
}: {
  descricao: string;
  registros: RegistroLocal[];
  // Item de sortimento adicionado pelo próprio promotor em modo REQUER_APROVACAO — ainda dá pra
  // registrar normalmente, só não é oficial até o gestor decidir. Ver
  // docs/14-SORTIMENTO-PONTO-VENDA.md §9.
  tagPendente?: boolean;
  // Foto de catálogo do produto (ProdutoAuditoria.imagem_url) — sempre a do cadastro, nunca a
  // de um registro feito nesta visita (essa aparece dentro do próprio registro, na aba
  // "Registros"; aqui é só identificação de qual produto é).
  imagemUrl?: string | null;
  // Antes só aparecia dentro do modal de detalhe (ⓘ) — docs/26-MELHORIAS-PRODUTIVIDADE-PROMOTOR.md
  // §5 item 10: o promotor precisa saber que é chave sem precisar abrir nada, direto na lista.
  produtoChave?: boolean;
  // Só presente nos itens do Mix — "Nosso produto"/"Concorrente" em vez de "Não conferido"
  // (a aba Mix é referência, não tem noção de "conferir").
  propriedade?: string | null;
  onPress: () => void;
  // Ausente pra itens sem ficha própria pra mostrar (ex.: Ações, que são TipoRegistro, não
  // produto) — o botão "ⓘ" some nesse caso em vez de abrir um modal vazio.
  onVerDetalhes?: () => void;
}) {
  const temRuptura = registros.some((r) => r.ruptura);
  const temErro = registros.some((r) => r.status === 'ERRO');
  const conferido = registros.length > 0;

  return (
    <Pressable style={({ pressed }) => [styles.itemCard, pressed && styles.itemCardPressionado]} onPress={onPress}>
      {imagemUrl ? (
        <Image source={{ uri: imagemUrl }} style={[styles.itemThumb, styles.itemThumbProduto]} resizeMode="contain" />
      ) : (
        <View style={[styles.itemThumb, styles.itemThumbVazio]} />
      )}

      <View style={styles.itemInfo}>
        <View style={styles.itemNomeLinha}>
          {produtoChave && <MaterialCommunityIcons name="key-star" size={14} color={cores.acentoTexto} />}
          <Text style={styles.itemNome} numberOfLines={2}>
            {descricao}
          </Text>
        </View>
        {propriedade !== undefined ? (
          <Text style={propriedade === 'CONCORRENTE' ? styles.itemTagConcorrente : styles.itemStatusPendente}>
            {propriedade === 'CONCORRENTE' ? 'Concorrente' : 'Nosso produto'}
          </Text>
        ) : (
          !conferido && <Text style={styles.itemStatusPendente}>Não conferido</Text>
        )}
        {temErro && <Text style={styles.itemStatusErro}>Um registro não foi aceito pelo servidor</Text>}
        {tagPendente && <Text style={styles.badgePendenteAprovacao}>Pendente de aprovação</Text>}
      </View>

      {temRuptura && <Text style={styles.badgeRuptura}>Ruptura</Text>}
      {conferido && <Text style={styles.badgeContagem}>{registros.length}</Text>}
      {onVerDetalhes && (
        <Pressable onPress={onVerDetalhes} hitSlop={10} style={styles.botaoDetalhes}>
          <Text style={styles.botaoDetalhesTexto}>ⓘ</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

function RegistroCard({
  registro,
  tipoRegistro,
  podeCancelar,
  cancelando,
  onCancelar,
  onDetalhar,
  podeComentar,
  naoLido,
  onFeedback,
}: {
  registro: RegistroLocal;
  tipoRegistro: TipoRegistro | undefined;
  podeCancelar: boolean;
  cancelando: boolean;
  onCancelar: () => void;
  onDetalhar: () => void;
  // Comentário é conversa online com o gestor (docs/28 §3) — só existe pra registro que já
  // sincronizou (tem servidorId na visita e nele mesmo). Enquanto pendente de envio, sem link.
  podeComentar: boolean;
  naoLido: boolean;
  onFeedback: () => void;
}) {
  const vinculoLabel = registro.produtoDescricao ?? registro.vinculoDescricao;
  const valoresCampos = registro.valoresCampos ? Object.entries(registro.valoresCampos) : [];

  return (
    <Pressable
      style={({ pressed }) => [styles.itemCard, pressed && styles.itemCardPressionado]}
      onPress={onDetalhar}
    >
      {registro.imagensLocais[0] ? (
        <View style={styles.itemThumbWrap}>
          <Image source={{ uri: registro.imagensLocais[0] }} style={styles.itemThumb} />
          {registro.imagensLocais.length > 1 && (
            <Text style={styles.itemThumbBadge}>+{registro.imagensLocais.length - 1}</Text>
          )}
        </View>
      ) : (
        <View style={[styles.itemThumb, styles.itemThumbVazio]} />
      )}
      <View style={styles.itemInfo}>
        <Text style={styles.itemNome}>{tipoRegistro?.descricao ?? 'Registro'}</Text>
        {vinculoLabel && <Text style={styles.itemVinculo}>{vinculoLabel}</Text>}
        {valoresCampos.map(([chave, valor]) => (
          <Text key={chave} style={styles.itemCampoValor}>
            {valor}
          </Text>
        ))}
        {registro.status === 'ERRO' && (
          <Text style={styles.itemStatusErro}>{registro.erro ?? 'Não foi aceito pelo servidor'}</Text>
        )}
        {podeComentar && (
          <Pressable onPress={onFeedback} hitSlop={8}>
            <Text style={styles.linkFeedback}>Comentários{naoLido ? ' · nova resposta' : ''}</Text>
          </Pressable>
        )}
        {podeCancelar && (
          <Pressable onPress={onCancelar} disabled={cancelando} hitSlop={8}>
            <Text style={styles.linkCancelar}>{cancelando ? 'Cancelando...' : 'Cancelar registro'}</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.badgesColuna}>
        {registro.status === 'PENDENTE' && <Text style={styles.badgePendenteEnvio}>Aguardando envio</Text>}
        {registro.ruptura && <Text style={styles.badgeRuptura}>Ruptura</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: cores.fundo,
  },
  zonaRisco: {
    margin: espaco.lg,
    marginTop: espaco.xl,
    padding: espaco.lg,
    borderRadius: raio.lg,
    borderWidth: 1,
    borderColor: cores.erroBorda,
    backgroundColor: cores.erroFundo,
    gap: espaco.sm,
  },
  zonaRiscoTitulo: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: cores.erro, textTransform: 'uppercase' },
  zonaRiscoTexto: { fontSize: 13, color: cores.textoSecundario },
  botaoZonaRisco: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: espaco.lg,
    justifyContent: 'center',
    borderRadius: raio.md,
    borderWidth: 1.5,
    borderColor: cores.erro,
  },
  botaoZonaRiscoTexto: { color: cores.erro, fontWeight: '800', fontSize: 14 },
  zonaRiscoLink: { color: cores.erro, fontSize: 12, fontWeight: '600', textDecorationLine: 'underline' },
  centroTela: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: espaco.xxl,
    gap: espaco.lg,
    backgroundColor: cores.fundoCard,
  },
  abas: {
    flexDirection: 'row',
    backgroundColor: cores.fundoCard,
    borderBottomWidth: 1,
    borderBottomColor: cores.divisor,
    padding: espaco.xs,
    gap: espaco.xs,
  },
  aba: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 40,
    borderRadius: raio.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  abaAtiva: {
    backgroundColor: cores.primariaClara,
  },
  abaTexto: {
    fontSize: 14,
    fontWeight: '600',
    color: cores.textoSecundario,
  },
  abaTextoAtivo: {
    color: cores.primariaEscura,
  },
  cabecalho: {
    backgroundColor: cores.fundoCard,
    paddingHorizontal: espaco.xl,
    paddingVertical: espaco.md,
    gap: 2,
  },
  pdvNome: {
    ...tipografia.titulo,
    color: cores.texto,
  },
  inicioTexto: {
    fontSize: 14,
    color: cores.textoSecundario,
    marginTop: 4,
  },
  mixStat: {
    fontSize: 13,
    fontWeight: '600',
    color: cores.textoSecundario,
    marginTop: espaco.sm,
  },
  agrupamentoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: espaco.xs,
    marginBottom: espaco.sm,
  },
  agrupamentoPill: {
    paddingHorizontal: espaco.md,
    paddingVertical: 6,
    borderRadius: raio.pill,
    borderWidth: 1,
    borderColor: cores.borda,
    backgroundColor: cores.fundoCard,
  },
  agrupamentoPillAtiva: {
    backgroundColor: cores.primaria,
    borderColor: cores.primaria,
  },
  agrupamentoPillTexto: {
    fontSize: 12,
    fontWeight: '700',
    color: cores.textoSecundario,
  },
  agrupamentoPillTextoAtivo: {
    color: cores.onPrimaria,
  },
  statusBox: {
    backgroundColor: cores.acentoClaro,
    borderWidth: 1,
    borderColor: cores.acentoBorda,
    borderRadius: raio.md,
    padding: espaco.md,
    marginTop: espaco.md,
  },
  statusBoxErro: {
    backgroundColor: cores.erroFundo,
    borderColor: cores.erroBorda,
  },
  statusBoxTexto: {
    fontSize: 13,
    color: cores.acentoTexto,
  },
  botaoDescartar: {
    marginTop: espaco.sm,
    alignSelf: 'flex-start',
    minHeight: 40,
    paddingHorizontal: espaco.md,
    justifyContent: 'center',
    borderRadius: raio.sm,
    backgroundColor: cores.erro,
  },
  botaoDescartarTexto: {
    color: cores.branco,
    fontWeight: '700',
    fontSize: 13,
  },
  erroBox: {
    backgroundColor: cores.erroFundo,
    borderWidth: 1,
    borderColor: cores.erroBorda,
    borderRadius: raio.md,
    padding: espaco.md,
    margin: espaco.lg,
    marginBottom: 0,
  },
  erroTexto: {
    color: cores.erro,
    fontSize: 14,
  },
  lista: {
    padding: espaco.lg,
    gap: espaco.xl,
  },
  secao: {
    gap: espaco.sm,
  },
  secaoTitulo: {
    ...tipografia.rotulo,
    color: cores.textoSecundario,
  },
  secaoSubtitulo: {
    fontSize: 12,
    color: cores.textoTerciario,
    marginTop: -4,
  },
  centro: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: espaco.xxl,
    gap: espaco.md,
  },
  vazioTexto: {
    fontSize: 14,
    color: cores.textoSecundario,
    textAlign: 'center',
  },
  botaoRetry: {
    backgroundColor: cores.primaria,
    borderRadius: raio.md,
    paddingHorizontal: espaco.xl,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoRetryTexto: {
    color: cores.onPrimaria,
    fontWeight: '700',
    fontSize: 14,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: cores.fundoCard,
    borderRadius: raio.lg,
    padding: espaco.md,
    borderWidth: 1,
    borderColor: cores.borda,
    gap: espaco.md,
    ...sombraCard,
  },
  itemCardPressionado: {
    backgroundColor: neutro[100],
  },
  itemThumbWrap: {
    width: 56,
    height: 56,
  },
  itemThumb: {
    width: 56,
    height: 56,
    borderRadius: raio.sm,
  },
  itemThumbProduto: {
    backgroundColor: cores.fundoCard,
  },
  itemThumbVazio: {
    backgroundColor: cores.borda,
  },
  itemThumbBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    backgroundColor: cores.primaria,
    color: cores.branco,
    fontSize: 10,
    fontWeight: '700',
    borderRadius: raio.sm,
    minWidth: 18,
    textAlign: 'center',
    paddingHorizontal: 4,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  itemInfo: {
    flex: 1,
  },
  itemNomeLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  itemNome: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '600',
    color: cores.texto,
  },
  itemStatusPendente: {
    fontSize: 12,
    color: cores.textoTerciario,
    marginTop: 2,
  },
  itemTagConcorrente: {
    fontSize: 12,
    color: cores.acentoTexto,
    fontWeight: '600',
    marginTop: 2,
  },
  itemVinculo: {
    fontSize: 12,
    fontWeight: '600',
    color: cores.primaria,
    marginTop: 2,
  },
  itemStatusErro: {
    fontSize: 12,
    color: cores.erro,
    marginTop: 2,
    fontWeight: '600',
  },
  itemCampoValor: {
    fontSize: 12,
    color: cores.textoSecundario,
    marginTop: 2,
  },
  linkCancelar: {
    fontSize: 12,
    color: cores.erro,
    fontWeight: '700',
    marginTop: espaco.xs,
  },
  linkFeedback: {
    fontSize: 12,
    color: cores.primaria,
    fontWeight: '700',
    marginTop: espaco.xs,
  },
  badgePendenteAprovacao: {
    fontSize: 12,
    color: cores.acentoTexto,
    marginTop: 2,
    fontWeight: '600',
  },
  badgesColuna: {
    gap: 4,
    alignItems: 'flex-end',
  },
  badgePendenteEnvio: {
    backgroundColor: cores.primariaClara,
    color: cores.primariaEscura,
    fontSize: 11,
    fontWeight: '700',
    borderRadius: raio.sm,
    paddingHorizontal: espaco.sm,
    paddingVertical: 2,
  },
  badgeRuptura: {
    backgroundColor: cores.erroFundo,
    color: cores.erro,
    fontSize: 12,
    fontWeight: '700',
    borderRadius: raio.sm,
    paddingHorizontal: espaco.sm,
    paddingVertical: 2,
  },
  badgeContagem: {
    backgroundColor: cores.acentoClaro,
    color: cores.acentoTexto,
    fontSize: 12,
    fontWeight: '700',
    borderRadius: raio.pill,
    minWidth: 20,
    textAlign: 'center',
    paddingHorizontal: espaco.sm,
    paddingVertical: 2,
  },
  botaoDetalhes: {
    width: 28,
    height: 28,
    borderRadius: raio.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoDetalhesTexto: {
    fontSize: 18,
    color: cores.textoTerciario,
    fontWeight: '700',
  },
  rodape: {
    flexDirection: 'row',
    gap: espaco.md,
    padding: espaco.lg,
    backgroundColor: cores.fundoCard,
    borderTopWidth: 1,
    borderTopColor: cores.divisor,
  },
  botaoSecundario: {
    flex: 1,
    flexDirection: 'row',
    gap: espaco.sm,
    minHeight: 52,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.primaria,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoSecundarioTexto: {
    color: cores.primaria,
    fontSize: 15,
    fontWeight: '700',
  },
  botaoPrimario: {
    flex: 1,
    flexDirection: 'row',
    gap: espaco.sm,
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
    color: cores.onPrimaria,
    fontSize: 15,
    fontWeight: '700',
  },
  botaoPressionado: {
    opacity: 0.85,
  },
});
