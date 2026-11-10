import type { AutonomiaPromotor } from '../../types/api';
import { HORAS_OFFLINE_PADRAO } from '../auth/acessoOffline';
import { lerParametrosCache, salvarParametrosCache } from '../db/parametrosCache';
import { apiClient } from './client';
import { redeComPrazo } from '../redeComPrazo';

export interface ParametroApi {
  chave: string;
  valor: string;
  ativo: boolean;
}

const RAIO_CHECKIN_PADRAO_METROS = 200;
const NIVEIS_AUTONOMIA: AutonomiaPromotor[] = ['DESABILITADO', 'AUTONOMO', 'REQUER_APROVACAO'];
const VALORES_VERDADEIROS = ['1', 'true', 'sim', 'yes'];

// Só usado pra exibição (badge dentro/fora do raio) — quem decide de verdade se o check-in é
// permitido é sempre o backend, ver docs/02-API-BACKEND.md, regra de negócio 1.
//
// Retorna `Infinity` quando a empresa desativou o parâmetro de propósito — diferente do resto
// do catálogo de parâmetros (onde "desativar" só volta pro default do sistema), pra
// CHECKIN_RAIO_METROS "desativado" significa "sem limite de distância nenhum", mesmo
// comportamento de App\Support\RaioCheckin no backend. É por isso que buscamos todos os
// parâmetros (sem `?ativo=1`) — precisamos ver o estado `ativo` pra distinguir "nunca
// configurado" (cai no default) de "configurado e desativado" (sem limite).
//
// Cache local (SQLite, ver lib/db/database.ts): sem rede, cai pro último valor sincronizado em
// vez do default fixo — importante porque o raio é por empresa, o default genérico pode estar
// bem longe do valor real configurado.
export async function buscarRaioCheckinMetros(): Promise<number> {
  const parametros = await buscarParametros();
  const parametro = parametros.find((p) => p.chave === 'CHECKIN_RAIO_METROS');

  if (!parametro) return RAIO_CHECKIN_PADRAO_METROS;
  if (!parametro.ativo) return Infinity;

  const valor = Number(parametro.valor);
  return Number.isFinite(valor) ? valor : RAIO_CHECKIN_PADRAO_METROS;
}

// Autonomia do promotor sobre vincular produto existente ao sortimento do PDV — ver
// docs/14-SORTIMENTO-PONTO-VENDA.md §9. Ausente/inativo/valor desconhecido cai no default.
export async function buscarAutonomiaSortimento(): Promise<AutonomiaPromotor> {
  return lerAutonomia('SORTIMENTO_AUTONOMIA_PROMOTOR', 'AUTONOMO');
}

// Autonomia do promotor sobre cadastrar produto novo no catálogo pela visita — default mais
// conservador de propósito (polui o catálogo da empresa inteira, não só a carteira de um PDV).
export async function buscarAutonomiaCatalogo(): Promise<AutonomiaPromotor> {
  return lerAutonomia('CATALOGO_AUTONOMIA_PROMOTOR', 'REQUER_APROVACAO');
}

// Se o cadastro de produto novo exige código de barras — mesmo parâmetro vale pro admin web e
// pro autocadastro rápido do promotor aqui (ver App\Support\CodigoBarrasProduto). Só serve pra
// mostrar o campo como obrigatório na hora; quem decide de verdade é sempre o backend.
export async function buscarCodigoBarrasObrigatorio(): Promise<boolean> {
  const parametros = await buscarParametros();
  const parametro = parametros.find((p) => p.chave === 'CODIGO_BARRAS_OBRIGATORIO');
  if (!parametro || !parametro.ativo) return false;
  return VALORES_VERDADEIROS.includes(parametro.valor.toLowerCase());
}

