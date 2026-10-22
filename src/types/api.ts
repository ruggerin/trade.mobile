// Tipos espelhando os JsonResource da API (api/app/Http/Resources/) — `id` é sempre o uuid
// (string), nunca o bigint interno, ver docs/02-API-BACKEND.md#convenção-de-identificadores-na-api.
// Só os tipos usados pelo app mobile — não precisa duplicar o types/api.ts inteiro do admin.

export type UserType = 'SUPERADMIN' | 'ADMIN' | 'GESTOR' | 'PROMOTOR';

export interface Empresa {
  id: string;
  razao_social: string;
  nome_fantasia: string;
  cnpj: string;
  // Módulo pago Pedido de Venda (docs/38-PEDIDO-VENDEDOR.md §12) — sem ele, nada de aba Pedidos.
  pedidos_venda_habilitado?: boolean;
  // Régua de XP (docs/88): recurso de plano + o que o promotor pode ver (modo prévia, pendente, liga).
  controle_xp_habilitado?: boolean;
  xp?: { visivel_promotor: boolean; pendente_visivel_promotor: boolean; ranking_habilitado: boolean };
  ativo: boolean;
}

export interface Dispositivo {
  identificador: string;
  nome: string | null;
  ultimo_acesso_em: string;
}

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  user_type: UserType;
  ativo: boolean;
  avatar_url: string | null;
  // Foto enviada pelo próprio usuário — rota autenticada, separada de avatar_url (texto livre
  // do admin web). Sempre nossa própria API, nunca um host externo — ver PerfilScreen.tsx.
  foto_url: string | null;
  empresa?: Empresa;
  dispositivo?: Dispositivo | null;
  // Permissões do perfil — o app decide o que mostrar por elas, ex.: aba "Pedidos" só com
  // pedidos_venda.criar ("modo Vendedor", docs/38-PEDIDO-VENDEDOR.md §4).
  perfil?: { id: string; nome: string; permissoes?: string[] } | null;
  // Termos/Política com versão vigente ainda não aceita (docs/58 §5.3) — vem no login e no
  // /auth/me. Não vazio = o app mostra a tela de aceite no lugar das abas.
  documentos_pendentes?: DocumentoPendente[];
}

export type TipoDocumentoLegal = 'TERMOS_USO' | 'POLITICA_PRIVACIDADE';

export interface DocumentoPendente {
  tipo: TipoDocumentoLegal;
  versao: string;
}

export interface PontoVenda {
  id: string;
  codigo_externo: string | null;
  razao_social: string;
  fantasia: string;
  latitude: number;
  longitude: number;
  endereco: string;
  numero: string | null;
  bairro: string | null;
  cidade: string;
  // UF (docs/78 §5) — ausente em cache antigo e null nas lojas que ainda não têm.
  uf?: string | null;
  cep: string | null;
  telefone: string | null;
  email: string | null;
  numero_checkouts: number | null;
  cnpj?: string | null;
  // Rota autenticada (Bearer), mesmo padrão de Usuario.foto_url — nunca a URL direta do disco.
  fachada_url: string | null;
  rede_loja: { id: string; descricao: string } | null;
  ramo_atividade: { id: string; descricao: string } | null;
  // Não expõe dado nenhum do contrato em si (isso continua só no admin web) — só esse booleano,
  // usado pra resolver a Ação de escopo CONTRATO (ver TipoRegistro.escopo_acao).
  tem_contrato_ativo: boolean;
  // Só título/tipo/vigência dos contratos vigentes (nunca metas nem valores) — lista da aba Dados
  // cadastrais. Ausente em cache antigo.
  contratos_ativos?: ContratoAtivo[];
  // Vendedores do ERP que atendem a loja (carteira, docs/73 §11.1) — só no detalhe (online). O
  // e-mail não vem pro promotor.
  vendedores?: VendedorDaLoja[];
  ativo: boolean;
}

export interface VendedorDaLoja {
  id: string;
  codigo_externo: string;
  nome: string;
  telefone: string | null;
  ativo: boolean;
  supervisor: { id: string; nome: string } | null;
}

export interface ContratoAtivo {
  id: string;
  tipo: 'COMODATO' | 'PONTO_EXTRA';
  titulo: string | null;
  vigencia_fim: string | null;
}

export interface PaginatedMeta {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
}

