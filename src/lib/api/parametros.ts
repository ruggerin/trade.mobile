import type { AutonomiaPromotor } from '../../types/api';
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

async function buscarParametros(): Promise<ParametroApi[]> {
  return redeComPrazo({
    rede: async () => (await apiClient.get<{ parametros: ParametroApi[] }>('/parametros')).data.parametros,
    salvar: salvarParametrosCache,
    lerCache: lerParametrosCache,
  });
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
  // A exigência só vale dentro da jornada (JORNADA_INICIO/FIM)? `jornada` null = o dia inteiro.
  jornada: { inicio: string; fim: string } | null;
}

// Mesmos defaults do backend (App\Support\Rastreamento / OperacaoDoDia): OPCIONAL, só na jornada,
// jornada 07:00–17:00.
export async function buscarConfigRastreamento(): Promise<ConfigRastreamento> {
  const parametros = await buscarParametros();
  const ativo = (chave: string) => parametros.find((p) => p.chave === chave && p.ativo)?.valor?.trim();

  const intervalo = Number(ativo('RASTREAMENTO_INTERVALO_SEGUNDOS'));
  const exigencia = (ativo('RASTREAMENTO_EXIGENCIA') ?? '').toUpperCase();
  const soNaJornada = ativo('RASTREAMENTO_SO_NA_JORNADA');

  return {
    intervaloSegundos: Number.isFinite(intervalo) && intervalo > 0 ? intervalo : 0,
    exigencia: exigencia === 'AVISO' || exigencia === 'OBRIGATORIO' ? exigencia : 'OPCIONAL',
    jornada:
      soNaJornada === undefined || ['1', 'true', 'sim', 'yes'].includes(soNaJornada.toLowerCase())
        ? { inicio: ativo('JORNADA_INICIO') ?? '07:00', fim: ativo('JORNADA_FIM') ?? '17:00' }
        : null,
  };
}