// Se o promotor pode cancelar um registro que ele mesmo fez — ver
// App\Support\CancelamentoRegistro. Ausente/inativo = false (default conservador, a empresa liga
// quando quiser).
export async function buscarCancelamentoRegistroPermitido(): Promise<boolean> {
  const parametros = await buscarParametros();
  const parametro = parametros.find((p) => p.chave === 'REGISTRO_CANCELAMENTO_PERMITIDO');
  if (!parametro || !parametro.ativo) return false;
  return VALORES_VERDADEIROS.includes(parametro.valor.toLowerCase());
}

// Se o promotor pode cancelar (anular) a própria visita em andamento — ver
// App\Support\CancelamentoVisita. Ausente/inativo = false (default conservador, mesmo
// raciocínio de buscarCancelamentoRegistroPermitido acima).
export async function buscarCancelamentoVisitaPermitido(): Promise<boolean> {
  const parametros = await buscarParametros();
  const parametro = parametros.find((p) => p.chave === 'VISITA_CANCELAMENTO_PERMITIDO');
  if (!parametro || !parametro.ativo) return false;
  return VALORES_VERDADEIROS.includes(parametro.valor.toLowerCase());
}

// Se o vendedor pode tirar Pedido de Venda fora de uma visita — ver
// App\Support\PedidoVendaSemVisita. Ausente/inativo = false: pedido só dentro da visita em
// andamento. Só controla o que o app oferece; quem barra de verdade é o backend.
export async function buscarPedidoSemVisitaPermitido(): Promise<boolean> {
  const parametros = await buscarParametros();
  const parametro = parametros.find((p) => p.chave === 'PEDIDO_VENDA_SEM_VISITA_PERMITIDO');
  if (!parametro || !parametro.ativo) return false;
  return VALORES_VERDADEIROS.includes(parametro.valor.toLowerCase());
}

// Se o checkout é recusado com formulário obrigatório de Direcionamento pendente — mesma regra de
// App\Support\DirecionamentoParametros (ausente/inativo = só avisa). O app trava o botão antes,
// pro promotor responder ainda na loja em vez de descobrir a recusa depois; vem do cache local
// sem sinal, como os demais.
export async function buscarDirecionamentoBloqueiaCheckout(): Promise<boolean> {
  const parametros = await buscarParametros();
  const parametro = parametros.find((p) => p.chave === 'DIRECIONAMENTO_BLOQUEIA_CHECKOUT');
  if (!parametro || !parametro.ativo) return false;
  return VALORES_VERDADEIROS.includes(parametro.valor.toLowerCase());
}

async function lerAutonomia(chave: string, valorPadrao: AutonomiaPromotor): Promise<AutonomiaPromotor> {
  const parametros = await buscarParametros();
  const parametro = parametros.find((p) => p.chave === chave);
  if (!parametro || !parametro.ativo) return valorPadrao;

  const valor = parametro.valor.toUpperCase();
  return (NIVEIS_AUTONOMIA as string[]).includes(valor) ? (valor as AutonomiaPromotor) : valorPadrao;
}

// Jornada do próprio promotor de hoje aos próximos 6 dias (docs/102), como vem do servidor.
export interface JornadaDoDiaApi {
  data: string;
  trabalha: boolean;
  inicio: string | null;
  fim: string | null;
  intervalo: { inicio: string; fim: string } | null;
  escala: string;
  feriado: string | null;
}

export interface RespostaParametros {
  parametros: ParametroApi[];
  // null/ausente = servidor anterior à doc 102 (ou usuário sem empresa).
  jornada_semana?: JornadaDoDiaApi[] | null;
}

// A jornada da semana vai no mesmo cache dos parâmetros, numa linha que nenhuma chave real usa —
// assim o app funciona offline sem tabela nova no SQLite.
const CHAVE_JORNADA_SEMANA = '__JORNADA_SEMANA';