// Referência visual de layout de prateleira/expositor — ver docs/22-PLANOGRAMA.md. O promotor
// só consulta (nunca edita), por isso o mobile só lê estes tipos.
export interface PlanogramaBloco {
  id: string;
  posicao_inicio: number;
  largura: number;
  produto_auditoria: { id: string; descricao: string; imagem_url: string | null } | null;
}

export interface PlanogramaPrateleira {
  id: string;
  ordem: number;
  descricao: string | null;
  quantidade_blocos: number;
  blocos: PlanogramaBloco[];
}

export interface Planograma {
  id: string;
  descricao: string;
  // Exige Authorization: Bearer pra buscar (rota autenticada, não é um <Image> comum) — ver
  // lib/api/planogramas.ts.
  foto_capa_url: string | null;
  ativo: boolean;
  prateleiras: PlanogramaPrateleira[];
}

export type StatusVisita = 'ABERTA' | 'FINALIZADA' | 'CANCELADA';
// Sem EXPIRADA persistido de propósito — calculado na exibição (PENDENTE + prazo_fim no
// passado), mesmo padrão do admin web. Ver docs/07-ORDEM-DE-SERVICO.md.
// Os três últimos só existem quando a empresa exige aprovação pra ações do promotor sobre a
// própria agenda (Parametro AGENDA_REQUER_APROVACAO). Ver docs/13-AGENDA-MOBILE-E-AUTONOMIA.md.
export type StatusOrdemServico =
  | 'PENDENTE'
  | 'EM_ANDAMENTO'
  | 'CONCLUIDA'
  | 'CANCELADA'
  | 'AGUARDANDO_APROVACAO'
  | 'REAGENDAMENTO_SOLICITADO'
  | 'CANCELAMENTO_SOLICITADO';
// Origem de uma OrdemServico — AGENDA é a rotina fixa configurada pelo gestor (dia da semana ou
// data específica), ver docs/10-AGENDA-VISITA.md. O app não distingue visualmente por origem,
// só usa tipo/prioridade/horário, que valem pra qualquer uma.
export type OrigemOrdemServico = 'MANUAL' | 'CAMPANHA' | 'AGENDA' | 'CONTRATO' | 'DIRECIONAMENTO';
export type PrioridadeVisita = 'BAIXA' | 'MEDIA' | 'ALTA';

// Tag colorida da OS — ver docs/10-AGENDA-VISITA.md.
export interface TipoVisita {
  id: string;
  descricao: string;
  cor: string;
}

// Motivo de negócio do compromisso (ex. "Reposição", "Negociação") — eixo diferente do tipo de
// visita (que é a classificação visual). Ver docs/13-AGENDA-MOBILE-E-AUTONOMIA.md.
export interface ObjetivoVisita {
  id: string;
  descricao: string;
}

// Compromisso de visita — direcionado pelo gestor ou auto-agendado pelo próprio promotor ("+
// Compromisso" na Agenda) — aparece na aba "Agenda" e como badge na tela de check-in do PDV.
export interface OrdemServico {
  id: string;
  // Régua de XP (docs/88 §6): quanto a visita vale, congelado quando a OS nasceu.
  xp_previsto?: number | null;
  classe?: ClasseLoja | null;
  ponto_venda: { id: string; fantasia: string; endereco?: string; bairro?: string | null };
  usuario: { id: string; nome: string } | null;
  origem: OrigemOrdemServico;
  tipo_visita: TipoVisita | null;
  objetivo_visita: ObjetivoVisita | null;
  prioridade: PrioridadeVisita | null;
  // "HH:mm", só informativo — nunca vira janela rígida de prazo. Ver docs/10-AGENDA-VISITA.md.
  horario_previsto: string | null;
  obrigatoria: boolean;
  prazo_inicio: string;
  prazo_fim: string;
  // Só presentes durante REAGENDAMENTO_SOLICITADO — o prazo oficial acima continua intacto até
  // o gestor decidir. Ver docs/13-AGENDA-MOBILE-E-AUTONOMIA.md.
  prazo_inicio_proposto: string | null;
  prazo_fim_proposto: string | null;
  status: StatusOrdemServico;
  observacao: string | null;
  // Preenchido só quando o gestor rejeitou a solicitação mais recente — ver
  // docs/13-AGENDA-MOBILE-E-AUTONOMIA.md.
  motivo_rejeicao: string | null;
  // Presente só em origem DIRECIONAMENTO — ver docs/25-DIRECIONAMENTO-ORDEM-SERVICO.md.
  direcionamento?: { id: string; descricao: string } | null;
  // Formulários exigidos por esta OS (de um Direcionamento, ou vinculados direto numa OS
  // manual avulsa) — aparecem na aba Ações da visita enquanto respondido_em for null e não
  // houver registro local pra aquele tipo_registro ainda. Ver
  // docs/25-DIRECIONAMENTO-ORDEM-SERVICO.md §6.
  formularios?: {
    tipo_registro: { id: string; descricao: string };
    obrigatorio: boolean;
    calcula_percentual_compliance: boolean;
    respondido_em: string | null;
  }[];
}
// Discriminador de vínculo a um recorte do catálogo mais amplo que um produto — mesmo enum de
// CampanhaItem no backend (TipoItemCampanha), reaproveitado aqui.
export type TipoVinculoRegistro = 'PRODUTO' | 'SECAO' | 'DEPARTAMENTO' | 'MARCA';
export type TipoCampoRegistro = 'NUMERO' | 'TEXTO' | 'MOEDA' | 'MULTIPLA_ESCOLHA' | 'BOOLEANO' | 'DATA' | 'SORTIMENTO';

