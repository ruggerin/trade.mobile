import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AdicionarProdutoSortimentoModal } from '../components/AdicionarProdutoSortimentoModal';
import { RegistroFormModal, type RegistroFormResultado } from '../components/RegistroFormModal';
import { buscarProdutosDisponiveis } from '../lib/api/campanhas';
import { buscarAutonomiaCatalogo, buscarAutonomiaSortimento, buscarCancelamentoRegistroPermitido } from '../lib/api/parametros';
import { buscarSortimento } from '../lib/api/sortimentoPontoVenda';
import { listarTiposRegistro } from '../lib/api/tiposRegistro';
import { useAuth } from '../lib/auth/AuthContext';
import { resolverGranularidade } from '../lib/granularidadeChecklist';
import { obterLocalizacaoAtual } from '../lib/location/useLocalizacaoAtual';
import { useEstaOnline } from '../lib/network';
import type { PontosVendaStackParamList } from '../navigation/PontosVendaStack';
import type { ProdutoDisponivel, SortimentoPontoVenda, TipoRegistro } from '../types/api';
import type { RegistroLocal } from '../lib/db/filaRegistros';
import {
  cancelarRegistroVisitaLocal,
  criarRegistroVisitaLocal,
  descartarVisitaRejeitada,
  finalizarVisitaLocal,
  lerVisitaLocal,
  listarRegistrosLocais,
} from '../lib/visitaLocal';
import { useAoAtualizarFilaEnvio } from '../lib/useFilaEnvioAtualizada';

type Props = NativeStackScreenProps<PontosVendaStackParamList, 'VisitaAndamento'>;
type Aba = 'ACOES' | 'PRODUTOS' | 'REGISTROS';

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
  propriedade: string | null;
  pendente: boolean;
  produtoChave: boolean;
  secaoUuid: string | null;
  secaoDescricao: string | null;
}

interface ContextoModal {
  produto: { uuid: string; descricao: string } | null;
}