/** Parâmetros + a jornada da semana numa linha só, pronto pra ir pro cache. */
export function parametrosParaCache(resposta: RespostaParametros): ParametroApi[] {
  return resposta.jornada_semana
    ? [...resposta.parametros, { chave: CHAVE_JORNADA_SEMANA, valor: JSON.stringify(resposta.jornada_semana), ativo: true }]
    : resposta.parametros;
}

function jornadaDeHoje(parametros: ParametroApi[], agora = new Date()): JornadaDoDiaApi | null {
  const linha = parametros.find((p) => p.chave === CHAVE_JORNADA_SEMANA);
  if (!linha) return null;
  const hoje = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
  try {
    return (JSON.parse(linha.valor) as JornadaDoDiaApi[]).find((d) => d.data === hoje) ?? null;
  } catch {
    return null;
  }
}

async function buscarParametros(): Promise<ParametroApi[]> {
  return redeComPrazo({
    rede: async () => parametrosParaCache((await apiClient.get<RespostaParametros>('/parametros')).data),
    salvar: salvarParametrosCache,
    lerCache: lerParametrosCache,
  });
}

// Login sem internet (docs/108): por quantas horas, desde o último contato online, a senha pode ser
// conferida no próprio aparelho. Ausente/inativo/inválido = padrão (24); 0 = a empresa exige internet.
export async function buscarLoginOfflineHoras(): Promise<number> {
  const parametros = await buscarParametros();
  const parametro = parametros.find((p) => p.chave === 'LOGIN_OFFLINE_HORAS');
  if (!parametro || !parametro.ativo) return HORAS_OFFLINE_PADRAO;
  const valor = Number(parametro.valor);
  return Number.isInteger(valor) && valor >= 0 ? valor : HORAS_OFFLINE_PADRAO;
}

// Rastreamento em tempo real (docs/11-RASTREAMENTO-TEMPO-REAL.md) — 0 (ausente/inativo/inválido)
// = a empresa não habilitou; >0 = intervalo pedido pela empresa, em segundos. Só o app aplica um
// piso próprio por cima (ver lib/rastreamento.ts), nunca deixa a empresa pedir algo agressivo
// demais pra bateria.
export async function buscarIntervaloRastreamentoSegundos(): Promise<number> {
  return (await buscarConfigRastreamento()).intervaloSegundos;
}

export type ExigenciaRastreamento = 'OPCIONAL' | 'AVISO' | 'OBRIGATORIO';

export interface ConfigRastreamento {
  intervaloSegundos: number;
  // docs/47-RASTREAMENTO-EXIGENCIA.md — quanto o app exige do promotor.
  exigencia: ExigenciaRastreamento;
  // A exigência só vale dentro da jornada (a escala do promotor no dia, docs/102)? `jornada` null = o dia inteiro.
  jornada: { inicio: string; fim: string } | null;
  // Folga (ou feriado) da escala hoje: nada é cobrado, nem com "o dia inteiro" (docs/102).
  folga: boolean;
  // Intervalo (almoço) que a empresa desconsidera (docs/95) — no intervalo nada é cobrado. null = não desconsidera.
  intervalo: { inicio: string; fim: string } | null;
  // docs/94: manda o nível da bateria junto da posição (RASTREAMENTO_BATERIA, desligado por padrão).
  coletarBateria: boolean;
  // docs/109: junta as leituras e sobe em lote a cada N minutos; 0 = manda a cada leitura (padrão).
  envioMinutos: number;
}