// Campo de formulário customizado de um TipoRegistro (ex.: "Quantidade" número, "Valor" R$
// pra um tipo "Ponto extra") — ver docs/01-MODELO-DE-DADOS.md#54-tipos-de-registro.
export interface CampoTipoRegistro {
  id: string;
  chave: string;
  rotulo: string;
  tipo_campo: TipoCampoRegistro;
  // Só preenchido quando tipo_campo = MULTIPLA_ESCOLHA.
  opcoes: string[] | null;
  obrigatorio: boolean;
  ordem: number;
  // Só tem efeito quando tipo_campo = DATA (docs/35-LIMITE-RETROATIVO-CAMPO-DATA.md) — `null` =
  // sem limite, aceita qualquer data passada (comportamento padrão, sempre foi assim).
  limite_dias_retroativos: number | null;
  // Campo condicional (docs/20-FORMULARIO-DINAMICO-CAMPANHA.md decisão 7) — `depende_de_chave` é
  // a `chave` de outro campo do mesmo tipo_registro (não um uuid), só aparece/é obrigatório
  // quando esse campo pai tiver o valor `depende_de_valor`.
  depende_de_chave: string | null;
  depende_de_valor: string | null;
  // Campo SORTIMENTO (docs/20-FORMULARIO-DINAMICO-CAMPANHA.md decisão 3) — o app só precisa
  // saber SE ausência vira ruptura confirmável; a lista de produtos em si vem de
  // lib/api/campoSortimento.ts (o backend resolve o resto — origem/recorte não importam aqui).
  confirmar_ruptura_ausentes: boolean;
  // true = o checklist segue a marca/departamento/seção escolhida no início do formulário
  // (docs/79). Opcional: cache antigo não tem.
  sortimento_segue_escolha?: boolean;
}

// Catálogo customizável por empresa do que o promotor pode registrar numa visita — substitui o
// antigo enum fixo FOTO/RUPTURA/OBSERVACAO. Toda empresa nasce com esses 3 como padrão, mas
// pode criar outros (ex.: "Ponto extra") com campos próprios.
// LOJA_REDE = só nas lojas/redes escolhidas no tipo (docs/40-ACAO-OBRIGATORIA-LOJA-REDE.md).
// LINHA_AUSENTE: onde o Mix do PDV não cobre o recorte do tipo (docs/80-MONITORAMENTO-LINHA-AUSENTE.md).
export type EscopoAcaoTipoRegistro = 'SEMPRE' | 'CAMPANHA' | 'CONTRATO' | 'LOJA_REDE' | 'LINHA_AUSENTE';
// MARCA = cada marca concorrente, com embalagem (docs/85).
export type GranularidadeResposta = 'LINHA' | 'PRODUTO' | 'MARCA';

