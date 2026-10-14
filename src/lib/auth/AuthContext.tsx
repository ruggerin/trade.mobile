import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import { AppState } from 'react-native';
import * as authApi from '../api/auth';
import { APP_DESATUALIZADO_EVENT, authEvents, SessaoEncerradaEvent, UNAUTHORIZED_EVENT } from '../api/client';
import { limparCacheLocal } from '../db/database';
import { credenciaisStorage } from './credentialsStorage';
import { renovarSessaoSeNecessario } from './renovacaoSessao';
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
  login: (email: string, senha: string) => Promise<void>;
  logout: () => Promise<void>;
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
  // Sessão ativa esperando a digital/rosto (docs/67 §4.5) — só quando o usuário ligou a opção.
  bloqueadoPorBiometria: boolean;
  desbloquearComBiometria: () => Promise<void>;
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

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const valor = await tokenStorage.get();
      // Abrir o app com sessão ativa pede a biometria, se o usuário ligou a opção e o aparelho tem.
      const exigeBiometria = Boolean(valor) && (await biometriaDisponivelELigada());
      if (!cancelado) {
        setBloqueadoPorBiometria(exigeBiometria);
        setToken(valor);
        setTokenCarregado(true);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: authApi.me,
    enabled: Boolean(token) && !usuarioDoLogin,
    retry: false,
  });

  const usuario = usuarioDoLogin ?? meQuery.data?.usuario ?? null;

  // Sentry: identifica o erro pelo uuid do usuário e da empresa — nunca nome, e-mail nem telefone.
  useEffect(() => {
    definirUsuarioSentry(
      usuario ? { id: usuario.id, empresaId: usuario.empresa?.id ?? null, tipo: usuario.user_type } : null,
    );
  }, [usuario?.id, usuario?.empresa?.id, usuario?.user_type]);
  const logado = Boolean(token);

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
      queryClient.clear();
      // Sessão pode ter sido revogada por outro promotor logando no mesmo dispositivo (trava
      // de 1 sessão, ver docs/02-API-BACKEND.md) — limpa o cache pra não vazar a carteira de
      // PDVs de quem estava logado antes.
      void limparCacheLocal();
      void encerrarRastreamentoNoLogout().catch(() => {});
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
    const resultado = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Desbloquear o Horus',
      cancelLabel: 'Cancelar',
    });
    if (resultado.success) setBloqueadoPorBiometria(false);
  }

  async function login(email: string, senha: string) {
    setAvisoSessao(null);
    const response = await authApi.login(email, senha);
    await tokenStorage.set(response.token);
    setToken(response.token);
    setUsuarioDoLogin(response.usuario);
  }

  function atualizarUsuario(usuarioAtualizado: Usuario) {
    setUsuarioDoLogin(usuarioAtualizado);
  }

  async function logout() {
    try {
      await authApi.logout();
    } catch {
      // Best-effort: mesmo se a chamada falhar (rede, token já expirado), limpa a sessão local.
    }
    await tokenStorage.clear();
    // Logout explícito (diferente do handleUnauthorized acima, que é a sessão caindo sozinha) —
    // é o sinal de "terminei"/"próxima pessoa usa o aparelho", então esquece o e-mail lembrado
    // também. Ver credentialsStorage.ts.
    await credenciaisStorage.clear();
    setToken(null);
    setUsuarioDoLogin(null);
    setBloqueadoPorBiometria(false);
    queryClient.clear();
    // Mesmo motivo do handleUnauthorized acima: aparelho pode ser compartilhado entre
    // promotores (ex.: celular da loja), o próximo login não pode herdar cache de outro.
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
        atualizarUsuario,
        avisoSessao,
        limparAvisoSessao: () => setAvisoSessao(null),
        appDesatualizado,
        bloqueadoPorBiometria,
        desbloquearComBiometria,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

async function biometriaDisponivelELigada(): Promise<boolean> {
  try {
    const salvas = await credenciaisStorage.get();
    if (!salvas?.biometria) return false;
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
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
