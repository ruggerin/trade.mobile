import * as Sentry from '@sentry/react-native';

// Sentry no app (docs/70 e docs/72): só erro e crash. Tracing, profiling, replay, logs e métricas
// ficam DESLIGADOS de propósito. O app lida com localização, foto e dados de loja — nada disso pode
// sair num evento, então tudo passa por `limparEvento` antes de ir.
//
// Sem EXPO_PUBLIC_SENTRY_DSN o SDK nem liga (ambiente local, testes, build sem DSN).

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const AMBIENTE = process.env.EXPO_PUBLIC_SENTRY_ENV ?? 'homologacao';
const LIGAR_EM_DEV = process.env.EXPO_PUBLIC_SENTRY_EM_DEV === 'true';

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

export function iniciarSentry(): void {
  if (!DSN || (__DEV__ && !LIGAR_EM_DEV)) return;

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
  });
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