export interface TipoRegistro {
  id: string;
  descricao: string;
  // Slug do Material Design Icons, sem prefixo "mdi-" — renderizado via
  // @expo/vector-icons/MaterialCommunityIcons, mesmo valor que o admin mostra via @mdi/font.
  icone: string | null;
  // Sequência de exibição escolhida pelo gestor no admin — a API já devolve nessa ordem
  // (GET /tipos-registro), mas o cache local (lib/db/tiposRegistroCache.ts) precisa reordenar
  // explicitamente por este campo na leitura, já que SQLite sem ORDER BY não garante preservar
  // a ordem de inserção.
  ordem: number;
  exige_foto: boolean;
  permite_vincular_catalogo: boolean;
  // Ação obrigatória — vira pendência na aba Ações da Visita em Andamento em vez de só uma
  // opção do Registro geral. escopo_acao/campanha_auditoria_uuid só importam quando
  // acao_obrigatoria é true — ver VisitaAndamentoScreen.tsx.
  acao_obrigatoria: boolean;
  escopo_acao: EscopoAcaoTipoRegistro | null;
  campanha_auditoria_uuid: string | null;
  // Escopo LOJA_REDE — loja OU rede do PDV basta; as duas vazias = todas as lojas. Opcional:
  // cache antigo (antes da doc 40) não tem esses campos.
  pontos_venda_uuids?: string[];
  redes_lojas_uuids?: string[];
  // Escopo LINHA_AUSENTE (docs/80 §5.1) — recorte que não pode estar no Mix. A seção traz o
  // departamento dela (item DEPARTAMENTO do Mix cobre a seção). Opcional: cache antigo não tem.
  escopo_tipo_vinculo?: 'SECAO' | 'DEPARTAMENTO' | 'MARCA' | null;
  escopo_secao?: { id: string; descricao: string; departamento_uuid: string | null } | null;
  escopo_departamento?: { id: string; descricao: string } | null;
  escopo_marca?: { id: string; descricao: string } | null;
  // Filtro da Ação por ramo de atividade da loja (docs/80 §5.4) — vazio = todos os ramos.
  ramos_atividade_uuids?: string[];
  // Intervalo entre cobranças da Ação, em dias (docs/80 §5.2) — 0/ausente = toda visita.
  intervalo_dias?: number;
  // Lista predefinida de produtos (granularidade PRODUTO) — com ela, as opções de vínculo são só
  // estes produtos, em qualquer loja. Opcional: cache antigo não tem o campo.
  produtos_predefinidos?: { id: string; descricao: string; codigo_barras: string | null; codigo_externo: string | null }[];
  // Lista guiada de "Cada produto": FIXA = produtos_predefinidos; MIX_LOJA = nossos produtos do
  // Mix de cada loja, checklist de presença (docs/85 §7). Opcional: cache antigo não tem.
  lista_produtos_origem?: 'FIXA' | 'MIX_LOJA';
  // Concorrentes por marca e embalagem (docs/85).
  marcas_predefinidas?: { id: string; descricao: string; a_aprovar: boolean }[];
  permite_marca_nova?: boolean;
  varias_embalagens?: boolean;
  // Granularidade da resposta (linha/seção vs. produto individual) — ver
  // docs/16-GRANULARIDADE-CHECKLIST-AUDITORIA.md §4. `null` = sem regra, vínculo livre (atual).
  // O backend continua sendo a autoridade final (StoreVisitaRegistroRequest); o app usa isto só
  // pra restringir "Vincular a" (RegistroFormModal.exigeProduto) — o checklist em grade que
  // também lia isto foi removido do mobile (22/09/2026, doc 16 §9 descontinuada nesse ponto).
  granularidade_padrao: GranularidadeResposta | null;
  // Promotor escolhe onde é o registro (marca/departamento/seção) antes das perguntas — docs/79.
  // Opcionais: cache antigo não tem.
  escolhe_marca?: boolean;
  escolhe_departamento?: boolean;
  escolhe_secao?: boolean;
  // docs/82: lista "Onde é" (o que a loja tem primeiro, ou só ele) e filtro de marca depois da seção.
  lista_recorte?: 'PRIMEIRO_DA_LOJA' | 'SO_DA_LOJA';
  filtra_marca?: boolean;
  eh_ruptura: boolean;
  // Controla se o tipo aparece solto no dropdown de "criar registro" do promotor — decisão 8 de
  // docs/20-FORMULARIO-DINAMICO-CAMPANHA.md. `false` pra tipos nascidos dentro de uma campanha
  // (já aparecem via Ação obrigatória, não deveriam duplicar no dropdown geral). Ver
  // RegistroFormModal — a lista de tiposRegistro que chega até lá já deveria vir filtrada por
  // isso quando é o fluxo de "Registro geral" (não Ação/campanha).
  disponivel_registro_livre: boolean;
  campos: CampoTipoRegistro[];
  ativo: boolean;
}

