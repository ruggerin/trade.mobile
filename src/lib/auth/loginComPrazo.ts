import { ehErroDeRede } from '../db/database';
import { comPrazo, PrazoEstouradoError } from '../prazo';
import { redeEstaRuim } from '../qualidadeRede';
import { conferirAcessoOffline, type AcessoOffline, type MotivoRecusaOffline } from './acessoOffline';

/**
 * Orquestração do login (docs/108 §4): rede primeiro, com prazo; sem resposta a tempo, a senha é
 * conferida no aparelho. Isolado do AuthContext pra ser testável sem React.
 *
 * Resultados:
 *  - `online`: o servidor respondeu 2xx dentro do prazo.
 *  - `offline`: entrou pelo acesso guardado; `online` ainda pode chegar depois (quem chamou decide o
 *    que fazer com a resposta tardia — trocar o token, ou derrubar a sessão se o servidor recusou).
 * Erros:
 *  - erro do servidor (4xx/5xx com resposta) é repassado como veio — NUNCA cai pro offline.
 *  - sem rede e sem acesso offline válido: `ErroLoginOffline` com o motivo (mensagem da tela).
 */
export const PRAZO_LOGIN_ONLINE_MS = 4_000;

export class ErroLoginOffline extends Error {
  constructor(
    readonly motivo: MotivoRecusaOffline,
    /** O erro de rede que levou ao offline, pra tela mostrar "sem internet" quando não há acesso. */
    readonly erroDeRede: unknown,
  ) {
    super(`login offline recusado: ${motivo}`);
    this.name = 'ErroLoginOffline';
  }
}

export type ResultadoLogin<R> =
  | { modo: 'online'; resposta: R }
  | { modo: 'offline'; acesso: AcessoOffline; respostaTardia: Promise<R> };

interface Opcoes<R> {
  email: string;
  senha: string;
  loginOnline: () => Promise<R>;
  /** `false` quando o aparelho diz que não tem conexão nenhuma — nem vale disparar a rede. */
  temConexao?: boolean;
  prazoMs?: number;
}

export async function loginComPrazo<R>({
  email,
  senha,
  loginOnline,
  temConexao = true,
  prazoMs = PRAZO_LOGIN_ONLINE_MS,
}: Opcoes<R>): Promise<ResultadoLogin<R>> {
  // Sem conexão nenhuma: direto pro offline, sem gastar o prazo.
  if (!temConexao) return entrarOffline(email, senha, null, Promise.reject(new Error('sem conexão')));

  const online = loginOnline();
  online.catch(() => {});

  // Rede já marcada como ruim pelo disjuntor: não espera — mas a chamada segue, porque é a resposta
  // dela que prova que a rede voltou.
  const espera = redeEstaRuim() ? 0 : prazoMs;

  try {
    return { modo: 'online', resposta: await comPrazo(online, espera) };
  } catch (err) {
    const prazoEstourou = err instanceof PrazoEstouradoError;
    // Servidor respondeu (senha errada, 429, 426, conta bloqueada): é a resposta final.
    if (!prazoEstourou && !ehErroDeRede(err)) throw err;

    const resultado = await conferirAcessoOffline(email, senha);
    if (resultado.ok) return { modo: 'offline', acesso: resultado.acesso, respostaTardia: online };

    // Sem acesso offline que sirva: se a rede só estava lenta, ainda vale esperar a resposta de
    // verdade (até o timeout do client) em vez de recusar na hora.
    if (prazoEstourou) {
      try {
        return { modo: 'online', resposta: await online };
      } catch (errFinal) {
        if (!ehErroDeRede(errFinal)) throw errFinal;
        throw new ErroLoginOffline(resultado.motivo, errFinal);
      }
    }
    throw new ErroLoginOffline(resultado.motivo, err);
  }
}

async function entrarOffline<R>(email: string, senha: string, erroDeRede: unknown, tardia: Promise<R>): Promise<ResultadoLogin<R>> {
  tardia.catch(() => {});
  const resultado = await conferirAcessoOffline(email, senha);
  if (!resultado.ok) throw new ErroLoginOffline(resultado.motivo, erroDeRede);
  return { modo: 'offline', acesso: resultado.acesso, respostaTardia: tardia };
}
