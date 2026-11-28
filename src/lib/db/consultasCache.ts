import { escrever, getDatabase } from './database';
import { redeComPrazo } from '../redeComPrazo';

/**
 * Cache genérico de consultas (docs/122 §2.3): guarda a última resposta de uma consulta pela
 * chave, para a tela abrir sem internet com a última versão. Serve para o que não precisa de busca
 * nem filtro local (agenda da janela, motivos, XP...); dado que precisa disso fica em tabela
 * própria (lojas, catálogo).
 */

/** Respostas mais velhas que isso saem na próxima gravação: a chave da agenda muda todo dia. */
const DIAS_GUARDADOS = 14;

export async function lerConsultaCache<T>(chave: string): Promise<T | null> {
  const db = await getDatabase();
  const linha = await db.getFirstAsync<{ dados: string }>('SELECT dados FROM consultas_cache WHERE chave = ?', [chave]);
  return linha ? (JSON.parse(linha.dados) as T) : null;
}

export async function salvarConsultaCache(chave: string, dados: unknown): Promise<void> {
  const agora = new Date();
  const limite = new Date(agora.getTime() - DIAS_GUARDADOS * 86_400_000).toISOString();
  await escrever('INSERT OR REPLACE INTO consultas_cache (chave, dados, atualizado_em) VALUES (?, ?, ?)', [
    chave,
    JSON.stringify(dados),
    agora.toISOString(),
  ]);
  await escrever('DELETE FROM consultas_cache WHERE atualizado_em < ?', [limite]);
}

/** Rede com prazo e, sem ela (ou lenta), a última resposta guardada nesta chave. */
export function consultaComCache<T>(chave: string, rede: () => Promise<T>): Promise<T> {
  return redeComPrazo({
    rede,
    salvar: (dados) => salvarConsultaCache(chave, dados),
    lerCache: () => lerConsultaCache<T>(chave),
  });
}
