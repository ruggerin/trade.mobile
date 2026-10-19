import * as Sentry from '@sentry/react-native';

// Sentry no app (docs/70 e docs/72): só erro e crash. Tracing, profiling, replay, logs e métricas
// ficam DESLIGADOS de propósito. O app lida com localização, foto e dados de loja — nada disso pode
// sair num evento, então tudo passa por `limparEvento` antes de ir.
//
// Sem EXPO_PUBLIC_SENTRY_DSN o SDK nem liga (ambiente local, testes, build sem DSN).

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const AMBIENTE = process.env.EXPO_PUBLIC_SENTRY_ENV ?? 'homologacao';
const LIGAR_EM_DEV = process.env.EXPO_PUBLIC_SENTRY_EM_DEV === 'true';
// Session Replay (docs/72 §6): desligado por padrão. Quando ligado, grava só a tela dos segundos antes de um
// erro/crash, com texto, imagens e vetores mascarados — nunca sessões normais.
const REPLAY_LIGADO = process.env.EXPO_PUBLIC_SENTRY_REPLAY === 'true';

/** Chaves cujo valor nunca sai do aparelho (em qualquer nível de `extra`, `contexts` e breadcrumbs). */
const CHAVE_SENSIVEL = /(senha|password|token|authorization|cookie|secret|latitude|longitude|^lat$|^lng$|^lon$|coord|cpf|cnpj|email|telefone|phone|foto|imagem|image|base64)/i;
const REDIGIDO = '[redigido]';

/** Cópia do valor com as chaves sensíveis trocadas por `[redigido]` (profundidade limitada). */
export function redigir<T>(valor: T, profundidade = 0): T {
  if (profundidade > 6 || valor === null || typeof valor !== 'object') return valor;
  if (Array.isArray(valor)) return valor.map((v) => redigir(v, profundidade + 1)) as unknown as T;

  const saida: Record<string, unknown> = {};
  for (const [chave, v] of Object.entries(valor as Record<string, unknown>)) {
    saida[chave] = CHAVE_SENSIVEL.test(chave) ? REDIGIDO : redigir(v, profundidade + 1);
  }
  return saida as T;
}

/** Tira do evento o que identifica a pessoa ou o aparelho além do necessário pra achar o bug. */
export function limparEvento<E extends Sentry.ErrorEvent>(evento: E): E {
  const e = evento as E & {
    request?: { data?: unknown; cookies?: unknown; headers?: unknown; query_string?: unknown };
    user?: { id?: string; ip_address?: string | null; email?: string; username?: string };
    contexts?: { device?: Record<string, unknown> } & Record<string, unknown>;
    extra?: Record<string, unknown>;
    breadcrumbs?: Sentry.Breadcrumb[];
  };

  if (e.request) {
    delete e.request.data;
    delete e.request.cookies;
    delete e.request.headers;
    delete e.request.query_string;
  }

  // Só o id do usuário; nunca nome, e-mail nem IP.
  if (e.user) e.user = { id: e.user.id };

  // O nome do aparelho costuma ser "iPhone de Fulano".
  if (e.contexts?.device) delete e.contexts.device.name;

  if (e.extra) e.extra = redigir(e.extra);
  if (e.contexts) e.contexts = redigir(e.contexts);
  if (e.breadcrumbs) e.breadcrumbs = e.breadcrumbs.map(limparBreadcrumb);

  return e;
}

export function limparBreadcrumb(b: Sentry.Breadcrumb): Sentry.Breadcrumb {
  if (!b.data) return b;
  // Requisição: método, rota e status bastam. Sem corpo e sem query string (pode ter filtro/busca).
  const data: Record<string, unknown> = { ...redigir(b.data) };
  delete data.request_body_size;
  if (typeof data.url === 'string') data.url = data.url.split('?')[0];
  if (typeof data.to === 'string') data.to = data.to.split('?')[0];
  if (typeof data.from === 'string') data.from = data.from.split('?')[0];
  return { ...b, data };
}

/**
 * Configuração do Session Replay. Sem a variável, nada de replay (nem a integração nativa é carregada).
 * Com ela: sessão normal 0 (não grava o dia a dia do promotor), 100% das sessões com erro, tudo mascarado.
 */
export function configuracaoReplay(ligado: boolean = REPLAY_LIGADO): Partial<Sentry.ReactNativeOptions> {
  if (!ligado) return {};
  return {
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    integrations: [Sentry.mobileReplayIntegration({ maskAllText: true, maskAllImages: true, maskAllVectors: true })],
  };
}

export function iniciarSentry(): void {
  if (!DSN || (__DEV__ && !LIGAR_EM_DEV)) return;

  // Rodando no index.ts, antes de qualquer tratador de erro: se o SDK falhar ao ligar (módulo nativo
  // ausente ou mal empacotado no build), isso não pode impedir o app de abrir.
  try {
    Sentry.init({
      dsn: DSN,
      environment: AMBIENTE,
      // Release e dist vêm do build (nome do pacote, versionName e versionCode) pelo plugin do Expo.
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      maxBreadcrumbs: 50,
      // Tracing/profiling/replay/logs: não definidos = desligados.
      beforeSend: limparEvento,
      beforeBreadcrumb: limparBreadcrumb,
      ...configuracaoReplay(),
    });
  } catch (erro) {
    if (__DEV__) console.log("[sentry] não iniciou", erro);
  }
}

