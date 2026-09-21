import * as SQLite from 'expo-sqlite';

/**
 * SQLite local com duas responsabilidades bem separadas:
 *
 * 1. Cache de LEITURA (`parametros`, `pontos_venda`, `produtos_disponiveis`, `tipos_registro`,
 *    `ordens_servico`) — dado de referência que o promotor precisa mesmo sem internet.
 *    Estratégia "rede primeiro, cache como fallback": cada função de `lib/api/*.ts` tenta a API
 *    normalmente; se der certo, guarda o resultado aqui (best-effort, nunca trava a tela) e
 *    devolve; se falhar por problema de rede (sem resposta — timeout, sem sinal), lê daqui em
 *    vez de propagar o erro. Erro de servidor (4xx/5xx com resposta) não cai pro cache — isso
 *    esconderia um problema real atrás de dado desatualizado. Cada linha guarda o JSON do
 *    recurso inteiro (`dados`) em vez de uma coluna por campo — não tem consulta SQL complexa
 *    aqui, então espelhar campo por campo só custaria manutenção sem ganhar nada.
 *
 * 2. Fila de ENVIO (`fila_visitas`, `fila_registros`) — check-in, registros (foto/ruptura/
 *    observação) e checkout coletados em campo, ainda não confirmados pelo servidor. Ver
 *    `lib/sync/filaEnvio.ts` e docs/04-APP-MOBILE.md "Fila offline de envio". **Nunca** entra em
 *    `limparCacheLocal` — são dados que o promotor coletou de verdade, apagar isso por causa de
 *    logout/sessão revogada seria perda de trabalho de campo (ver comentário na função abaixo).
 *    Cada linha carrega `usuario_id`: aparelho pode ser compartilhado entre promotores (trava de
 *    1 sessão por vez, ver docs/02-API-BACKEND.md), então tudo que lê/sincroniza a fila filtra
 *    pelo usuário logado agora — a fila de quem usou o aparelho antes fica intacta e invisível
 *    até esse promotor logar de novo, nunca é apagada nem sincronizada por engano em nome de
 *    outra pessoa.
 */

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Fila única de ESCRITAS no SQLite. O expo-sqlite tem UMA conexão e `withTransactionAsync` não
 * isola nada: qualquer instrução que outra parte do app dispare enquanto uma transação está aberta
 * entra NA MESMA transação — e some se ela der ROLLBACK. Era isso que fazia a visita recém-criada
 * (INSERT na fila) desaparecer sem ninguém apagar: o cache de leitura (pontos de venda, ordens de
 * serviço, parâmetros…) gravava em transação ao mesmo tempo, falhava e o rollback levava junto o
 * INSERT da visita. Agora toda transação de cache e toda escrita da fila passam por aqui, uma de
 * cada vez.
 */
let filaDeEscritas: Promise<unknown> = Promise.resolve();

export function serializarDb<T>(fn: () => Promise<T>): Promise<T> {
  const execucao = filaDeEscritas.then(fn);
  filaDeEscritas = execucao.catch(() => undefined);
  return execucao;
}

/** Transação de cache que nunca se mistura com outra escrita (ver serializarDb). */
export function comTransacao(db: SQLite.SQLiteDatabase, fn: () => Promise<void>): Promise<void> {
  return serializarDb(() => db.withTransactionAsync(fn));
}

/** Escrita avulsa (INSERT/UPDATE/DELETE) na mesma fila das transações — usada pela fila de envio. */
export function escrever(sql: string, params: SQLite.SQLiteBindParams = []): Promise<SQLite.SQLiteRunResult> {
  return serializarDb(async () => (await getDatabase()).runAsync(sql, params));
}

export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = abrirEMigrar();
  }
  return dbPromise;
}

