import { useCallback, useEffect, useState } from 'react';
import { listarRegistrosLocais, type RegistroLocal } from './db/filaRegistros';
import {
  listarVisitasLocaisPendentesOuRejeitadas,
  visitasConfirmadasNestaSessao,
  type VisitaConfirmada,
  type VisitaLocal,
} from './db/filaVisitas';
import { FILA_ENVIO_INICIOU_EVENT, filaEnviandoAgora, filaEnvioEvents } from './filaEnvio';
import { useEstaOnline } from './network';
import { useAoAtualizarFilaEnvio } from './useFilaEnvioAtualizada';

/**
 * Selo de envio da visita (docs/110). O card da Agenda e da lista de lojas mostrava só o status do
 * servidor: com internet ruim a OS seguia "Pendente" (sem selo) ou "Atrasada" mesmo com a visita
 * salva no celular, e o promotor não tinha certeza de que o registro foi feito. Aqui o estado da
 * fila local é traduzido num selo que vale mais que o do servidor enquanto existir.
 */
export type TipoSeloEnvio = 'SALVA' | 'ENVIANDO' | 'ENVIADA' | 'NAO_ENVIADA' | 'EM_ANDAMENTO';

export interface SeloEnvio {
  tipo: TipoSeloEnvio;
  rotulo: string;
  detalhe: string | null;
}

interface Entrada {
  visita: VisitaLocal;
  registros: Pick<RegistroLocal, 'status'>[];
  online: boolean;
  enviando: boolean;
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Função pura — testável sem SQLite nem React. */
export function seloDaVisitaLocal({ visita, registros, online, enviando }: Entrada): SeloEnvio {
  const validos = registros.filter((r) => r.status !== 'DESCARTADO');
  const enviados = validos.filter((r) => r.status === 'ENVIADO').length;
  const progresso = validos.length > 0 ? `${enviados} de ${validos.length} registros enviados` : null;

  if (visita.status === 'REJEITADA') {
    return { tipo: 'NAO_ENVIADA', rotulo: 'Não enviada', detalhe: visita.erro ? `${visita.erro} Toque para ver.` : 'O servidor recusou. Toque para ver.' };
  }

  // Visita ainda aberta: o selo de "em andamento" já existe; só acrescenta onde o check-in está.
  if (visita.status === 'RASCUNHO' || visita.status === 'CHECKIN_ENVIADO') {
    if (visita.servidorId) return { tipo: 'EM_ANDAMENTO', rotulo: 'Em andamento', detalhe: null };
    return {
      tipo: 'EM_ANDAMENTO',
      rotulo: 'Em andamento · salva no celular',
      detalhe: online ? 'Enviando o check-in…' : 'O check-in sobe quando houver sinal.',
    };
  }

  // FINALIZADA_LOCAL: finalizada aqui, falta o servidor confirmar.
  const comErro = !!visita.erro || validos.some((r) => r.status === 'ERRO');
  if (comErro && !enviando) {
    return { tipo: 'NAO_ENVIADA', rotulo: 'Não enviada', detalhe: `${visita.erro ?? 'Um registro foi recusado.'} Toque para ver.` };
  }
  if (online && enviando) {
    return { tipo: 'ENVIANDO', rotulo: 'Enviando ao servidor', detalhe: progresso };
  }
  return {
    tipo: 'SALVA',
    rotulo: 'Salva no celular',
    detalhe: online ? 'Aguardando a próxima tentativa de envio.' : 'Sem internet. Envia sozinha quando o sinal voltar.',
  };
}

export function seloDaConfirmada(c: VisitaConfirmada): SeloEnvio {
  return { tipo: 'ENVIADA', rotulo: '✓ Enviada', detalhe: `Confirmada às ${hora(c.confirmadaEm)}.` };
}

export interface MapaSelos {
  porOrdemServico: Map<string, SeloEnvio>;
  porPontoVenda: Map<string, SeloEnvio>;
  /** Visita local de cada loja — pra o toque no selo "Não enviada" abrir a visita. */
  visitaPorPontoVenda: Map<string, string>;
}

const VAZIO: MapaSelos = { porOrdemServico: new Map(), porPontoVenda: new Map(), visitaPorPontoVenda: new Map() };

/** Selos de todas as visitas na fila do usuário + as confirmadas nesta sessão. Relê a cada passada da fila. */
export function useSelosEnvio(usuarioId: string | undefined): MapaSelos {
  const online = useEstaOnline();
  const [mapa, setMapa] = useState<MapaSelos>(VAZIO);

  const reler = useCallback(() => {
    if (!usuarioId) return;
    void (async () => {
      const novo: MapaSelos = { porOrdemServico: new Map(), porPontoVenda: new Map(), visitaPorPontoVenda: new Map() };
      // Confirmadas primeiro: uma visita nova na fila pra mesma loja tem prioridade.
      for (const c of visitasConfirmadasNestaSessao()) {
        const selo = seloDaConfirmada(c);
        if (c.ordemServicoId) novo.porOrdemServico.set(c.ordemServicoId, selo);
        novo.porPontoVenda.set(c.pontoVendaId, selo);
      }
      const enviando = filaEnviandoAgora();
      for (const visita of await listarVisitasLocaisPendentesOuRejeitadas(usuarioId)) {
        const registros = await listarRegistrosLocais(visita.id).catch(() => []);
        const selo = seloDaVisitaLocal({ visita, registros, online, enviando });
        if (visita.ordemServicoId) novo.porOrdemServico.set(visita.ordemServicoId, selo);
        novo.porPontoVenda.set(visita.pontoVenda.id, selo);
        novo.visitaPorPontoVenda.set(visita.pontoVenda.id, visita.id);
      }
      setMapa(novo);
    })().catch(() => {});
  }, [usuarioId, online]);

  useEffect(() => {
    reler();
  }, [reler]);
  useAoAtualizarFilaEnvio(reler);
  useEffect(() => {
    filaEnvioEvents.addEventListener(FILA_ENVIO_INICIOU_EVENT, reler);
    return () => filaEnvioEvents.removeEventListener(FILA_ENVIO_INICIOU_EVENT, reler);
  }, [reler]);

  return mapa;
}