/** Quem está logado: só o id (uuid) e a empresa — nunca nome, e-mail nem telefone. */
export function definirUsuarioSentry(usuario: { id: string; empresaId?: string | null; tipo?: string | null } | null): void {
  if (!usuario) {
    Sentry.setUser(null);
    Sentry.setTag('empresa_id', undefined as unknown as string);
    return;
  }
  Sentry.setUser({ id: usuario.id });
  if (usuario.empresaId) Sentry.setTag('empresa_id', String(usuario.empresaId));
  if (usuario.tipo) Sentry.setTag('user_type', usuario.tipo);
}

/**
 * Reporta um erro que o app MESMO tratou (tela de erro, boundary). Existe porque o tratador global
 * do app (lib/crashHandler.ts) substitui o do React Native e não chama o original em produção — o
 * handler do Sentry nunca veria esses erros sem este envio explícito.
 */
export function reportarErro(erro: unknown, origem: 'erro_global' | 'render' | 'outro', fatal = false): void {
  try {
    Sentry.captureException(erro, { tags: { origem }, level: fatal ? 'fatal' : 'error' });
  } catch {
    // Reportar nunca pode derrubar o app.
  }
}

/**
 * Recusa PERMANENTE da fila de envio (4xx: check-in fora do raio, registro inválido, checkout
 * recusado) — antes não deixava rastro nenhum em release (docs/75 item 11). Vai só o que ajuda a
 * agrupar: etapa, status HTTP e os NOMES dos campos que a validação recusou. A mensagem do
 * servidor não vai (pode citar loja ou dado digitado); ela continua na tela do promotor.
 */
export function reportarRecusaFila(etapa: 'checkin' | 'registro' | 'foto' | 'checkout', erro: unknown): void {
  try {
    const resposta = (erro as { response?: { status?: number; data?: { errors?: Record<string, unknown>; motivo?: string } } })
      ?.response;
    const campos = resposta?.data?.errors ? Object.keys(resposta.data.errors).sort().join(',') : undefined;
    Sentry.captureMessage(`Fila de envio: ${etapa} recusado`, {
      level: 'warning',
      tags: { origem: 'fila_envio', etapa, http_status: String(resposta?.status ?? 'sem_resposta') },
      extra: { campos, motivo: resposta?.data?.motivo },
      fingerprint: ['fila-envio', etapa, String(resposta?.status ?? ''), campos ?? ''],
    });
  } catch {
    // Reportar nunca pode derrubar o app.
  }
}

/** Foto que levou mais que isso pra subir vira evento (amostra de rede lenta real). */
export const FOTO_LENTA_MS = 15_000;

/**
 * Medição do envio de foto (rede lenta): toda tentativa vira breadcrumb (aparece junto de qualquer
 * erro posterior), e a foto que subiu mas demorou vira um evento `info` — é com isso que dá pra
 * decidir o envio com o app fechado (docs/51 Fase 4) olhando número real. Só tamanho e tempo,
 * nada da foto em si.
 */
export function registrarEnvioFoto(medida: { bytes: number; duracaoMs: number; resultado: 'ok' | 'transitorio' | 'recusado' }): void {
  try {
    const kb = Math.round(medida.bytes / 1024);
    const segundos = Math.round(medida.duracaoMs / 100) / 10;
    const kbps = medida.duracaoMs > 0 ? Math.round((medida.bytes * 8) / medida.duracaoMs) : undefined;
    Sentry.addBreadcrumb({
      category: 'fila_envio.foto',
      level: medida.resultado === 'ok' ? 'info' : 'warning',
      message: `foto ${medida.resultado}`,
      data: { kb, segundos, kbps },
    });
    if (medida.resultado === 'ok' && medida.duracaoMs >= FOTO_LENTA_MS) {
      Sentry.captureMessage('Fila de envio: foto lenta', {
        level: 'info',
        tags: { origem: 'fila_envio', etapa: 'foto', faixa_kb: kb < 300 ? '<300' : kb < 1024 ? '300-1024' : '>1024' },
        extra: { kb, segundos, kbps },
        fingerprint: ['fila-envio', 'foto-lenta'],
      });
    }
  } catch {
    // Medir nunca pode derrubar o app.
  }
}

/**
 * TEMPORÁRIO (docs/72 §4): dispara um evento de teste pra validar a coleta no build. Remover junto com o
 * acionador escondido da tela de Perfil depois que a coleta for confirmada.
 */
export function dispararTesteSentry(tipo: 'mensagem' | 'erro_js' | 'crash_nativo'): void {
  if (tipo === 'mensagem') {
    Sentry.captureMessage('Teste do Sentry: mensagem enviada pelo app', 'info');
    void Sentry.flush();
    return;
  }
  if (tipo === 'erro_js') {
    // Fora do render e do try/catch: passa pelo tratador global, como um erro de verdade.
    setTimeout(() => {
      throw new Error('Teste do Sentry: erro de JavaScript não tratado');
    }, 0);
    return;
  }
  Sentry.nativeCrash();
}

/** Envolve o componente raiz (captura de toque pra breadcrumbs e boundary do Sentry). */
export const envolverComSentry = Sentry.wrap;