function inteiroOuZero(valor: string | undefined): number {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

// Mesmos defaults do backend (App\Support\Rastreamento / OperacaoDoDia): OPCIONAL, só na jornada,
// jornada 07:00–17:00.
export async function buscarConfigRastreamento(): Promise<ConfigRastreamento> {
  const parametros = await buscarParametros();
  const ativo = (chave: string) => parametros.find((p) => p.chave === chave && p.ativo)?.valor?.trim();

  const intervalo = Number(ativo('RASTREAMENTO_INTERVALO_SEGUNDOS'));
  const exigencia = (ativo('RASTREAMENTO_EXIGENCIA') ?? '').toUpperCase();
  const soNaJornada = ativo('RASTREAMENTO_SO_NA_JORNADA');
  const intervaloLigado = VALORES_VERDADEIROS.includes((ativo('JORNADA_INTERVALO_HABILITADO') ?? '').toLowerCase());
  const intervaloAlmoco = { inicio: ativo('JORNADA_INTERVALO_INICIO') ?? '12:00', fim: ativo('JORNADA_INTERVALO_FIM') ?? '13:30' };
  const limitaNaJornada = soNaJornada === undefined || ['1', 'true', 'sim', 'yes'].includes(soNaJornada.toLowerCase());
  // docs/102: a escala do promotor hoje, quando o servidor manda. Sem ela (servidor antigo ou
  // cache com mais de 7 dias), os parâmetros de antes — o mesmo horário pra todo mundo.
  const hoje = jornadaDeHoje(parametros);

  return {
    intervaloSegundos: Number.isFinite(intervalo) && intervalo > 0 ? intervalo : 0,
    exigencia: exigencia === 'AVISO' || exigencia === 'OBRIGATORIO' ? exigencia : 'OPCIONAL',
    jornada: !limitaNaJornada
      ? null
      : hoje
        ? hoje.trabalha && hoje.inicio && hoje.fim
          ? { inicio: hoje.inicio, fim: hoje.fim }
          : null
        : { inicio: ativo('JORNADA_INICIO') ?? '07:00', fim: ativo('JORNADA_FIM') ?? '17:00' },
    folga: hoje !== null && !hoje.trabalha,
    // Fim antes do início (cadastro errado) = sem intervalo, igual ao servidor. Com a escala, o
    // servidor já manda o intervalo só quando a empresa desconsidera.
    intervalo: hoje ? hoje.intervalo : intervaloLigado && intervaloAlmoco.inicio < intervaloAlmoco.fim ? intervaloAlmoco : null,
    coletarBateria: VALORES_VERDADEIROS.includes((ativo('RASTREAMENTO_BATERIA') ?? '').toLowerCase()),
    envioMinutos: inteiroOuZero(ativo('RASTREAMENTO_ENVIO_MINUTOS')),
  };
}

// Checkout pela saída detectada (docs/92). Mesma semântica do servidor (App\Support\CheckoutParametros):
// raio ausente/inativo/0 = sem raio; modo padrão REGISTRA; sugestão desligada por padrão.
export type ModoForaDoRaio = 'REGISTRA' | 'AVISA' | 'BLOQUEIA';

export interface ConfigCheckout {
  raioMetros: number | null;
  foraDoRaio: ModoForaDoRaio;
  sugerirSaida: boolean;
  // Minutos longe da loja até o servidor fechar a visita sozinho (0 = nunca).
  automaticoMinutos: number;
}

export async function buscarConfigCheckout(): Promise<ConfigCheckout> {
  const parametros = await buscarParametros();
  const ativo = (chave: string) => parametros.find((p) => p.chave === chave && p.ativo)?.valor?.trim();

  const raio = Number(ativo('CHECKOUT_RAIO_METROS'));
  const modo = (ativo('CHECKOUT_FORA_DO_RAIO') ?? '').toUpperCase();
  const automatico = Number(ativo('CHECKOUT_AUTOMATICO_MINUTOS'));

  return {
    raioMetros: Number.isFinite(raio) && raio > 0 ? raio : null,
    foraDoRaio: modo === 'AVISA' || modo === 'BLOQUEIA' ? modo : 'REGISTRA',
    sugerirSaida: VALORES_VERDADEIROS.includes((ativo('CHECKOUT_SUGERIR_SAIDA') ?? '').toLowerCase()),
    automaticoMinutos: Number.isFinite(automatico) && automatico > 0 ? automatico : 0,
  };
}
