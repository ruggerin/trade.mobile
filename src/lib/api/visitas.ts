import type { PaginatedMeta, TipoVinculoRegistro, Visita, VisitaRegistro } from '../../types/api';
import { ehErroDeRede } from '../db/database';
import { lerVisitasHistoricoCache, salvarVisitasHistoricoCache } from '../db/visitasCache';
import { apiClient } from './client';

export interface CheckinPayload {
  ponto_venda_uuid: string;
  latitude: number;
  longitude: number;
  // Presente quando o check-in nasce de uma OrdemServico direcionada — ver
  // docs/07-ORDEM-DE-SERVICO.md.
  ordem_servico_uuid?: string;
  // Idempotência — mesmo uuid local da visita na fila (`fila_visitas.id`), reenviado sem mudar
  // a cada nova tentativa da mesma visita. Se o app fechar entre o servidor confirmar e o
  // celular gravar a resposta, o reenvio com a MESMA chave devolve a visita já criada em vez de
  // duplicar — ver VisitaController::store e lib/filaEnvio.ts.
  idempotency_key?: string;
}

export async function iniciarVisita(payload: CheckinPayload): Promise<Visita> {
  const { data } = await apiClient.post<{ visita: Visita }>('/visitas', payload);
  return data.visita;
}

export async function buscarVisita(visitaId: string): Promise<Visita> {
  const { data } = await apiClient.get<{ visita: Visita }>(`/visitas/${visitaId}`);
  return data.visita;
}

export async function finalizarVisita(visitaId: string, latitude: number, longitude: number): Promise<Visita> {
  const { data } = await apiClient.patch<{ visita: Visita }>(`/visitas/${visitaId}/checkout`, {
    latitude,
    longitude,
  });
  return data.visita;
}

export interface VisitasListResponse {
  visitas: Visita[];
  meta: PaginatedMeta;
}

// usuario_uuid=eu funciona pra qualquer user_type, mas pra PROMOTOR o backend já força as
// próprias visitas de qualquer forma (ver docs/02-API-BACKEND.md) — mandar explícito não muda
// o resultado, só deixa a intenção clara na chamada. Cache local (rede primeiro, fallback se
// faltar sinal) — mesmo padrão de lib/api/pontosVenda.ts, ver lib/db/visitasCache.ts.
export async function listarMinhasVisitas(): Promise<VisitasListResponse> {
  try {
    const { data } = await apiClient.get<VisitasListResponse>('/visitas', {
      params: { usuario_uuid: 'eu' },
    });
    void salvarVisitasHistoricoCache(data.visitas).catch(() => {});
    return data;
  } catch (err) {
    if (!ehErroDeRede(err)) throw err;

    const cache = await lerVisitasHistoricoCache();
    return {
      visitas: cache,
      meta: { current_page: 1, last_page: 1, per_page: cache.length, total: cache.length },
    };
  }
}

export interface CriarRegistroPayload {
  visitaId: string;
  // Idempotência — mesmo uuid local do registro na fila (`fila_registros.id`), reenviado sem
  // mudar a cada nova tentativa do mesmo registro. Se o app fechar entre o servidor confirmar e
  // o celular gravar a resposta, o reenvio com a MESMA chave devolve o registro já criado em vez
  // de duplicar a foto — mesmo raciocínio do check-in, ver VisitaRegistroController::store e
  // lib/filaEnvio.ts.
  idempotencyKey: string;
  // Uuid do TipoRegistro escolhido (catálogo customizável da empresa) — substitui o antigo
  // enum fixo FOTO/RUPTURA/OBSERVACAO, ver docs/01-MODELO-DE-DADOS.md#54-tipos-de-registro.
  tipoRegistroUuid: string;
  // N fotos por registro (0..N) — ver docs/21-EVIDENCIA-EM-FOTOS.md.
  imagensUri?: string[];
  produtoAuditoriaUuid?: string;
  // Vínculo opcional a um recorte mais amplo do catálogo (só um dos uuids abaixo, conforme
  // tipoVinculo) — mutuamente exclusivo com produtoAuditoriaUuid.
  tipoVinculo?: TipoVinculoRegistro;
  secaoUuid?: string;
  departamentoUuid?: string;
  marcaUuid?: string;
  // Respostas dos campos customizados do tipo escolhido, chaveadas por CampoTipoRegistro.chave.
  valoresCampos?: Record<string, string>;
  ruptura?: boolean;
  observacao?: string;
}