async function abrirEMigrar(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('pdv-app-cache.db');

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS parametros (
      chave TEXT PRIMARY KEY NOT NULL,
      valor TEXT NOT NULL,
      ativo INTEGER NOT NULL DEFAULT 1,
      atualizado_em TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pontos_venda (
      id TEXT PRIMARY KEY NOT NULL,
      dados TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS produtos_disponiveis (
      ponto_venda_id TEXT NOT NULL,
      produto_uuid TEXT NOT NULL,
      dados TEXT NOT NULL,
      atualizado_em TEXT NOT NULL,
      PRIMARY KEY (ponto_venda_id, produto_uuid)
    );

    -- Sortimento do PDV (produtos que a loja compra, ver docs/14-SORTIMENTO-PONTO-VENDA.md) —
    -- mesmo padrão de cache de produtos_disponiveis, só que a fonte é o cadastro de sortimento
    -- em vez da resolução por campanha.
    CREATE TABLE IF NOT EXISTS sortimento_ponto_venda (
      ponto_venda_id TEXT NOT NULL,
      item_uuid TEXT NOT NULL,
      dados TEXT NOT NULL,
      atualizado_em TEXT NOT NULL,
      PRIMARY KEY (ponto_venda_id, item_uuid)
    );

    CREATE TABLE IF NOT EXISTS tipos_registro (
      id TEXT PRIMARY KEY NOT NULL,
      dados TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    );

    -- Checklist já resolvido de um campo SORTIMENTO pra um PDV (ver lib/api/campoSortimento.ts)
    -- — docs/26-MELHORIAS-PRODUTIVIDADE-PROMOTOR.md §6 item 12: antes esse campo dependia sempre
    -- de rede ("sem cache local"), o que quebrava a promessa de offline-first bem no meio do
    -- formulário se o promotor estivesse sem sinal dentro da loja. Chave composta (campo × PDV)
    -- porque o mesmo campo resolve produtos diferentes conforme o PDV (sortimento real da loja).
    CREATE TABLE IF NOT EXISTS sortimento_campo_cache (
      campo_uuid TEXT NOT NULL,
      ponto_venda_id TEXT NOT NULL,
      dados TEXT NOT NULL,
      atualizado_em TEXT NOT NULL,
      PRIMARY KEY (campo_uuid, ponto_venda_id)
    );

    CREATE TABLE IF NOT EXISTS ordens_servico (
      id TEXT PRIMARY KEY NOT NULL,
      dados TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    );

    -- Últimas visitas do próprio promotor já confirmadas pelo servidor (HistoricoScreen) — só
    -- pra continuar dando pra ver o que já foi feito enquanto offline; a fila de envio
    -- (fila_visitas) é quem cobre o que ainda não foi confirmado.
    CREATE TABLE IF NOT EXISTS visitas_historico (
      id TEXT PRIMARY KEY NOT NULL,
      dados TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    );

    -- Seções/departamentos/marcas do catálogo — só usados pelo seletor opcional "Vincular a" do
    -- formulário de registro (TipoRegistro.permite_vincular_catalogo). Uma tabela genérica com
    -- a coluna tipo discriminando os 3 (em vez de 3 tabelas quase idênticas) porque são
    -- exatamente o mesmo formato (id, descricao) e nunca precisam ser consultados juntos.
    CREATE TABLE IF NOT EXISTS catalogo_auditoria (
      tipo TEXT NOT NULL,
      id TEXT NOT NULL,
      dados TEXT NOT NULL,
      atualizado_em TEXT NOT NULL,
      PRIMARY KEY (tipo, id)
    );

    -- Fila de envio (offline-first de verdade — ver lib/filaEnvio.ts e docs/04-APP-MOBILE.md
    -- "Fila offline de envio"). Diferente das tabelas acima (cache de LEITURA, best-effort),
    -- estas duas são a fonte da verdade enquanto a visita não terminou de sincronizar: check-in,
    -- registros e checkout nascem aqui, nunca direto na API.
    --
    -- 'id' é um uuid gerado no aparelho (expo-crypto) no instante do check-in — existe *antes*
    -- do servidor conhecer essa visita. 'servidor_id' só é preenchido depois que o POST
    -- /visitas é aceito. status:
    --   RASCUNHO         check-in ainda não foi tentado, ou tentou e caiu por falta de rede
    --   CHECKIN_ENVIADO  servidor aceitou o check-in (servidor_id preenchido)
    --   FINALIZADA_LOCAL promotor tocou "finalizar" localmente; falta confirmar o checkout
    --   SINCRONIZADA     check-in + checkout confirmados pelo servidor — linha é apagada em
    --                    seguida (o dado definitivo já mora no servidor, ver
    --                    filaVisitas.excluirVisitaLocal), nunca fica "SINCRONIZADA" visível
    --   REJEITADA        servidor recusou o check-in (ex.: fora do raio) — estado terminal,
    --                    promotor precisa ver isso e descartar (ver HistoricoScreen)
    CREATE TABLE IF NOT EXISTS fila_visitas (
      id TEXT PRIMARY KEY NOT NULL,
      usuario_id TEXT NOT NULL,
      servidor_id TEXT,
      status TEXT NOT NULL,
      ponto_venda_id TEXT NOT NULL,
      ponto_venda_json TEXT NOT NULL,
      ordem_servico_id TEXT,
      latitude_inicio REAL NOT NULL,
      longitude_inicio REAL NOT NULL,
      inicio_em TEXT NOT NULL,
      latitude_fim REAL,
      longitude_fim REAL,
      fim_em TEXT,
      erro TEXT,
      criado_em TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    );

    -- Um registro (foto/ruptura/observação) criado durante uma visita que ainda está em
    -- fila_visitas. 'imagens_locais_json' é um array JSON de cópias persistentes dos arquivos
    -- (expo-file-system) — nunca a uri transitória do image picker, que o SO pode limpar antes
    -- da fila conseguir enviar num dia inteiro sem sinal. 'imagem_local_path' é a coluna antiga
    -- (1 foto só), mantida sem uso em INSERTs novos — só como fallback de leitura pra uma linha
    -- que já estava na fila (não sincronizada ainda) no momento em que o app atualizou pra N
    -- fotos, ver paraRegistroLocal em filaRegistros.ts. status: PENDENTE → ENVIADO | ERRO |
    -- DESCARTADO (DESCARTADO só acontece quando a visita-mãe é REJEITADA, ver filaEnvio.ts).
    CREATE TABLE IF NOT EXISTS fila_registros (
      id TEXT PRIMARY KEY NOT NULL,
      visita_local_id TEXT NOT NULL,
      status TEXT NOT NULL,
      -- uuid do registro no servidor, preenchido só depois que ENVIADO é confirmado — precisa
      -- dele pra poder cancelar um registro que já sincronizou mas a visita ainda está em
      -- andamento (ver lib/visitaLocal.ts::cancelarRegistroVisitaLocal).
      servidor_id TEXT,
      tipo_registro_uuid TEXT NOT NULL,
      produto_auditoria_uuid TEXT,
      produto_descricao TEXT,
      tipo_vinculo TEXT,
      secao_uuid TEXT,
      departamento_uuid TEXT,
      marca_uuid TEXT,
      vinculo_descricao TEXT,
      valores_campos_json TEXT,
      ruptura INTEGER,
      observacao TEXT,
      momento TEXT,
      imagem_local_path TEXT,
      erro TEXT,
      criado_em TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    );
  `);

  // Aparelho que já tinha o app instalado antes da coluna `ativo` existir — `CREATE TABLE IF
  // NOT EXISTS` não adiciona coluna em tabela já criada. SQLite não tem "ADD COLUMN IF NOT
  // EXISTS", por isso o try/catch (erro esperado e ignorado quando a coluna já existe).
  try {
    await db.execAsync('ALTER TABLE parametros ADD COLUMN ativo INTEGER NOT NULL DEFAULT 1');
  } catch {
    // Coluna já existe (instalação nova, ou migração já rodou antes) — nada a fazer.
  }

  try {
    await db.execAsync('ALTER TABLE fila_registros ADD COLUMN servidor_id TEXT');
  } catch {
    // Coluna já existe — nada a fazer.
  }

  try {
    await db.execAsync('ALTER TABLE fila_registros ADD COLUMN imagens_locais_json TEXT');
  } catch {
    // Coluna já existe — nada a fazer.
  }

  return db;
}

/**
 * Apaga o cache de LEITURA — chamado no logout e quando o token é revogado por outro login no
 * mesmo aparelho (AuthContext). Sem isso, um segundo promotor logando no mesmo aparelho
 * compartilhado poderia ver, offline, a carteira de PDVs de quem usou o app antes dele.
 *
 * Deliberadamente NÃO toca em `fila_visitas`/`fila_registros` — isso é trabalho de campo já
 * coletado, ainda não confirmado pelo servidor. Apagar aqui destruiria visitas/fotos de verdade
 * bem na hora que o promotor mais precisa (ex.: sessão revogada logo que o sinal volta, no meio
 * da tentativa de sincronizar). Cada linha da fila já carrega `usuario_id` e todo código que lê
 * a fila filtra pelo usuário logado agora — isso sozinho já resolve o compartilhamento de
 * aparelho pra fila, sem precisar apagar nada.
 */
export async function limparCacheLocal(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`
    DELETE FROM parametros;
    DELETE FROM pontos_venda;
    DELETE FROM produtos_disponiveis;
    DELETE FROM sortimento_ponto_venda;
    DELETE FROM sortimento_campo_cache;
    DELETE FROM tipos_registro;
    DELETE FROM ordens_servico;
    DELETE FROM visitas_historico;
    DELETE FROM catalogo_auditoria;
  `);
}

/** true só quando o axios não recebeu resposta nenhuma do servidor (sem sinal, timeout, DNS). */
export function ehErroDeRede(err: unknown): boolean {
  return Boolean(
    err && typeof err === 'object' && 'isAxiosError' in err && (err as { response?: unknown }).response === undefined,
  );
}

/**
 * Falha sem chance de dar certo tentando de novo com o MESMO payload — validação de negócio
 * (4xx: fora do raio, campo obrigatório faltando, etc.) — usado por `lib/filaEnvio.ts` pra
 * decidir o que a fila retenta sozinha e o que fica esperando o promotor notar/corrigir.
 * Diferente disso: rede caída (`ehErroDeRede`) e erro 5xx (o servidor recebeu, mas falhou por
 * conta própria — reinício, timeout de banco) não são culpa do que foi enviado, então os dois
 * merecem a mesma retentativa automática na próxima passada da fila.
 *
 * Um erro que nem chegou a ser uma resposta HTTP (ex.: `expo-file-system` falhando ao ler o
 * arquivo da foto antes do multipart sequer sair, ver lib/api/visitas.ts::criarRegistro) também
 * cai aqui como transitório — não é uma rejeição de negócio do servidor, então marcar ERRO
 * definitivo e mostrar "recusado pelo servidor" seria um diagnóstico errado pro promotor. A
 * fila tenta de novo sozinha na próxima passada, mesma lógica de rede caída/5xx.
 */
export function ehErroTransitorio(err: unknown): boolean {
  if (ehErroDeRede(err)) return true;
  if (!(err && typeof err === 'object' && 'isAxiosError' in err)) return true;
  const status = (err as { response?: { status?: number } }).response?.status;
  return typeof status === 'number' && status >= 500;
}

/**
 * Horário da sincronização bem-sucedida mais recente, olhando as tabelas de cache de leitura —
 * usado pra mostrar "Última sincronização: ..." na tela de Perfil. `null` quando o cache está
 * inteiramente vazio (nunca sincronizou, ou acabou de deslogar).
 */
export async function obterUltimaSincronizacao(): Promise<string | null> {
  const db = await getDatabase();
  const linha = await db.getFirstAsync<{ ultima: string | null }>(`
    SELECT MAX(atualizado_em) AS ultima FROM (
      SELECT atualizado_em FROM parametros
      UNION ALL SELECT atualizado_em FROM pontos_venda
      UNION ALL SELECT atualizado_em FROM produtos_disponiveis
      UNION ALL SELECT atualizado_em FROM sortimento_ponto_venda
      UNION ALL SELECT atualizado_em FROM sortimento_campo_cache
      UNION ALL SELECT atualizado_em FROM tipos_registro
      UNION ALL SELECT atualizado_em FROM ordens_servico
      UNION ALL SELECT atualizado_em FROM catalogo_auditoria
      UNION ALL SELECT atualizado_em FROM visitas_historico
    )
  `);
  return linha?.ultima ?? null;
}
