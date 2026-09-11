import type { OrdemServico, PontoVenda, TipoRegistro } from '../types/api';
import type { ParametroApi } from './api/parametros';
import { apiClient } from './api/client';
import { obterUltimaSincronizacao } from './db/database';
import { salvarOrdensServicoCache } from './db/ordensServicoCache';
import { salvarParametrosCache } from './db/parametrosCache';
import { salvarPontosVendaCache } from './db/pontosVendaCache';
import { salvarTiposRegistroCache } from './db/tiposRegistroCache';

export interface ResultadoSincronizacao {
  pontosVenda: number;
  parametros: number;
  tiposRegistro: number;
  ordensServico: number;
}

/**
 * Sincronização manual (botão "Sincronizar agora" na tela de Perfil) — diferente das funções
 * de `lib/api/*.ts`, que caem pro cache local em silêncio quando a rede falha (pra não travar a
 * tela), esta aqui fala com a API direto e **deixa o erro propagar** se não conseguir: o ponto
 * de um botão de sincronizar é justamente confirmar que a rede está ok, então "falhar em
 * silêncio caindo pro cache" seria esconder exatamente a informação que o promotor quer ver.
 * Só atualiza parâmetros e pontos de venda — produtos por PDV são cacheados sob demanda (ver
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

async function executarSincronizacao(): Promise<ResultadoSincronizacao> {
  const [parametrosRes, pontosVendaRes, tiposRegistroRes, ordensServicoRes] = await Promise.all([
    apiClient.get<{ parametros: ParametroApi[] }>('/parametros'),
    apiClient.get<{ pontos_venda: PontoVenda[] }>('/pontos-venda', { params: { ativo: 1 } }),
    apiClient.get<{ tipos_registro: TipoRegistro[] }>('/tipos-registro', { params: { ativo: 1 } }),
    apiClient.get<{ ordens_servico: OrdemServico[] }>('/ordens-servico', { params: { status: 'PENDENTE' } }),
  ]);

  // Uma de cada vez, de propósito — diferente das 4 chamadas de rede acima (essas sim seguras em
  // paralelo, sem recurso compartilhado), as 4 funções abaixo escrevem na MESMA conexão SQLite
  // (getDatabase() é um singleton, ver lib/db/database.ts), cada uma dentro do seu próprio
  // `withTransactionAsync` (BEGIN/COMMIT). expo-sqlite não enfileira transações concorrentes na
  // mesma conexão — chamar isso em paralelo (Promise.all) faz o BEGIN de uma pisar no BEGIN de
  // outra ainda aberta ("cannot start a transaction within a transaction"), estourando um erro
  // aqui mesmo quando os dados acabam gravados certinho (sintoma exato de "dá erro, mas
  // atualiza tudo" — e, na pior interleaving, uma transação sendo revertida de verdade).
  await salvarParametrosCache(parametrosRes.data.parametros);
  await salvarPontosVendaCache(pontosVendaRes.data.pontos_venda);
  await salvarTiposRegistroCache(tiposRegistroRes.data.tipos_registro);
  await salvarOrdensServicoCache(ordensServicoRes.data.ordens_servico);

  return {
    parametros: parametrosRes.data.parametros.length,
    pontosVenda: pontosVendaRes.data.pontos_venda.length,
    tiposRegistro: tiposRegistroRes.data.tipos_registro.length,
    ordensServico: ordensServicoRes.data.ordens_servico.length,
  };
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

export async function sincronizarSeNecessario(): Promise<void> {
  try {
    const ultima = await obterUltimaSincronizacao();

    if (ultima) {
      const intervaloHoras = await buscarIntervaloSincronizacaoHoras();
      const horasDesdeUltimaSync = (Date.now() - new Date(ultima).getTime()) / (1000 * 60 * 60);
      if (horasDesdeUltimaSync < intervaloHoras) {
        return;
      }
    }

    await sincronizarAgora();
  } catch {
    // Silencioso de propósito — ver docstring acima.
  }
}

async function buscarIntervaloSincronizacaoHoras(): Promise<number> {
  const { data } = await apiClient.get<{ parametros: ParametroApi[] }>('/parametros');
  const parametro = data.parametros.find((p) => p.chave === 'SYNC_INTERVALO_HORAS');

  return parametro?.ativo && !Number.isNaN(Number(parametro.valor))
    ? Number(parametro.valor)
    : DEFAULT_INTERVALO_HORAS;
}
