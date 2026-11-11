import * as Sentry from '@sentry/react-native';
import { escrever, getDatabase } from './db/database';

/**
 * Diário de eventos do aparelho (docs/112). Nasceu de "fiz a visita e sumiu a foto do antes" sem
 * nenhum rastro: `console.log` não fica guardado em produção e o Sentry só via erro — apagar uma
 * foto não é erro. Agora:
 *  - todo evento vai pra tabela `diario_eventos` (7 dias) e vira breadcrumb do Sentry;
 *  - apagar foto que ainda não chegou no servidor vira um EVENTO no Sentry (`warning`), com o motivo
 *    — dá pra ver no painel sem depender do promotor;
 *  - "Enviar diagnóstico" (Perfil) manda o diário inteiro anexado a um evento do Sentry.
 * Nunca guarda coordenada, texto digitado nem conteúdo de foto: só tipo, ids e contagens.
 */
export type TipoEvento =
  | 'app_aberto'
  | 'app_segundo_plano'
  | 'app_primeiro_plano'
  | 'foto_capturada'
  | 'foto_apagada'
  | 'rascunho_criado'
  | 'rascunho_descartado'
  | 'registro_criado'
  | 'registro_enviado'
  | 'visita_finalizada'
  | 'visita_removida'
  | 'visita_reenviada';

/** Por que uma foto local foi apagada — obrigatório em `apagarImagemPersistente`. */
export type MotivoApagarFoto =
  | 'promotor_removeu'
  | 'formulario_fechado_sem_salvar'
  | 'produto_voltou_sem_salvar'
  | 'produto_salvo_sem_esta_foto'
  | 'falha_ao_gravar_registro'
  | 'registro_cancelado'
  | 'rascunho_descartado_pelo_promotor'
  | `rascunho_apagado_com_visita:${string}`
  | `coleta_apagada_com_visita:${string}`
  | 'enviada_ao_servidor';

const DIAS_GUARDADOS = 7;

export function registrarEvento(tipo: TipoEvento, dados: Record<string, unknown> = {}, visitaLocalId?: string | null): void {
  try {
    Sentry.addBreadcrumb({ category: `diario.${tipo}`, level: tipo === 'foto_apagada' ? 'warning' : 'info', data: { ...dados, visitaLocalId } });
  } catch {
    // Diário nunca derruba o app.
  }
  void escrever('INSERT INTO diario_eventos (em, tipo, visita_local_id, dados_json) VALUES (?, ?, ?, ?)', [
    new Date().toISOString(),
    tipo,
    visitaLocalId ?? null,
    JSON.stringify(dados),
  ]).catch(() => {});
}

/**
 * Foto/rascunho que o promotor ainda não tinha mandado pro servidor foi apagado: evento no Sentry,
 * não só breadcrumb — é exatamente o caso que precisa aparecer sem ninguém pedir.
 */
export function avisarPerdaDeFoto(motivo: MotivoApagarFoto, fotos: number, visitaLocalId?: string | null): void {
  if (fotos <= 0 || motivo === 'enviada_ao_servidor' || motivo === 'promotor_removeu') return;
  try {
    Sentry.captureMessage('Foto ainda não enviada foi apagada do aparelho', {
      level: 'warning',
      tags: { origem: 'diario', motivo: motivo.split(':')[0], motivo_detalhe: motivo },
      extra: { fotos, visitaLocalId },
      fingerprint: ['foto-apagada', motivo],
    });
  } catch {
    // idem
  }
}

export interface EventoDiario {
  em: string;
  tipo: string;
  visitaLocalId: string | null;
  dados: Record<string, unknown>;
}

export async function lerDiario(limite = 2000): Promise<EventoDiario[]> {
  const db = await getDatabase();
  const linhas = await db.getAllAsync<{ em: string; tipo: string; visita_local_id: string | null; dados_json: string | null }>(
    'SELECT em, tipo, visita_local_id, dados_json FROM diario_eventos ORDER BY id DESC LIMIT ?',
    [limite],
  );
  return linhas.map((l) => {
    let dados: Record<string, unknown> = {};
    try {
      dados = l.dados_json ? (JSON.parse(l.dados_json) as Record<string, unknown>) : {};
    } catch {
      // linha corrompida: vai sem dados
    }
    return { em: l.em, tipo: l.tipo, visitaLocalId: l.visita_local_id, dados };
  });
}

export async function podarDiario(agora = new Date()): Promise<void> {
  const limite = new Date(agora.getTime() - DIAS_GUARDADOS * 24 * 3600 * 1000).toISOString();
  await escrever('DELETE FROM diario_eventos WHERE em < ?', [limite]);
}

/** "Enviar diagnóstico" (Perfil): o diário inteiro como anexo de um evento do Sentry. */
export async function enviarDiagnostico(descricao: string): Promise<string | null> {
  const eventos = await lerDiario();
  let id: string | null = null;
  Sentry.withScope((scope) => {
    scope.addAttachment({ filename: 'diario.json', data: JSON.stringify(eventos, null, 1), contentType: 'application/json' });
    scope.setTag('origem', 'diagnostico');
    id = Sentry.captureMessage(`Diagnóstico enviado pelo promotor: ${descricao.slice(0, 120)}`, 'info');
  });
  await Sentry.flush();
  return id;
}