export interface CatalogoItem {
  id: string;
  descricao: string;
  // Só nas seções: o departamento dela (agrupar e "departamento cobre a seção", docs/82). Opcional:
  // cache antigo não tem.
  departamento?: { id: string; descricao: string } | null;
}

export interface VisitaRegistro {
  id: string;
  produto_auditoria: { id: string; descricao: string } | null;
  tipo_registro: { id: string; descricao: string };
  tipo_vinculo: TipoVinculoRegistro | null;
  secao: CatalogoItem | null;
  departamento: CatalogoItem | null;
  marca: CatalogoItem | null;
  ruptura: boolean;
  observacao: string | null;
  // Valores dos campos customizados do tipo_registro, chaveados por CampoTipoRegistro.chave.
  valores_campos: Record<string, string> | null;
  // % de compliance (campos Sim/Não e Sortimento que "passaram") — só quando
  // tipo_registro.usa_pontuacao = true, ver docs/20-FORMULARIO-DINAMICO-CAMPANHA.md decisão 5.
  pontuacao: number | null;
  // N fotos (0..N) — ver docs/21-EVIDENCIA-EM-FOTOS.md. Rota autenticada, não é uma URL pública.
  imagens: { id: string; url: string }[];
  // Feedback (docs/28 §3) — total de comentários do registro, pra o link dizer "3 comentários"
  // sem abrir a conversa. Só vem em GET /visitas/{uuid}.
  comentarios_count?: number;
  // Soft — a linha continua existindo mesmo cancelada (rastro histórico). Ver
  // lib/api/parametros.ts::buscarCancelamentoRegistroPermitido.
  cancelado_em: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProdutoDisponivel {
  produto_uuid: string;
  descricao: string;
  imagem_url: string | null;
  // Opcional por padrão — ver App\Support\CodigoBarrasProduto no backend. Mostrado no modal de
  // detalhes do produto (VisitaAndamentoScreen › "Ver detalhes").
  codigo_barras: string | null;
  propriedade: string | null;
  // Gera aviso nomeado ao finalizar a visita se ficar sem registro — ver
  // docs/16-GRANULARIDADE-CHECKLIST-AUDITORIA.md §6.
  produto_chave: boolean;
  // Usado pra agrupar por linha/seção na grade de coleta (Fase 2) — ver
  // docs/16-GRANULARIDADE-CHECKLIST-AUDITORIA.md §9. null quando o produto não tem seção.
  secao_uuid: string | null;
  secao_descricao: string | null;
  campanha_uuid: string;
  campanha_descricao: string;
}

// PENDENTE/REJEITADO só quando o item foi criado por um promotor em modo REQUER_APROVACAO —
// null = não se aplica. Ver docs/14-SORTIMENTO-PONTO-VENDA.md §9.
export type StatusAprovacao = 'PENDENTE' | 'REJEITADO' | null;
// Os 3 níveis de autonomia do promotor sobre self-service (vincular ao sortimento / cadastrar
// produto novo), configurável por empresa. Ver docs/14-SORTIMENTO-PONTO-VENDA.md §9.
export type AutonomiaPromotor = 'DESABILITADO' | 'AUTONOMO' | 'REQUER_APROVACAO';

// Item do sortimento de um PDV — produto (ou seção/departamento/marca inteira) que essa loja
// compra. A aba "Mix" da visita só usa os itens tipo_item = PRODUTO; os demais níveis ainda não
// são resolvidos em produtos individuais no app. Ver docs/14-SORTIMENTO-PONTO-VENDA.md.
export interface SortimentoPontoVenda {
  id: string;
  tipo_item: TipoVinculoRegistro;
  produto: {
    id: string;
    descricao: string;
    imagem_url: string | null;
    codigo_barras: string | null;
    propriedade: string | null;
    produto_chave: boolean;
    secao_uuid: string | null;
    secao_descricao: string | null;
    departamento_uuid: string | null;
    departamento_descricao: string | null;
    // Escopo LINHA_AUSENTE por marca (docs/80). Opcional: cache antigo não tem.
    marca_uuid?: string | null;
  } | null;
  // Item cadastrado como recorte inteiro (tipo_item SECAO/DEPARTAMENTO/MARCA). A seção traz o
  // departamento dela — usado pelo escopo LINHA_AUSENTE (docs/80). Opcionais: cache antigo.
  secao?: { id: string; descricao: string; departamento_uuid?: string | null } | null;
  departamento?: { id: string; descricao: string } | null;
  marca?: { id: string; descricao: string } | null;
  // null = cadastrado pelo admin web; preenchido = adicionado pelo próprio promotor na visita.
  usuario: { id: string; nome: string } | null;
  status_aprovacao: StatusAprovacao;
}

// Produto do catálogo da empresa — usado no seletor "+ adicionar produto loja" (ver
// docs/14-SORTIMENTO-PONTO-VENDA.md §8/§9).
export interface ProdutoCatalogo {
  id: string;
  descricao: string;
  // Opcional por padrão; pode virar obrigatório/único no cadastro via os parâmetros da empresa
  // CODIGO_BARRAS_OBRIGATORIO/CODIGO_BARRAS_UNICO.
  codigo_barras: string | null;
  codigo_externo?: string | null;
  propriedade: string | null;
  ativo: boolean;
  status_aprovacao: StatusAprovacao;
  marca?: { id: string; descricao: string } | null;
  secao?: { id: string; descricao: string } | null;
  // Pedido de Venda (docs/38 §6) — null = sem preço configurado, não pode entrar em pedido.
  preco_tabela?: number | null;
  desconto_maximo_pct?: number | null;
}

// Pedido de Venda digitado pelo vendedor (docs/38-PEDIDO-VENDEDOR.md) — espelha
// PedidoVendaResource da API. Diferente de `pedidos-loja` (somente leitura, espelho do ERP).
export type StatusPedidoVenda = 'RASCUNHO' | 'PENDENTE_AUTORIZACAO' | 'APROVADO' | 'CONCLUIDO' | 'CANCELADO';

export interface PedidoVendaItem {
  id: string;
  produto: {
    id: string;
    descricao: string;
    codigo_barras: string | null;
    codigo_externo: string | null;
    imagem_url: string | null;
  } | null;
  quantidade: number;
  preco_tabela: number;
  desconto_maximo_pct: number | null;
  preco_minimo: number;
  preco: number;
  desconto_pct: number;
  subtotal: number;
  requer_autorizacao: boolean;
}

export interface PedidoVendaHistorico {
  id: string;
  acao: string;
  descricao: string;
  motivo: string | null;
  usuario: { id: string; nome: string } | null;
  created_at: string;
}

export interface PedidoVenda {
  id: string;
  status: StatusPedidoVenda;
  ponto_venda?: { id: string; fantasia: string; razao_social: string | null; cnpj: string | null } | null;
  vendedor?: { id: string; nome: string } | null;
  visita_id?: string | null;
  observacao: string | null;
  total: number | null;
  total_itens: number | null;
  requer_autorizacao: boolean | null;
  itens: PedidoVendaItem[] | null;
  historico?: PedidoVendaHistorico[];
  concluido_em: string | null;
  created_at: string;
  updated_at: string;
}

export interface Visita {
  id: string;
  ponto_venda?: { id: string; razao_social: string; fantasia: string };
  usuario?: { id: string; nome: string };
  // Só vem preenchido quando havia exatamente uma campanha ativa/vigente no momento do
  // check-in (ver VisitaController::resolverCampanhaUnica) — com zero ou mais de uma, null.
  campanha?: { id: string; descricao: string } | null;
  // Presente só quando a visita nasceu de uma OrdemServico direcionada — null pra visita
  // espontânea, que continua sendo o caso comum.
  ordem_servico?: { id: string } | null;
  status: StatusVisita;
  inicio_data: string;
  inicio_latitude: number;
  inicio_longitude: number;
  inicio_distancia_metros: number;
  fim_data: string | null;
  fim_latitude: number | null;
  fim_longitude: number | null;
  fim_distancia_metros: number | null;
  registros?: VisitaRegistro[];
  // Só presente quando a API usa withCount('registros') (ver VisitaController::index) — hoje
  // é o caso de GET /visitas (lista), mas não de GET /visitas/{uuid} (que já carrega
  // `registros` inteiro, tornando a contagem redundante).
  registros_count?: number;
  created_at: string;
  updated_at: string;
}

// "Ainda está lá?" (docs/83) — acompanhamento aberto da loja, da carga do detalhe do PDV.
export type RespostaAcompanhamento = 'CONTINUA' | 'ACABOU' | 'NAO_CONSEGUI_VER';

export interface AcompanhamentoAberto {
  id: string;
  tipo_registro: { id: string; descricao: string };
  /** AAAA-MM-DD: a partir de quando volta a aparecer. */
  proxima_verificacao_em: string | null;
  ultima_resposta_em: string | null;
  expira_em: string | null;
  rotulo_continua: string;
  rotulo_acabou: string;
  ao_continuar: 'CONFIRMA' | 'FORMULARIO_PREENCHIDO' | 'FORMULARIO_CEGO';
  formulario_acabou: { id: string; descricao: string } | null;
  origem: {
    id: string | null;
    criado_em: string | null;
    usuario_nome: string | null;
    miniatura_url: string | null;
    produto: { id: string; descricao: string } | null;
    tipo_vinculo: TipoVinculoRegistro | null;
    secao_uuid: string | null;
    departamento_uuid: string | null;
    marca_uuid: string | null;
    vinculo_descricao: string | null;
    /** Vazio no modo cego. */
    resumo: { rotulo: string; valor: string }[];
    /** Só no modo "preenchido": a última coleta, pra abrir o formulário com ela. */
    valores_campos: Record<string, string> | null;
  };
}

// ---- Régua de XP (docs/88 §12) ----

export interface ClasseLoja {
  nome: string;
  icone: string | null;
  cor: string | null;
}

export interface VisitaDoDiaXp {
  ordem_servico_id: string;
  visita_id: string | null;
  loja: string | null;
  horario: string | null;
  quando: string | null;
  classe: ClasseLoja | null;
  possivel: number;
  ganho: number | null;
  feita: boolean;
}

export interface IniciativaXp {
  descricao: string;
  loja: string | null;
  pontos: number;
  situacao: 'ok' | 'pendente';
}

export interface PosicaoLiga {
  posicao: number;
  participantes: number;
  faltam_para_subir: number | null;
  nome_acima: string | null;
}

export interface PontuacaoHoje {
  dia: string;
  total: number;
  plano: number;
  possivel: number;
  iniciativa: number;
  pendente: number | null;
  ofensiva: number;
  liga: PosicaoLiga | null;
  visitas: VisitaDoDiaXp[];
  iniciativas: IniciativaXp[];
  dica: string | null;
}

export interface Conquista {
  chave: string;
  titulo: string;
  descricao: string;
  conquistada: boolean;
  progresso: number;
  meta: number;
}

export interface PontuacaoSemana {
  semana_inicio: string;
  total: number;
  dias: { dia: string; xp: number; possivel: number; hoje: boolean }[];
  aproveitamento: number | null;
  aproveitamento_semana_passada: number | null;
  ofensiva: number;
  liga: PosicaoLiga | null;
  conquistas: Conquista[];
}

export interface ParteXp {
  parte: string;
  rotulo: string;
  ganho: number;
  maximo: number;
  pendente: number;
  explicacao: string;
}

export interface PontuacaoVisita {
  visita_id: string;
  loja: string | null;
  quando: string | null;
  dia: string | null;
  classe: ClasseLoja | null;
  possivel: number;
  total: number;
  faltou: number;
  completa: boolean;
  partes: ParteXp[];
  iniciativas: { registro_id: number; descricao: string; pontos: number; situacao: string }[];
  ajustes: { pontos: number; motivo: string | null; por: string | null; em: string }[];
  fora_da_agenda: boolean;
}

export interface RankingEquipe {
  periodo?: 'semana' | 'mes';
  semana_inicio: string;
  fechada: boolean;
  fecha_em: string | null;
  grupo: string;
  minimo_visitas: number;
  participantes: number;
  linhas: { posicao: number; nome: string; xp: number; eu: boolean; foto_url?: string | null }[];
  escondidos: number;
  eu: { posicao: number; xp: number; plano: number; iniciativa: number; aproveitamento: number | null } | null;
  alvo: { nome: string; faltam: number; de: number; ate: number } | null;
}
