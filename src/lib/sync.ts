import type { OrdemServico, PontoVenda, TipoRegistro } from '../types/api';
import { parametrosParaCache, type RespostaParametros } from './api/parametros';
import { apiClient } from './api/client';
import { obterUltimaSincronizacao } from './db/database';
import { salvarOrdensServicoCache } from './db/ordensServicoCache';
import { lerParametrosCache, salvarParametrosCache } from './db/parametrosCache';
import { salvarConsultaCache } from './db/consultasCache';
import {
  buscarAgendaNaRede,
  buscarMotivosNaoExecucaoNaRede,
  chaveCacheAgenda,
  CHAVE_CACHE_MOTIVOS_NAO_EXECUCAO,
} from './api/ordensServico';
import { janelaAgenda } from './prazoAgenda';
import { salvarPontosVendaCache } from './db/pontosVendaCache';
import { salvarTiposRegistroCache } from './db/tiposRegistroCache';

export interface ResultadoSincronizacao {
  pontosVenda: number;
  parametros: number;
  tiposRegistro: number;
  ordensServico: number;
  /** Partes que não vieram (ficam com a versão anterior no aparelho). Vazio = tudo atualizado. */
  falhas: string[];
}

/**
 * Sincronização manual (botão "Sincronizar agora" na tela de Perfil) — diferente das funções
 * de `lib/api/*.ts`, que caem pro cache local em silêncio quando a rede falha (pra não travar a
 * tela), esta aqui fala com a API direto e **deixa o erro propagar** se não conseguir: o ponto
 * de um botão de sincronizar é justamente confirmar que a rede está ok, então "falhar em
 * silêncio caindo pro cache" seria esconder exatamente a informação que o promotor quer ver.
 * Erra só quando NADA veio; parte que falhou fica com a versão anterior e sai em `falhas`.
 * Produtos por PDV não entram — são cacheados sob demanda (ver
 * lib/api/campanhas.ts) quando o promotor abre aquele PDV, não teria como pré-carregar todos de
 * uma vez sem saber quais campanhas cada loja tem.
 *
 * Busca **todos** os parâmetros, sem filtrar por `?ativo=1` — precisamos ver quando
 * CHECKIN_RAIO_METROS está desativado (não só ausente) pra distinguir "sem raio configurado"
 * (cai no default) de "raio desativado de propósito" (sem limite nenhum), ver
 * lib/api/parametros.ts.
 */
// Dedup de chamadas concorrentes: o botão manual ("Sincronizar agora" na tela de Perfil) e a
// sincronização automática silenciosa (`sincronizarSeNecessario`, disparada ao voltar do
// background) podem ser acionados quase juntos. Sem isso, as duas rodam a sequência de escritas
// no SQLite (ver comentário abaixo) em paralelo, caindo exatamente na race que esse comentário já
// alertava — um BEGIN pisando no BEGIN de outra transação ainda aberta na mesma conexão. Em vez
// de um simples "ignora a segunda chamada" (que devolveria um resultado vazio/enganoso pro botão
// manual), guarda a promise em andamento e devolve ELA pra qualquer chamada concorrente — todo
// mundo vê o mesmo resultado real, e a sequência de escrita só roda uma vez por vez.
let sincronizacaoEmAndamento: Promise<ResultadoSincronizacao> | null = null;

export function sincronizarAgora(): Promise<ResultadoSincronizacao> {
  if (sincronizacaoEmAndamento) return sincronizacaoEmAndamento;

  sincronizacaoEmAndamento = executarSincronizacao().finally(() => {
    sincronizacaoEmAndamento = null;
  });

  return sincronizacaoEmAndamento;
}

/**
 * Uma parte do pacote do dia: busca na rede e grava no aparelho. Cada parte é independente
 * (docs/122 §2.4): antes era tudo ou nada — uma chamada lenta derrubava as outras e nada era gravado.
 */
interface Parte {
  nome: string;
  buscar: () => Promise<unknown>;
  gravar: (dados: never) => Promise<void>;
}

function parte<T>(nome: string, buscar: () => Promise<T>, gravar: (dados: T) => Promise<void>): Parte {
  return { nome, buscar, gravar: gravar as (dados: never) => Promise<void> };
}

