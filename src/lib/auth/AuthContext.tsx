import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import * as authApi from '../api/auth';
import { APP_DESATUALIZADO_EVENT, authEvents, SessaoEncerradaEvent, UNAUTHORIZED_EVENT } from '../api/client';
import { buscarLoginOfflineHoras } from '../api/parametros';
import { limparCacheLocal } from '../db/database';
import { lerUsuarioCache, salvarUsuarioCache } from '../db/usuarioCache';
import { aoReconectar, estaOnline } from '../network';
import {
  apagarAcessoOffline,
  gravarAcessoOffline,
  HORAS_OFFLINE_PADRAO,
  lerAcessoOffline,
  renovarContatoOnline,
  sessaoTrancada,
  type AcessoOffline,
} from './acessoOffline';
import { aparelhoTemBiometria, confirmarBiometria, preferenciaBiometria } from './biometria';
import { credenciaisStorage } from './credentialsStorage';
import { loginComPrazo } from './loginComPrazo';
import { renovarSessaoSeNecessario } from './renovacaoSessao';
import { apagarPushNoLogout, esquecerPushLocal } from '../push';
import { encerrarRastreamentoNoLogout } from '../rastreamento';
import { definirUsuarioSentry } from '../sentry';
import { tokenStorage } from './tokenStorage';
import type { Usuario } from '../../types/api';

interface AuthContextValue {
  usuario: Usuario | null;
  // Exposto pra montar headers de request fora do apiClient (ex.: <Image source={{ uri,
  // headers }}>, que não passa pelos interceptors do axios).
  token: string | null;
  // Cobre dois momentos: lendo o token salvo no SecureStore (assíncrono, ao contrário do
  // localStorage do admin web) e, se achou um, confirmando que ainda é válido via /auth/me.
  // A RootNavigator usa isso pra decidir quando sair da Splash.
  isLoading: boolean;
  isAuthenticated: boolean;
  /**
   * Rede primeiro, com prazo; sem resposta a tempo, confere a senha no aparelho (docs/108 §4).
   * Lança `ErroLoginOffline` quando nem a rede nem o acesso offline servem.
   */
  login: (email: string, senha: string) => Promise<void>;
  /**
   * "Sair" TRANCA a sessão (docs/108 §9.1): token, cache e acesso offline ficam no aparelho e o app
   * volta pro Login — o promotor entra de novo com a senha mesmo sem internet. Não revoga no servidor.
   */
  logout: () => Promise<void>;
  /**
   * "Sair e limpar este aparelho": o logout de antes — revoga no servidor e apaga token, cache, e-mail
   * lembrado, biometria e acesso offline. Pra celular compartilhado / troca de promotor.
   */
  sairELimpar: () => Promise<void>;
  /** Entrou pelo acesso offline e o servidor ainda não confirmou a sessão (docs/108 §4.5). */
  modoOffline: boolean;
  /** Acesso offline guardado neste aparelho (pra mostrar até quando vale) — `null` sem acesso. */
  acessoOffline: AcessoOffline | null;
  // Atualiza o usuário em memória direto pela resposta de uma mutação própria (ex.: trocar a
  // foto de perfil) — sem isso, `usuarioDoLogin` (a fonte de verdade depois do login, ver
  // abaixo) ficaria com o dado antigo pro resto da sessão, já que meQuery.enabled desliga assim
  // que `usuarioDoLogin` existe e nunca mais dispara sozinho.
  atualizarUsuario: (usuario: Usuario) => void;
  // Por que a sessão caiu, vindo da API ("Sua conta entrou em outro aparelho (Moto G, 14:32)...")
  // — a tela de login mostra (docs/67 §4.5).
  avisoSessao: string | null;
  limparAvisoSessao: () => void;
  // API respondeu 426 (docs/67 Fase 2): versão abaixo da mínima, o app pede atualização.
  appDesatualizado: boolean;
  // Sessão ativa esperando a biometria (docs/67 §4.5) — só quando o usuário ligou a opção.
  bloqueadoPorBiometria: boolean;
  desbloquearComBiometria: () => Promise<void>;
  // Opção "Entrar com biometria" (lib/auth/biometria.ts). `null` enquanto lê o aparelho/storage.
  biometria: EstadoBiometria | null;
  // Liga (só depois de passar no prompt do sistema) ou desliga. Devolve se ficou ligada.
  definirBiometria: (ativa: boolean) => Promise<boolean>;
}