// docs/05-APP-MOBILE-UX.md §3.5 — tela mais usada do app: lista de produtos a auditar
// (agrupada por campanha) + "Registro geral" + finalizar visita. A visita e os registros vivem
// na fila de envio local (ver docs/04-APP-MOBILE.md "Fila offline de envio") até serem
// confirmados pelo servidor — esta tela nunca fala com a API diretamente, só lê/escreve o
// SQLite local (lib/visitaLocal.ts) e deixa o motor de sincronização (lib/filaEnvio.ts) cuidar
// do envio sozinho, em segundo plano, quando houver rede.
// Três abas com papéis bem separados: "Ações" são tarefas obrigatórias específicas desta
// visita (TipoRegistro.acao_obrigatoria — ex.: "Auditar contrato de expositor"), resolvidas por
// escopo (SEMPRE/CAMPANHA/CONTRATO, ver App\Enums\EscopoAcaoTipoRegistro no backend); "Produtos"
// é o checklist de auditoria/campanha e sortimento (o que precisa ser conferido); "Registros"
// lista TODOS os registros já feitos nesta visita — geral ou vinculado a produto, campanha ou
// avulso — pra nada "sumir" da vista do promotor só porque o card da aba Produtos mostra status
// agregado, não cada registro individual. Cancelar (com confirmação) é permitido ali,
// parametrizável por empresa — ver REGISTRO_CANCELAMENTO_PERMITIDO em lib/api/parametros.ts.
export function VisitaAndamentoScreen({ route, navigation }: Props) {
  const { visitaLocalId } = route.params;
  const { usuario } = useAuth();
  const queryClient = useQueryClient();
  const online = useEstaOnline();
  const [erroRegistro, setErroRegistro] = useState<string | null>(null);
  const [modalAberto, setModalAberto] = useState(false);
  const [contextoModal, setContextoModal] = useState<ContextoModal>({ produto: null });
  // Só preenchido quando o formulário abre a partir da aba Ações — pula a etapa de escolher o
  // tipo, já que a Ação em si já É um TipoRegistro específico. Ver RegistroFormModal.tipoFixo.
  const [tipoFixoModal, setTipoFixoModal] = useState<TipoRegistro | null>(null);
  const [aba, setAba] = useState<Aba>('ACOES');
  const [modalAdicionarProdutoAberto, setModalAdicionarProdutoAberto] = useState(false);
  // Só pra distinguir "nunca existiu" de "existiu e acabou de ser apagada porque terminou de
  // sincronizar" quando a query de baixo devolve null — ver useEffect mais abaixo.
  const jaViuVisita = useRef(false);

  const visitaQuery = useQuery({
    queryKey: ['visita-local', visitaLocalId],
    queryFn: () => lerVisitaLocal(visitaLocalId),
  });
  const visita = visitaQuery.data ?? null;
  if (visita) jaViuVisita.current = true;

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
  }, [queryClient, visitaLocalId]);
  useAoAtualizarFilaEnvio(releLocal);

  const pontoVenda = visita?.pontoVenda;
  const pontoVendaUuid = pontoVenda?.id;

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

  // Só os itens de tipo_item PRODUTO viram linha no checklist — ver ItemSortimentoProduto.
  const itensSortimento = useMemo<ItemSortimentoProduto[]>(() => {
    return (sortimentoQuery.data ?? [])
      .filter((item): item is SortimentoPontoVenda & { produto: NonNullable<SortimentoPontoVenda['produto']> } =>
        item.tipo_item === 'PRODUTO' && item.produto !== null,
      )
      .map((item) => ({
        produtoUuid: item.produto.id,
        descricao: item.produto.descricao,
        propriedade: item.produto.propriedade,
        pendente: item.status_aprovacao === 'PENDENTE',
        produtoChave: item.produto.produto_chave,
        secaoUuid: item.produto.secao_uuid,
        secaoDescricao: item.produto.secao_descricao,
      }));
  }, [sortimentoQuery.data]);
  const produtosJaNoSortimento = useMemo(() => new Set(itensSortimento.map((i) => i.produtoUuid)), [itensSortimento]);

  const gruposSortimentoPorPropriedade = useMemo(() => {
    const nossos = itensSortimento.filter((i) => i.propriedade !== 'CONCORRENTE');
    const concorrentes = itensSortimento.filter((i) => i.propriedade === 'CONCORRENTE');
    const grupos: { titulo: string; itens: ItemSortimentoProduto[] }[] = [];
    if (nossos.length > 0) grupos.push({ titulo: 'Sortimento — nossos produtos', itens: nossos });
    if (concorrentes.length > 0) grupos.push({ titulo: 'Sortimento — concorrentes', itens: concorrentes });
    return grupos;
  }, [itensSortimento]);

  const tiposRegistroQuery = useQuery({
    queryKey: ['tipos-registro'],
    queryFn: listarTiposRegistro,
  });
  const tiposRegistro = useMemo(
    () => (tiposRegistroQuery.data ?? []).filter((t) => t.ativo),
    [tiposRegistroQuery.data],
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
        imagem_url: null,
        propriedade: i.propriedade,
        produto_chave: i.produtoChave,
        secao_uuid: i.secaoUuid,
        secao_descricao: i.secaoDescricao,
        campanha_uuid: '',
        campanha_descricao: '',
      }));
    return [...produtos, ...extras];
  }, [produtos, itensSortimento]);

  const totalConferidos = produtos.filter((p) => (registrosPorProduto.get(p.produto_uuid)?.length ?? 0) > 0).length;
  // Contador do sortimento é só informativo, separado do de campanha — não se misturam nem se
  // filtram entre si (ver docs/14-SORTIMENTO-PONTO-VENDA.md §8.3).
  const totalConferidosSortimento = itensSortimento.filter(
    (i) => (registrosPorProduto.get(i.produtoUuid)?.length ?? 0) > 0,
  ).length;

  // Produtos-chave (campanha ou sortimento) sem nenhum registro — nomeados na confirmação de
  // finalizar em vez de só contados, ver confirmarFinalizacao() e
  // docs/16-GRANULARIDADE-CHECKLIST-AUDITORIA.md §6. Dedup por uuid (o mesmo produto pode vir
  // tanto de campanha quanto de sortimento).
  const produtosChaveFaltando = useMemo(() => {
    const nomes = new Map<string, string>();
    for (const p of produtos) {
      if (p.produto_chave && (registrosPorProduto.get(p.produto_uuid)?.length ?? 0) === 0) {
        nomes.set(p.produto_uuid, p.descricao);
      }
    }
    for (const i of itensSortimento) {
      if (i.produtoChave && (registrosPorProduto.get(i.produtoUuid)?.length ?? 0) === 0) {
        nomes.set(i.produtoUuid, i.descricao);
      }
    }
    return Array.from(nomes.values());
  }, [produtos, itensSortimento, registrosPorProduto]);

  // Seções com ao menos uma pergunta elegível pra grade (Fase 2, ver
  // docs/16-GRANULARIDADE-CHECKLIST-AUDITORIA.md §9) — junta produtos de campanha e sortimento
  // por seção, dedup por uuid, só entra na lista se resolverGranularidade achar PRODUTO pra
  // algum tipo simples (sem foto, sem campos customizados) nessa seção específica.
  const gruposSecaoComGrade = useMemo(() => {
    const porSecao = new Map<string, { descricao: string; produtos: Map<string, string> }>();

    function adicionar(secaoUuid: string | null, secaoDescricao: string | null, produtoUuid: string, produtoDescricao: string) {
      if (!secaoUuid || !secaoDescricao) return;
      const grupo = porSecao.get(secaoUuid) ?? { descricao: secaoDescricao, produtos: new Map<string, string>() };
      grupo.produtos.set(produtoUuid, produtoDescricao);
      porSecao.set(secaoUuid, grupo);
    }

    for (const p of produtos) adicionar(p.secao_uuid, p.secao_descricao, p.produto_uuid, p.descricao);
    for (const i of itensSortimento) adicionar(i.secaoUuid, i.secaoDescricao, i.produtoUuid, i.descricao);

    const grupos: { secaoUuid: string; secaoDescricao: string; produtos: { uuid: string; descricao: string }[] }[] = [];
    for (const [secaoUuid, grupo] of porSecao) {
      const temColuna = tiposRegistro.some(
        (t) => !t.exige_foto && t.campos.length === 0 && resolverGranularidade(t, secaoUuid) === 'PRODUTO',
      );
      if (!temColuna) continue;
      grupos.push({
        secaoUuid,
        secaoDescricao: grupo.descricao,
        produtos: Array.from(grupo.produtos.entries()).map(([uuid, descricao]) => ({ uuid, descricao })),
      });
    }
    return grupos.sort((a, b) => a.secaoDescricao.localeCompare(b.secaoDescricao));
  }, [produtos, itensSortimento, tiposRegistro]);

  const criarRegistroMutation = useMutation({
    mutationFn: (resultado: RegistroFormResultado) =>
      criarRegistroVisitaLocal({
        usuarioId: usuario!.id,
        visitaLocalId,
        produtoDescricao: contextoModal.produto?.descricao,
        resultado,
      }),
    onSuccess: () => {
      setErroRegistro(null);
      setModalAberto(false);
      releLocal();
    },
    onError: () => setErroRegistro('Não foi possível salvar o registro neste aparelho. Tente de novo.'),
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

  function abrirModalGeral() {
    setErroRegistro(null);
    setContextoModal({ produto: null });
    setTipoFixoModal(null);
    setModalAberto(true);
  }

  function abrirModalProduto(produto: { uuid: string; descricao: string }) {
    setErroRegistro(null);
    setContextoModal({ produto });
    setTipoFixoModal(null);
    setModalAberto(true);
  }

  function abrirModalAcao(tipo: TipoRegistro) {
    setErroRegistro(null);
    setContextoModal({ produto: null });
    setTipoFixoModal(tipo);
    setModalAberto(true);
  }

  function confirmarFinalizacao() {
    const rupturas = registrosLocais.filter((r) => r.ruptura).length;
    const naoConferidos = produtos.length - totalConferidos;

    const partes: string[] = [];
    if (produtos.length > 0) partes.push(`${totalConferidos} de ${produtos.length} itens conferidos`);
    if (rupturas > 0) partes.push(`${rupturas} ruptura(s)`);
    partes.push(`${registrosAvulsos.length} registro(s) geral(is)`);

    let mensagem = `${partes.join(', ')}.`;
    if (produtosChaveFaltando.length > 0) {
      const verbo = produtosChaveFaltando.length === 1 ? 'não foi registrado' : 'não foram registrados';
      mensagem += ` Cadê ${produtosChaveFaltando.join(', ')}? ${verbo}.`;
    }
    mensagem +=
      naoConferidos > 0
        ? ` ${naoConferidos} item(ns) da campanha não foram conferidos — deseja finalizar mesmo assim?`
        : ' Deseja finalizar a visita?';

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
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (!visita) {
    // Se a visita já tinha aparecido antes e sumiu, é porque terminou de sincronizar (check-in +
    // registros + checkout todos confirmados) enquanto o promotor ainda estava nesta tela —
    // sucesso, não erro. Ver excluirVisitaLocalCompleta em lib/db/filaVisitas.ts.
    if (jaViuVisita.current) {
      return (
        <View style={styles.centroTela}>
          <Text style={styles.vazioTexto}>Visita sincronizada com sucesso.</Text>
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
        {produtos.length > 0 && (
          <Text style={styles.progresso}>
            {totalConferidos} de {produtos.length} itens de campanha conferidos
          </Text>
        )}
        {itensSortimento.length > 0 && (
          <Text style={styles.progresso}>
            {totalConferidosSortimento} de {itensSortimento.length} itens de sortimento registrados
          </Text>
        )}

        {visita.status === 'REJEITADA' ? (
          <View style={[styles.statusBox, styles.statusBoxErro]}>
            <Text style={styles.statusBoxTexto}>
              Check-in recusado pelo servidor{visita.erro ? `: ${visita.erro}` : ''}.
            </Text>
            <Pressable style={styles.botaoDescartar} onPress={confirmarDescarte} disabled={descartarMutation.isPending}>
              <Text style={styles.botaoDescartarTexto}>
                {descartarMutation.isPending ? 'Descartando...' : 'Descartar visita'}
              </Text>
            </Pressable>
          </View>
        ) : !visita.servidorId ? (
          <View style={styles.statusBox}>
            <Text style={styles.statusBoxTexto}>
              {online ? 'Enviando check-in...' : 'Sem conexão — check-in será enviado quando o sinal voltar.'}
            </Text>
          </View>
        ) : null}
      </View>

      {erroRegistro && !modalAberto && (
        <View style={styles.erroBox}>
          <Text style={styles.erroTexto}>{erroRegistro}</Text>
        </View>
      )}

      <View style={styles.abas}>
        <Pressable style={[styles.aba, aba === 'ACOES' && styles.abaAtiva]} onPress={() => setAba('ACOES')}>
          <Text style={[styles.abaTexto, aba === 'ACOES' && styles.abaTextoAtivo]}>Ações</Text>
        </Pressable>
        <Pressable style={[styles.aba, aba === 'PRODUTOS' && styles.abaAtiva]} onPress={() => setAba('PRODUTOS')}>
          <Text style={[styles.abaTexto, aba === 'PRODUTOS' && styles.abaTextoAtivo]}>Produtos</Text>
        </Pressable>
        <Pressable style={[styles.aba, aba === 'REGISTROS' && styles.abaAtiva]} onPress={() => setAba('REGISTROS')}>
          <Text style={[styles.abaTexto, aba === 'REGISTROS' && styles.abaTextoAtivo]}>Registros</Text>
        </Pressable>
      </View>

      {aba === 'ACOES' ? (
        <ScrollView contentContainerStyle={styles.lista}>
          <View style={styles.secao}>
            <Text style={styles.secaoTitulo}>Ações</Text>
            <Text style={styles.secaoSubtitulo}>
              Tarefas obrigatórias desta visita, além do checklist de produtos — toque pra
              registrar.
            </Text>
            {tiposRegistroQuery.isLoading ? (
              <View style={styles.centro}>
                <ActivityIndicator color="#2563eb" />
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
        </ScrollView>
      ) : aba === 'PRODUTOS' ? (
        <ScrollView contentContainerStyle={styles.lista}>
          {produtosQuery.isLoading && (
            <View style={styles.centro}>
              <ActivityIndicator color="#2563eb" />
            </View>
          )}

          {produtosQuery.isError && (
            <View style={styles.centro}>
              <Text style={styles.vazioTexto}>Não foi possível carregar os itens da campanha.</Text>
              <Pressable style={styles.botaoRetry} onPress={() => void produtosQuery.refetch()}>
                <Text style={styles.botaoRetryTexto}>Tentar novamente</Text>
              </Pressable>
            </View>
          )}

          {gruposSecaoComGrade.length > 0 && (
            <View style={styles.secao}>
              <Text style={styles.secaoTitulo}>Checklist em grade</Text>
              <Text style={styles.secaoSubtitulo}>
                Marque vários produtos de uma linha de uma vez, por pergunta — em vez de um
                registro por vez.
              </Text>
              {gruposSecaoComGrade.map((grupo) => {
                const respondidos = grupo.produtos.filter((p) => (registrosPorProduto.get(p.uuid)?.length ?? 0) > 0).length;
                return (
                  <Pressable
                    key={grupo.secaoUuid}
                    style={({ pressed }) => [styles.itemCard, pressed && styles.itemCardPressionado]}
                    onPress={() =>
                      navigation.navigate('GradeColeta', {
                        visitaLocalId,
                        secaoUuid: grupo.secaoUuid,
                        secaoDescricao: grupo.secaoDescricao,
                        produtos: grupo.produtos,
                      })
                    }
                  >
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemNome}>{grupo.secaoDescricao}</Text>
                      <Text style={styles.itemStatusPendente}>
                        {respondidos} de {grupo.produtos.length} produto(s)
                      </Text>
                    </View>
                    <Text style={styles.linkGrade}>Preencher ›</Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          {gruposPorCampanha.map((grupo) => (
            <View key={grupo.campanhaUuid} style={styles.secao}>
              <Text style={styles.secaoTitulo}>{grupo.titulo}</Text>
              {grupo.produtos.map((produto) => (
                <ProdutoItem
                  key={produto.produto_uuid}
                  descricao={produto.descricao}
                  registros={registrosPorProduto.get(produto.produto_uuid) ?? []}
                  onPress={() => abrirModalProduto({ uuid: produto.produto_uuid, descricao: produto.descricao })}
                />
              ))}
            </View>
          ))}

          {gruposSortimentoPorPropriedade.map((grupo) => (
            <View key={grupo.titulo} style={styles.secao}>
              <Text style={styles.secaoTitulo}>{grupo.titulo}</Text>
              {grupo.itens.map((item) => (
                <ProdutoItem
                  key={item.produtoUuid}
                  descricao={item.descricao}
                  registros={registrosPorProduto.get(item.produtoUuid) ?? []}
                  tagPendente={item.pendente}
                  onPress={() => abrirModalProduto({ uuid: item.produtoUuid, descricao: item.descricao })}
                />
              ))}
            </View>
          ))}

          {produtosQuery.isSuccess && !sortimentoQuery.isLoading && produtos.length === 0 && itensSortimento.length === 0 && (
            <View style={styles.centro}>
              <Text style={styles.vazioTexto}>Nenhum produto de campanha ou sortimento pra este PDV ainda.</Text>
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
              Tudo que já foi registrado até agora, geral ou vinculado a um produto — nada some
              da vista, mesmo depois de tocar num item da aba Produtos.
            </Text>
            {registrosLocais.length === 0 ? (
              <Text style={styles.vazioTexto}>
                Nenhum registro ainda. Toque num produto na aba Produtos ou em "Registro geral"
                aqui embaixo pra criar um.
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
                />
              ))
            )}
          </View>
        </ScrollView>
      )}

      <View style={styles.rodape}>
        <Pressable
          style={({ pressed }) => [styles.botaoSecundario, pressed && styles.botaoPressionado]}
          onPress={abrirModalGeral}
        >
          <Text style={styles.botaoSecundarioTexto}>+ Registro geral</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.botaoPrimario, pressed && styles.botaoPressionado]}
          onPress={confirmarFinalizacao}
          disabled={checkoutMutation.isPending}
        >
          {checkoutMutation.isPending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.botaoPrimarioTexto}>Finalizar visita</Text>
          )}
        </Pressable>
      </View>

      <RegistroFormModal
        visible={modalAberto}
        tiposRegistro={tiposRegistro}
        produtosDisponiveis={produtosParaVincular}
        produtoContexto={contextoModal.produto}
        tipoFixo={tipoFixoModal}
        enviando={criarRegistroMutation.isPending}
        erro={erroRegistro}
        onClose={() => {
          setModalAberto(false);
          setErroRegistro(null);
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
    </View>
  );
}

function ProdutoItem({
  descricao,
  registros,
  tagPendente,
  onPress,
}: {
  descricao: string;
  registros: RegistroLocal[];
  // Item de sortimento adicionado pelo próprio promotor em modo REQUER_APROVACAO — ainda dá pra
  // registrar normalmente, só não é oficial até o gestor decidir. Ver
  // docs/14-SORTIMENTO-PONTO-VENDA.md §9.
  tagPendente?: boolean;
  onPress: () => void;
}) {
  const registroComFoto = registros.find((r) => r.imagemLocalPath);
  const temRuptura = registros.some((r) => r.ruptura);
  const temErro = registros.some((r) => r.status === 'ERRO');
  const conferido = registros.length > 0;

  return (
    <Pressable style={({ pressed }) => [styles.itemCard, pressed && styles.itemCardPressionado]} onPress={onPress}>
      {registroComFoto?.imagemLocalPath ? (
        <Image source={{ uri: registroComFoto.imagemLocalPath }} style={styles.itemThumb} />
      ) : (
        <View style={[styles.itemThumb, styles.itemThumbVazio]} />
      )}

      <View style={styles.itemInfo}>
        <Text style={styles.itemNome} numberOfLines={2}>
          {descricao}
        </Text>
        {!conferido && <Text style={styles.itemStatusPendente}>Não conferido</Text>}
        {temErro && <Text style={styles.itemStatusErro}>Um registro não foi aceito pelo servidor</Text>}
        {tagPendente && <Text style={styles.badgePendenteAprovacao}>Pendente de aprovação</Text>}
      </View>

      {temRuptura && <Text style={styles.badgeRuptura}>Ruptura</Text>}
    </Pressable>
  );
}

function RegistroCard({
  registro,
  tipoRegistro,
  podeCancelar,
  cancelando,
  onCancelar,
}: {
  registro: RegistroLocal;
  tipoRegistro: TipoRegistro | undefined;
  podeCancelar: boolean;
  cancelando: boolean;
  onCancelar: () => void;
}) {
  const vinculoLabel = registro.produtoDescricao ?? registro.vinculoDescricao;
  const valoresCampos = registro.valoresCampos ? Object.entries(registro.valoresCampos) : [];

  return (
    <View style={styles.itemCard}>
      {registro.imagemLocalPath ? (
        <Image source={{ uri: registro.imagemLocalPath }} style={styles.itemThumb} />
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
        {podeCancelar && (
          <Pressable onPress={onCancelar} disabled={cancelando} hitSlop={8}>
            <Text style={styles.linkCancelar}>{cancelando ? 'Cancelando...' : 'Cancelar registro'}</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.badgesColuna}>
        {registro.status === 'PENDENTE' && <Text style={styles.badgePendenteEnvio}>Aguardando envio</Text>}
        {registro.ruptura && <Text style={styles.badgeRuptura}>Ruptura</Text>}
        {registro.momento && (
          <Text style={registro.momento === 'ANTES' ? styles.badgeAntes : styles.badgeDepois}>
            {registro.momento === 'ANTES' ? 'Antes' : 'Depois'}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  centroTela: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
    backgroundColor: '#ffffff',
  },
  abas: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  aba: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  abaAtiva: {
    borderBottomColor: '#2563eb',
  },
  abaTexto: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
  },
  abaTextoAtivo: {
    color: '#2563eb',
  },
  cabecalho: {
    backgroundColor: '#ffffff',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    gap: 4,
  },
  pdvNome: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  inicioTexto: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  progresso: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2563eb',
    marginTop: 8,
  },
  statusBox: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
  },
  statusBoxErro: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  statusBoxTexto: {
    fontSize: 13,
    color: '#92400e',
  },
  botaoDescartar: {
    marginTop: 10,
    alignSelf: 'flex-start',
    minHeight: 40,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#b91c1c',
  },
  botaoDescartarTexto: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  erroBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    padding: 12,
    margin: 16,
    marginBottom: 0,
  },
  erroTexto: {
    color: '#b91c1c',
    fontSize: 14,
  },
  lista: {
    padding: 16,
    gap: 20,
  },
  secao: {
    gap: 8,
  },
  secaoTitulo: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
  },
  secaoSubtitulo: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: -4,
  },
  centro: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 12,
  },
  vazioTexto: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  botaoRetry: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingHorizontal: 20,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoRetryTexto: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 12,
  },
  itemCardPressionado: {
    backgroundColor: '#f3f4f6',
  },
  itemThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
  },
  itemThumbVazio: {
    backgroundColor: '#e5e7eb',
  },
  itemInfo: {
    flex: 1,
  },
  itemNome: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  itemStatusPendente: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  linkGrade: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2563eb',
  },
  itemVinculo: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563eb',
    marginTop: 2,
  },
  itemStatusErro: {
    fontSize: 12,
    color: '#b91c1c',
    marginTop: 2,
    fontWeight: '600',
  },
  itemCampoValor: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  linkCancelar: {
    fontSize: 12,
    color: '#b91c1c',
    fontWeight: '700',
    marginTop: 6,
  },
  badgePendenteAprovacao: {
    fontSize: 12,
    color: '#92400e',
    marginTop: 2,
    fontWeight: '600',
  },
  badgesColuna: {
    gap: 4,
    alignItems: 'flex-end',
  },
  badgePendenteEnvio: {
    backgroundColor: '#eff6ff',
    color: '#1d4ed8',
    fontSize: 11,
    fontWeight: '700',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeRuptura: {
    backgroundColor: '#fef2f2',
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: '700',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeAntes: {
    backgroundColor: '#fff7ed',
    color: '#c2410c',
    fontSize: 12,
    fontWeight: '700',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeDepois: {
    backgroundColor: '#f0fdf4',
    color: '#15803d',
    fontSize: 12,
    fontWeight: '700',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  rodape: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  botaoSecundario: {
    flex: 1,
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoSecundarioTexto: {
    color: '#2563eb',
    fontSize: 15,
    fontWeight: '700',
  },
  botaoPrimario: {
    flex: 1,
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
  botaoPressionado: {
    opacity: 0.8,
  },
});
