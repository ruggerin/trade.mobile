// Tipos espelhando os JsonResource da API (api/app/Http/Resources/) — `id` é sempre o uuid
// (string), nunca o bigint interno, ver docs/02-API-BACKEND.md#convenção-de-identificadores-na-api.
// Só os tipos usados pelo app mobile — não precisa duplicar o types/api.ts inteiro do admin.

export type UserType = 'SUPERADMIN' | 'ADMIN' | 'GESTOR' | 'PROMOTOR';

export interface Empresa {
  id: string;
  razao_social: string;
  nome_fantasia: string;
  cnpj: string;
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
  ativo: boolean;
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
  // Campo condicional (docs/20-FORMULARIO-DINAMICO-CAMPANHA.md decisão 7) — `depende_de_chave` é
  // a `chave` de outro campo do mesmo tipo_registro (não um uuid), só aparece/é obrigatório
  // quando esse campo pai tiver o valor `depende_de_valor`.
  depende_de_chave: string | null;
  depende_de_valor: string | null;
  // Campo SORTIMENTO (docs/20-FORMULARIO-DINAMICO-CAMPANHA.md decisão 3) — o app só precisa
  // saber SE ausência vira ruptura confirmável; a lista de produtos em si vem de
  // lib/api/campoSortimento.ts (o backend resolve o resto — origem/recorte não importam aqui).
  confirmar_ruptura_ausentes: boolean;
}

// Catálogo customizável por empresa do que o promotor pode registrar numa visita — substitui o
// antigo enum fixo FOTO/RUPTURA/OBSERVACAO. Toda empresa nasce com esses 3 como padrão, mas
// pode criar outros (ex.: "Ponto extra") com campos próprios.
export type EscopoAcaoTipoRegistro = 'SEMPRE' | 'CAMPANHA' | 'CONTRATO';
export type GranularidadeResposta = 'LINHA' | 'PRODUTO';

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
  // Granularidade da resposta (linha/seção vs. produto individual) — ver
  // docs/16-GRANULARIDADE-CHECKLIST-AUDITORIA.md §4. `null` = sem regra, vínculo livre (atual).
  // O backend continua sendo a autoridade final (StoreVisitaRegistroRequest); o app usa isto
  // pra restringir "Vincular a" (RegistroFormModal) e pra resolver colunas da grade de coleta
  // (GradeColetaScreen, ver lib/granularidadeChecklist.ts — mesma lógica de
  // App\Support\GranularidadeChecklist no backend).
  granularidade_padrao: GranularidadeResposta | null;
  excecoes_granularidade: { secao_uuid: string; secao_descricao: string; granularidade: GranularidadeResposta }[];
  // Marca a coluna "Ruptura" da grade de coleta (Fase 2) — sempre a primeira, marcar um produto
  // exclui ele das demais colunas da mesma linha. Ver docs/16-GRANULARIDADE-CHECKLIST-AUDITORIA.md §9.
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
  } | null;
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
