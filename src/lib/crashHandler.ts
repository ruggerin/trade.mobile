import type { ErrorUtils as ErrorUtilsType } from 'react-native';

// `global.ErrorUtils` é populado pelo próprio React Native na inicialização (polyfill interno,
// ver Libraries/vendor/core/ErrorUtils.js) — não existe import direto, só o tipo.
declare const global: { ErrorUtils: ErrorUtilsType };

/**
 * Handler global de exceção JS não tratada — cobre o que o ErrorBoundary (components/ErrorBoundary.tsx)
 * estruturalmente NÃO cobre: qualquer erro fora do ciclo de render (dentro de um useEffect sem
 * try/catch, callback de módulo nativo, listener, etc.).
 *
 * Por que isso importava na prática: em build de produção/preview (Hermes release, sem Metro
 * conectado — exatamente o tipo de build instalado num aparelho de verdade via EAS), uma exceção
 * que chega até aqui SEM esse handler custom deriva pro comportamento padrão do RN, que é deixar
 * o processo cair pro sistema operacional sem nenhuma mensagem — "abro visita, o app encerra,
 * para tudo". Em dev (__DEV__), preserva o comportamento padrão também (redbox/Metro), só
 * ADICIONA a captura, nunca substitui — só em produção é que o padrão vira "mata o processo
 * calado", e é isso que este handler evita.
 */
/**
 * Mesmo handler, pro modo HEADLESS (docs/109): quando o Android acorda o app só pra rodar a tarefa
 * de rastreamento, o componente `App` não é montado e o handler acima nunca é instalado — qualquer
 * exceção JS nesse contexto caía no padrão do RN e virava SIGABRT (Sentry 7813436308). Instalado
 * no index.ts, antes do registerRootComponent; quando o `App` monta, o dele substitui este.
 * Não há tela pra mostrar: só reporta e não deixa o processo cair.
 */
export function instalarTratadorHeadless(reportar: (erro: unknown, fatal: boolean) => void): void {
  const handlerOriginal = global.ErrorUtils.getGlobalHandler();

  global.ErrorUtils.setGlobalHandler((erro, ehFatal) => {
    reportar(erro, Boolean(ehFatal));
    if (__DEV__) handlerOriginal(erro, ehFatal);
  });
}

export function instalarTratadorGlobalDeErros(aoCapturar: (erro: unknown) => void): void {
  const handlerOriginal = global.ErrorUtils.getGlobalHandler();

  global.ErrorUtils.setGlobalHandler((erro, ehFatal) => {
    aoCapturar(erro);
    if (__DEV__) handlerOriginal(erro, ehFatal);
  });
}
