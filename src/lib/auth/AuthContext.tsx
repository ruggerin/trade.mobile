import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import * as authApi from '../api/auth';
import { authEvents, UNAUTHORIZED_EVENT } from '../api/client';
import { limparCacheLocal } from '../db/database';
import { credenciaisStorage } from './credentialsStorage';
import { encerrarRastreamentoNoLogout } from '../rastreamento';
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

  useEffect(() => {
    let cancelado = false;
    tokenStorage.get().then((valor) => {
      if (!cancelado) {
        setToken(valor);
        setTokenCarregado(true);
      }
    });
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

  // A API pode invalidar um token a qualquer momento (usuário desativado, troca de
  // dispositivo) — o interceptor do axios detecta o 401 e dispara isso pra limpar a sessão.
  useEffect(() => {
    function handleUnauthorized() {
      setToken(null);
      setUsuarioDoLogin(null);
      queryClient.clear();
      // Sessão pode ter sido revogada por outro promotor logando no mesmo dispositivo (trava
      // de 1 sessão, ver docs/02-API-BACKEND.md) — limpa o cache pra não vazar a carteira de
      // PDVs de quem estava logado antes.
      void limparCacheLocal();
      void encerrarRastreamentoNoLogout().catch(() => {});
    }

    authEvents.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => authEvents.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [queryClient]);

  async function login(email: string, senha: string) {
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
    // é o sinal de "terminei"/"próxima pessoa usa o aparelho", então esquece a senha lembrada
    // também. Ver credentialsStorage.ts.
    await credenciaisStorage.clear();
    setToken(null);
    setUsuarioDoLogin(null);
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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  }

  return context;
}