async function executarSincronizacao(): Promise<ResultadoSincronizacao> {
  const contagem = { parametros: 0, pontosVenda: 0, tiposRegistro: 0, ordensServico: 0 };
  const partes: Parte[] = [
    parte('parâmetros', async () => (await apiClient.get<RespostaParametros>('/parametros')).data, async (dados) => {
      await salvarParametrosCache(parametrosParaCache(dados));
      contagem.parametros = dados.parametros.length;
    }),
    parte(
      'lojas',
      async () => (await apiClient.get<{ pontos_venda: PontoVenda[] }>('/pontos-venda', { params: { ativo: 1 } })).data.pontos_venda,
      async (lojas) => {
        await salvarPontosVendaCache(lojas);
        contagem.pontosVenda = lojas.length;
      },
    ),
    parte(
      'formulários',
      async () => (await apiClient.get<{ tipos_registro: TipoRegistro[] }>('/tipos-registro', { params: { ativo: 1 } })).data.tipos_registro,
      async (tipos) => {
        await salvarTiposRegistroCache(tipos);
        contagem.tiposRegistro = tipos.length;
      },
    ),
    parte(
      'pendências',
      async () =>
        (await apiClient.get<{ ordens_servico: OrdemServico[] }>('/ordens-servico', { params: { status: 'PENDENTE', por_pagina: 200 } }))
          .data.ordens_servico,
      async (ordens) => {
        await salvarOrdensServicoCache(ordens);
        contagem.ordensServico = ordens.length;
      },
    ),
    // A Agenda (tela inicial do promotor) abre pelo cache destas janelas quando não há sinal.
    ...(['hoje', 'semana'] as const).map((aba) => {
      const janela = janelaAgenda(aba);
      return parte(`agenda (${aba})`, () => buscarAgendaNaRede(janela), (ordens) => salvarConsultaCache(chaveCacheAgenda(janela), ordens));
    }),
    parte('motivos', buscarMotivosNaoExecucaoNaRede, (motivos) => salvarConsultaCache(CHAVE_CACHE_MOTIVOS_NAO_EXECUCAO, motivos)),
  ];

  // Rede em paralelo (sem recurso compartilhado); gravação uma de cada vez, de propósito: as
  // funções de cache escrevem na MESMA conexão SQLite (getDatabase() é singleton), cada uma no seu
  // `withTransactionAsync`, e expo-sqlite não enfileira transações concorrentes na mesma conexão —
  // em paralelo o BEGIN de uma pisa no de outra ("cannot start a transaction within a transaction").
  const respostas = await Promise.allSettled(partes.map((p) => p.buscar()));
  const falhas: string[] = [];
  let primeiroErro: unknown = null;
  for (const [i, resposta] of respostas.entries()) {
    try {
      if (resposta.status === 'rejected') throw resposta.reason;
      await partes[i].gravar(resposta.value as never);
    } catch (err) {
      falhas.push(partes[i].nome);
      primeiroErro ??= err;
    }
  }

  // Nada veio: é falta de rede (ou servidor fora) — o botão mostra "Sem conexão".
  if (falhas.length === partes.length) throw primeiroErro;

  return { ...contagem, falhas };
}

/**
 * Sincronização automática silenciosa (Fase 1 de docs/07-ORDEM-DE-SERVICO.md) — diferente de
 * `sincronizarAgora` (botão manual, erro visível), esta nunca lança: dispara em background ao
 * abrir o app/voltar do background, comparando a última sincronização salva com o parâmetro
 * `SYNC_INTERVALO_HORAS` da empresa (ausente ou não numérico = usa DEFAULT_INTERVALO_HORAS).
 * Falha em silêncio de propósito — é só uma tentativa de antecipar dado novo, as telas já caem
 * pro cache sozinhas se a rede falhar.
 */
const DEFAULT_INTERVALO_HORAS = 4;

// Devolve true quando sincronizou de fato — quem chama avisa as telas (invalida o React Query),
// senão o SQLite fica novo e a lista em memória continua a antiga.
export async function sincronizarSeNecessario(): Promise<boolean> {
  try {
    const ultima = await obterUltimaSincronizacao();

    if (ultima) {
      const intervaloHoras = await buscarIntervaloSincronizacaoHoras();
      const horasDesdeUltimaSync = (Date.now() - new Date(ultima).getTime()) / (1000 * 60 * 60);
      if (horasDesdeUltimaSync < intervaloHoras) {
        return false;
      }
    }

    await sincronizarAgora();
    return true;
  } catch {
    // Silencioso de propósito — ver docstring acima.
    return false;
  }
}

// Lido do aparelho: ir à rede só para saber se precisa ir à rede travava a abertura sem sinal.
async function buscarIntervaloSincronizacaoHoras(): Promise<number> {
  const parametro = (await lerParametrosCache()).find((p) => p.chave === 'SYNC_INTERVALO_HORAS');

  return parametro?.ativo && !Number.isNaN(Number(parametro.valor))
    ? Number(parametro.valor)
    : DEFAULT_INTERVALO_HORAS;
}