export interface EstadoBiometria {
  /** Aparelho tem leitor e uma biometria cadastrada no sistema. */
  disponivel: boolean;
  ativa: boolean;
  /** Este usuário ainda não respondeu à pergunta pós-login — o MainTabs mostra a oferta. */
  perguntar: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [tokenCarregado, setTokenCarregado] = useState(false);
  // Só guarda o usuário vindo direto da resposta do login (fonte imediata, sem round-trip) —
  // mesma lição já aprendida no admin web (admin/src/lib/auth/AuthContext.tsx): nunca copiar
  // meQuery.data pra um segundo useState via useEffect, isso abre uma janela de 1 frame com
  // dado carregado mas ainda não propagado.
  const [usuarioDoLogin, setUsuarioDoLogin] = useState<Usuario | null>(null);
  const [avisoSessao, setAvisoSessao] = useState<string | null>(null);
  const [appDesatualizado, setAppDesatualizado] = useState(false);
  const [bloqueadoPorBiometria, setBloqueadoPorBiometria] = useState(false);
  const [biometria, setBiometria] = useState<EstadoBiometria | null>(null);
  // Último usuário salvo no aparelho: abre o app sem sinal com a sessão válida (o /auth/me falha).
  const [usuarioSalvo, setUsuarioSalvo] = useState<Usuario | null>(null);
  const [modoOffline, setModoOffline] = useState(false);
  const [acessoOffline, setAcessoOffline] = useState<AcessoOffline | null>(null);
  // Revalidação do modo offline em andamento — uma de cada vez.
  const revalidando = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const valor = await tokenStorage.get();
      // Sessão trancada pelo "Sair" (docs/108 §9.1): o token fica guardado pro login offline, mas o
      // app abre no Login — só entra depois de conferir a senha (online ou no aparelho).
      const trancada = Boolean(valor) && (await sessaoTrancada.esta());
      const salvo = valor && !trancada ? await lerUsuarioCache().catch(() => null) : null;
      // Abrir o app com sessão ativa pede a biometria, se o usuário ligou a opção e o aparelho tem.
      // O login confere que a preferência salva é de quem está logado (ver login abaixo).
      const exigeBiometria = Boolean(valor) && !trancada && (await biometriaLigadaNoAparelho());
      const acesso = await lerAcessoOffline();
      if (!cancelado) {
        setBloqueadoPorBiometria(exigeBiometria);
        setUsuarioSalvo(salvo);
        setToken(trancada ? null : valor);
        setAcessoOffline(acesso);
        setTokenCarregado(true);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const resposta = await authApi.me();
      void salvarUsuarioCache(resposta.usuario).catch(() => {});
      return resposta;
    },
    enabled: Boolean(token) && !usuarioDoLogin,
    retry: false,
  });

  // Sem sinal, o /auth/me falha: usa a cópia salva e o app abre normal. Sessão revogada de verdade
  // volta 401 no primeiro pedido com rede e o interceptor leva pro login (limpando a cópia).
  const usuario = usuarioDoLogin ?? meQuery.data?.usuario ?? usuarioSalvo;

  // Sentry: identifica o erro pelo uuid do usuário e da empresa — nunca nome, e-mail nem telefone.
  useEffect(() => {
    definirUsuarioSentry(
      usuario ? { id: usuario.id, empresaId: usuario.empresa?.id ?? null, tipo: usuario.user_type } : null,
    );
  }, [usuario?.id, usuario?.empresa?.id, usuario?.user_type]);
  const logado = Boolean(token);

  // Estado da opção de biometria pra quem está logado — relê a cada troca de usuário.
  useEffect(() => {
    const usuarioId = usuario?.id;
    if (!usuarioId) {
      setBiometria(null);
      return;
    }
    let cancelado = false;
    void Promise.all([aparelhoTemBiometria(), preferenciaBiometria.get()]).then(([disponivel, salva]) => {
      if (cancelado) return;
      const doUsuario = salva?.usuarioId === usuarioId ? salva : null;
      setBiometria({ disponivel, ativa: Boolean(doUsuario?.ativa), perguntar: disponivel && !doUsuario });
    });
    return () => {
      cancelado = true;
    };
  }, [usuario?.id]);

  // Renovação do token (vence em 7 dias, docs/67 §4.4) ao abrir o app e ao voltar do segundo
  // plano. Relê o token depois: o `token` exposto aqui vai em header de imagem (fora do axios) e
  // o antigo só vale mais 60 s depois de renovado.
  useEffect(() => {
    if (!logado) return;

    function renovar() {
      void renovarSessaoSeNecessario()
        .then(() => tokenStorage.get())
        .then((atual) => {
          if (atual) setToken(atual);
        });
    }

    renovar();
    const assinatura = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') renovar();
    });
    return () => assinatura.remove();
  }, [logado]);

  // A API pode invalidar um token a qualquer momento (usuário desativado, troca de
  // dispositivo) — o interceptor do axios detecta o 401 e dispara isso pra limpar a sessão.
  useEffect(() => {
    function handleUnauthorized(evento: Event) {
      if (evento instanceof SessaoEncerradaEvent && evento.mensagem) setAvisoSessao(evento.mensagem);
      setToken(null);
      setUsuarioDoLogin(null);
      setUsuarioSalvo(null);
      setModoOffline(false);
      // Sessão derrubada pelo servidor: o acesso offline cai junto (docs/108 — nunca entra sem
      // internet depois de um 401 de verdade).
      setAcessoOffline(null);
      void apagarAcessoOffline().catch(() => {});
      void sessaoTrancada.destrancar().catch(() => {});
      queryClient.clear();
      // Sessão pode ter sido revogada por outro promotor logando no mesmo dispositivo (trava
      // de 1 sessão, ver docs/02-API-BACKEND.md) — limpa o cache pra não vazar a carteira de
      // PDVs de quem estava logado antes.
      void limparCacheLocal();
      void encerrarRastreamentoNoLogout().catch(() => {});
      // Sem sessão não dá pra apagar no servidor; o próximo login neste celular reenvia e o
      // servidor tira o token do vínculo antigo (PushTokenController::salvar).
      void esquecerPushLocal();
    }

    function handleDesatualizado() {
      setAppDesatualizado(true);
    }

    authEvents.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    authEvents.addEventListener(APP_DESATUALIZADO_EVENT, handleDesatualizado);
    return () => {
      authEvents.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
      authEvents.removeEventListener(APP_DESATUALIZADO_EVENT, handleDesatualizado);
    };
  }, [queryClient]);

  async function desbloquearComBiometria() {
    if (await confirmarBiometria('Desbloquear o Horus')) setBloqueadoPorBiometria(false);
  }

  async function definirBiometria(ativa: boolean): Promise<boolean> {
    if (!usuario) return false;
    // Ligar exige passar no prompt — confirma que funciona e que é o dono do aparelho.
    if (ativa && !(await confirmarBiometria('Ativar a biometria no Horus'))) return false;
    await preferenciaBiometria.set({ usuarioId: usuario.id, ativa });
    setBiometria((atual) => (atual ? { ...atual, ativa, perguntar: false } : atual));
    return ativa;
  }

  async function entrarOnline(email: string, senha: string, response: authApi.LoginResponse) {
    // Sessão anterior caiu (sem logout) e agora entrou outra conta: a escolha de biometria era da
    // outra pessoa — descarta, a nova é perguntada de novo. O cache local e o acesso offline também
    // são de quem usou o aparelho antes (celular compartilhado): não podem vazar pro próximo.
    const preferencia = await preferenciaBiometria.get();
    if (preferencia && preferencia.usuarioId !== response.usuario.id) await preferenciaBiometria.clear();
    const acessoAnterior = await lerAcessoOffline();
    if (acessoAnterior && acessoAnterior.usuarioId !== response.usuario.id) {
      await apagarAcessoOffline();
      await limparCacheLocal().catch(() => {});
    }
    await tokenStorage.set(response.token);
    await sessaoTrancada.destrancar();
    setToken(response.token);
    setUsuarioDoLogin(response.usuario);
    setModoOffline(false);
    await salvarUsuarioCache(response.usuario).catch(() => {});

    // Acesso offline (docs/108 §5.1): gravado só depois do 2xx, com o limite de horas da empresa.
    // Já com o token no storage — o /parametros é autenticado. Falha aqui não derruba o login.
    try {
      const horasPermitidas = await buscarLoginOfflineHoras().catch(() => HORAS_OFFLINE_PADRAO);
      await gravarAcessoOffline({ usuarioId: response.usuario.id, email, senha, horasPermitidas });
      setAcessoOffline(await lerAcessoOffline());
    } catch (err) {
      if (__DEV__) console.log('[auth] acesso offline não gravado', err);
    }
  }

  async function entrarOffline(acesso: AcessoOffline) {
    const tokenSalvo = await tokenStorage.get();
    const usuarioCache = await lerUsuarioCache().catch(() => null);
    if (!tokenSalvo || !usuarioCache || usuarioCache.id !== acesso.usuarioId) {
      // Acesso guardado sem sessão por trás (não deveria acontecer: os dois são apagados juntos).
      await apagarAcessoOffline();
      setAcessoOffline(null);
      throw new Error('Sessão deste aparelho não encontrada. Conecte-se para entrar.');
    }
    await sessaoTrancada.destrancar();
    setModoOffline(true);
    setUsuarioDoLogin(usuarioCache);
    setToken(tokenSalvo);
  }

  async function login(email: string, senha: string) {
    setAvisoSessao(null);
    const resultado = await loginComPrazo({
      email,
      senha,
      loginOnline: () => authApi.login(email, senha),
      temConexao: await estaOnline().catch(() => true),
    });

    if (resultado.modo === 'online') {
      await entrarOnline(email, senha, resultado.resposta);
      return;
    }

    await entrarOffline(resultado.acesso);

    // A chamada online segue rodando. Se o servidor responder depois: 2xx troca pro token novo sem
    // interromper a tela; recusa das credenciais/conta derruba a sessão offline (a senha conferiu
    // aqui, mas o servidor é quem manda); erro de rede deixa como está — a revalidação cuida.
    void resultado.respostaTardia.then(
      (resposta) => entrarOnline(email, senha, resposta).catch(() => {}),
      (err) => {
        if (!axios.isAxiosError(err) || !err.response) return;
        const status = err.response.status;
        if (status === 401 || status === 403 || status === 422) {
          const dados = err.response.data as { message?: string; errors?: Record<string, string[]> } | undefined;
          const mensagem = dados?.errors ? Object.values(dados.errors)[0]?.[0] : dados?.message;
          authEvents.dispatchEvent(new SessaoEncerradaEvent(mensagem ?? 'O servidor recusou a sessão. Entre de novo.'));
        }
      },
    );
  }

  // Modo offline: ao reconectar e ao voltar do segundo plano, confirma a sessão com o servidor. 2xx
  // sai do modo offline e renova o prazo do acesso; 401 já é tratado pelo interceptor (derruba).
  useEffect(() => {
    if (!modoOffline || !token) return;

    function revalidar() {
      revalidando.current ??= (async () => {
        try {
          const { usuario: atual } = await authApi.me();
          setUsuarioDoLogin(atual);
          void salvarUsuarioCache(atual).catch(() => {});
          const horas = await buscarLoginOfflineHoras().catch(() => undefined);
          await renovarContatoOnline(horas).catch(() => {});
          setAcessoOffline(await lerAcessoOffline());
          setModoOffline(false);
        } catch {
          // Sem rede ainda: tenta na próxima reconexão / volta ao app.
        } finally {
          revalidando.current = null;
        }
      })();
    }

    revalidar();
    const pararReconexao = aoReconectar(revalidar);
    const assinatura = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') revalidar();
    });
    return () => {
      pararReconexao();
      assinatura.remove();
    };
  }, [modoOffline, token]);

  function atualizarUsuario(usuarioAtualizado: Usuario) {
    setUsuarioDoLogin(usuarioAtualizado);
    void salvarUsuarioCache(usuarioAtualizado).catch(() => {});
  }

  async function logout() {
    // Tranca (docs/108 §9.1): a sessão continua válida no servidor e guardada no aparelho — como já
    // acontecia ao fechar o app com a biometria ligada — só que o app volta pro Login e exige a
    // senha pra entrar, com ou sem internet. Token, cache local, e-mail lembrado e acesso offline
    // ficam. O que precisa parar de verdade: o rastreamento em segundo plano.
    await sessaoTrancada.trancar();
    setToken(null);
    setUsuarioDoLogin(null);
    setUsuarioSalvo(null);
    setModoOffline(false);
    setBloqueadoPorBiometria(false);
    queryClient.clear();
    await encerrarRastreamentoNoLogout().catch(() => {});
  }

  async function sairELimpar() {
    // Antes do logout da API: o DELETE do token de push ainda precisa da sessão (docs/77 §3.1).
    await apagarPushNoLogout();
    try {
      await authApi.logout();
    } catch {
      // Best-effort: mesmo se a chamada falhar (rede, token já expirado), limpa a sessão local.
    }
    await tokenStorage.clear();
    await sessaoTrancada.destrancar();
    // "Terminei"/"próxima pessoa usa o aparelho": esquece o e-mail lembrado, a biometria e o acesso
    // offline também. Ver credentialsStorage.ts.
    await credenciaisStorage.clear();
    await preferenciaBiometria.clear();
    await apagarAcessoOffline();
    setToken(null);
    setUsuarioDoLogin(null);
    setUsuarioSalvo(null);
    setModoOffline(false);
    setAcessoOffline(null);
    setBloqueadoPorBiometria(false);
    queryClient.clear();
    // Aparelho pode ser compartilhado entre promotores (ex.: celular da loja): o próximo login não
    // pode herdar cache de outro. A fila de envio NÃO é apagada (database.ts).
    await limparCacheLocal();
    // Sem isso a tarefa em segundo plano continuaria mandando posição depois do logout.
    await encerrarRastreamentoNoLogout().catch(() => {});
  }

  const isLoading = !tokenCarregado || (Boolean(token) && !usuario && meQuery.isLoading);

  return (
    <AuthContext.Provider
      value={{
        usuario,
        token,
        isLoading,
        isAuthenticated: Boolean(token) && Boolean(usuario),
        login,
        logout,
        sairELimpar,
        modoOffline,
        acessoOffline,
        atualizarUsuario,
        avisoSessao,
        limparAvisoSessao: () => setAvisoSessao(null),
        appDesatualizado,
        bloqueadoPorBiometria,
        desbloquearComBiometria,
        biometria,
        definirBiometria,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

async function biometriaLigadaNoAparelho(): Promise<boolean> {
  try {
    const preferencia = await preferenciaBiometria.get();
    return Boolean(preferencia?.ativa) && (await aparelhoTemBiometria());
  } catch {
    return false;
  }
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  }

  return context;
}
