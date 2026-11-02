import axios from 'axios';
import { apiClient } from './api/client';
import {
  apagarPosicoes,
  apagarSituacao,
  enfileirarPosicoes,
  enfileirarSituacao,
  lerSituacoes,
  lerLotePosicoes,
  limparFilaPosicoes,
  podarPosicoesAntesDe,
  type PosicaoNaFila,
} from './db/filaLocalizacoes';

/**
 * Fila offline do rastreamento (docs/101). Antes, a leitura que não conseguia subir (sem sinal)
 * era descartada e a Rota do dia ficava com um buraco no trajeto. Agora toda leitura do GPS entra
 * numa fila no SQLite e sobe em lotes, da mais antiga pra mais recente, assim que a internet
 * deixa — mesma ideia da fila de visitas e registros. O servidor grava cada ponto com o horário
 * real da leitura e a posição ao vivo do mapa nunca volta pra trás.
 *
 * docs/94: a bateria vai dentro da posição, e as mudanças de situação do rastreamento (GPS
 * desligado, sem permissão...) entram numa fila ao lado, com o horário em que o app viu — sobem
 * primeiro, na mesma descarga.
 */

export const TAMANHO_LOTE = 100;
// Teto da fila: um aparelho dias sem sinal não acumula sem limite.
export const LIMITE_FILA_HORAS = 24;

export type ResultadoDescarga = 'VAZIA' | 'ENVIADA' | 'SEM_REDE' | 'RASTREAMENTO_DESLIGADO';

let descarregando: Promise<ResultadoDescarga> | null = null;

export async function guardarPosicoes(posicoes: Omit<PosicaoNaFila, 'id'>[]): Promise<void> {
  await enfileirarPosicoes(posicoes);
}

export async function guardarSituacao(situacao: string, detalhe: string | null, ocorridoEm = new Date()): Promise<void> {
  await enfileirarSituacao({ situacao, detalhe, ocorridoEm: ocorridoEm.toISOString() });
}

const statusDoErro = (err: unknown) => (axios.isAxiosError(err) ? err.response?.status : undefined);

/**
 * Manda tudo o que estiver na fila, lote a lote. Falha de rede/5xx: para e deixa o resto pra
 * próxima tentativa. 403: a empresa desligou o rastreamento — a fila não serve mais, some.
 * 422: lote com dado que o servidor nunca vai aceitar — descarta só ele, pra não travar a fila.
 * Uma descarga por vez (a tarefa e a tela podem chamar juntas).
 */
export function descarregarPosicoes(agora = new Date()): Promise<ResultadoDescarga> {
  if (!descarregando) {
    descarregando = descarregar(agora).finally(() => {
      descarregando = null;
    });
  }
  return descarregando;
}

async function descarregar(agora: Date): Promise<ResultadoDescarga> {
  await podarPosicoesAntesDe(new Date(agora.getTime() - LIMITE_FILA_HORAS * 3600 * 1000).toISOString());

  let enviouAlguma = false;

  // Situações primeiro, uma a uma (são raras), em ordem.
  for (const s of await lerSituacoes()) {
    try {
      await apiClient.patch('/localizacao/situacao', { situacao: s.situacao, detalhe: s.detalhe, ocorrido_em: s.ocorridoEm });
    } catch (err) {
      const status = statusDoErro(err);
      // 4xx: o servidor nunca vai aceitar esta — some pra não travar a fila.
      if (status === undefined || status >= 500) return 'SEM_REDE';
    }
    await apagarSituacao(s.id);
    enviouAlguma = true;
  }

  for (;;) {
    const lote = await lerLotePosicoes(TAMANHO_LOTE);
    if (lote.length === 0) return enviouAlguma ? 'ENVIADA' : 'VAZIA';

    try {
      await apiClient.post('/localizacao/lote', {
        posicoes: lote.map((p) => ({
          latitude: p.latitude,
          longitude: p.longitude,
          capturado_em: p.capturadoEm,
          simulada: p.simulada,
          ...(p.bateria
            ? { bateria_nivel: p.bateria.nivel, bateria_carregando: p.bateria.carregando, bateria_economia: p.bateria.economia }
            : {}),
        })),
      });
    } catch (err) {
      const status = statusDoErro(err);
      if (status === 403) {
        await limparFilaPosicoes();
        return 'RASTREAMENTO_DESLIGADO';
      }
      if (status !== 422) return 'SEM_REDE';
    }
    await apagarPosicoes(lote.map((p) => p.id));
    enviouAlguma = true;
    if (lote.length < TAMANHO_LOTE) return 'ENVIADA';
  }
}

/**
 * Logout: as posições pertencem a quem estava logado e não podem subir em nome do próximo login.
 * Não tenta enviar — o token já foi apagado, e um 401 aqui dispararia o "sessão encerrada" de novo.
 */
export async function encerrarFilaPosicoes(): Promise<void> {
  await limparFilaPosicoes().catch(() => undefined);
}
