import type { AutonomiaPromotor } from '../../types/api';
import { ehErroDeRede } from '../db/database';
import { lerParametrosCache, salvarParametrosCache } from '../db/parametrosCache';
import { apiClient } from './client';

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

async function lerAutonomia(chave: string, valorPadrao: AutonomiaPromotor): Promise<AutonomiaPromotor> {
  const parametros = await buscarParametros();
  const parametro = parametros.find((p) => p.chave === chave);
  if (!parametro || !parametro.ativo) return valorPadrao;

  const valor = parametro.valor.toUpperCase();
  return (NIVEIS_AUTONOMIA as string[]).includes(valor) ? (valor as AutonomiaPromotor) : valorPadrao;
}

async function buscarParametros(): Promise<ParametroApi[]> {
  try {
    const { data } = await apiClient.get<{ parametros: ParametroApi[] }>('/parametros');
    void salvarParametrosCache(data.parametros).catch(() => {
      // Cache é um bônus, best-effort — falhar em gravar não pode derrubar a tela.
    });
    return data.parametros;
  } catch (err) {
    if (!ehErroDeRede(err)) throw err;
    return lerParametrosCache();
  }
}

// Rastreamento em tempo real (docs/11-RASTREAMENTO-TEMPO-REAL.md) — 0 (ausente/inativo/inválido)
// = a empresa não habilitou; >0 = intervalo pedido pela empresa, em segundos. Só o app aplica um
// piso próprio por cima (ver lib/rastreamento.ts), nunca deixa a empresa pedir algo agressivo
// demais pra bateria.
export async function buscarIntervaloRastreamentoSegundos(): Promise<number> {
  const parametros = await buscarParametros();
  const parametro = parametros.find((p) => p.chave === 'RASTREAMENTO_INTERVALO_SEGUNDOS');
  if (!parametro || !parametro.ativo) return 0;
  const valor = Number(parametro.valor);
  return Number.isFinite(valor) && valor > 0 ? valor : 0;
}