export async function criarRegistro(payload: CriarRegistroPayload): Promise<VisitaRegistro> {
  const form = new FormData();
  form.append('idempotency_key', payload.idempotencyKey);
  form.append('tipo_registro_uuid', payload.tipoRegistroUuid);

  if (payload.produtoAuditoriaUuid) {
    form.append('produto_auditoria_uuid', payload.produtoAuditoriaUuid);
  }
  if (payload.tipoVinculo) {
    form.append('tipo_vinculo', payload.tipoVinculo);
  }
  if (payload.secaoUuid) {
    form.append('secao_uuid', payload.secaoUuid);
  }
  if (payload.departamentoUuid) {
    form.append('departamento_uuid', payload.departamentoUuid);
  }
  if (payload.marcaUuid) {
    form.append('marca_uuid', payload.marcaUuid);
  }
  if (payload.ruptura !== undefined) {
    form.append('ruptura', payload.ruptura ? '1' : '0');
  }
  if (payload.observacao) {
    form.append('observacao', payload.observacao);
  }
  // Laravel entende a notação `campo[chave]` em multipart/form-data como array associativo —
  // não dá pra mandar um objeto direto num FormData.
  if (payload.valoresCampos) {
    for (const [chave, valor] of Object.entries(payload.valoresCampos)) {
      form.append(`valores_campos[${chave}]`, valor);
    }
  }
  for (const imagemUri of payload.imagensUri ?? []) {
    const nomeArquivo = imagemUri.split('/').pop() ?? 'foto.jpg';
    const extensao = /\.(\w+)$/.exec(nomeArquivo)?.[1]?.toLowerCase();
    const tipoMime = `image/${extensao === 'jpg' ? 'jpeg' : (extensao ?? 'jpeg')}`;

    // RN/Expo aceitam esse formato {uri, name, type} como valor de FormData.append pra upload
    // de arquivo local — não é um Blob de verdade, mas o axios/fetch nativo sabe lidar com isso.
    // 'imagens[]' (repetido, um append por arquivo) é a notação que o Laravel entende como
    // array de arquivos em multipart/form-data — mesma raciocínio de valores_campos[chave] logo
    // acima.
    form.append('imagens[]', { uri: imagemUri, name: nomeArquivo, type: tipoMime } as unknown as Blob);
  }

  const { data } = await apiClient.post<{ registro: VisitaRegistro }>(
    `/visitas/${payload.visitaId}/registros`,
    form,
    // Upload de foto em rede móvel passa fácil dos 8s do timeout padrão do client — estourar aqui
    // é lido como "erro de rede" (transitório) e o registro ficava tentando de novo pra sempre,
    // travando o checkout atrás dele na fila. Folga generosa só pra este envio.
    { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 90_000 },
  );
  return data.registro;
}

// Cancelamento (soft, nunca apaga) de um registro já enviado — parametrizável por empresa pra
// PROMOTOR (REGISTRO_CANCELAMENTO_PERMITIDO), o botão só aparece quando o parâmetro permite (ver
// buscarCancelamentoRegistroPermitido em lib/api/parametros.ts). Ação online, sem fila offline —
// só faz sentido cancelar algo que o servidor já reconhece.
export async function cancelarRegistro(visitaId: string, registroId: string): Promise<VisitaRegistro> {
  const { data } = await apiClient.post<{ registro: VisitaRegistro }>(
    `/visitas/${visitaId}/registros/${registroId}/cancelar`,
  );
  return data.registro;
}

// Autosserviço: promotor cancela a própria visita em andamento (status ABERTA) — parametrizável
// por empresa (VISITA_CANCELAMENTO_PERMITIDO), o botão só aparece quando o parâmetro permite
// (ver buscarCancelamentoVisitaPermitido em lib/api/parametros.ts). Ação online, sem fila
// offline — só faz sentido cancelar uma visita que o servidor já reconhece, ver
// lib/visitaLocal.ts::cancelarVisitaLocal.
// Saída de segurança pra visita travada: um gestor/admin autoriza com e-mail e senha no aparelho do
// promotor (auditado no servidor, com limite de tentativas). Ver lib/useDescarteVisita.tsx.
export async function cancelarVisitaAutorizado(visitaId: string, email: string, senha: string): Promise<Visita> {
  const { data } = await apiClient.post<{ visita: Visita }>(`/visitas/${visitaId}/cancelar-autorizado`, { email, senha });
  return data.visita;
}

export async function cancelarVisita(visitaId: string): Promise<Visita> {
  const { data } = await apiClient.post<{ visita: Visita }>(`/visitas/${visitaId}/cancelar-propria`);
  return data.visita;
}
