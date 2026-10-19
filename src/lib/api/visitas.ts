import type { PaginatedMeta, TipoVinculoRegistro, Visita, VisitaRegistro } from '../../types/api';
import { lerVisitasHistoricoCache, salvarVisitasHistoricoCache } from '../db/visitasCache';
import { apiClient } from './client';
import { redeComPrazo } from '../redeComPrazo';
import { tamanhoDoArquivo, timeoutDeEnvio } from '../timeoutEnvio';

export interface CheckinPayload {
  ponto_venda_uuid: string;
  latitude: number;
  longitude: number;
  // Presente quando o check-in nasce de uma OrdemServico direcionada — ver
  // docs/07-ORDEM-DE-SERVICO.md.
  ordem_servico_uuid?: string;
  // O promotor escolheu esta OS (card da Agenda): a API vincula exatamente ela. Ausente = é só a
  // sugestão do app, e a API pode trocar uma OS fora do dia pela do dia (App\Support\OrdemDoCheckin).
  ordem_servico_escolhida?: boolean;
  // Visita fora da agenda autorizada pelo gestor (docs/74) — ver liberarVisita.
  liberacao_uuid?: string;
  // Idempotência — mesmo uuid local da visita na fila (`fila_visitas.id`), reenviado sem mudar
  // a cada nova tentativa da mesma visita. Se o app fechar entre o servidor confirmar e o
  // celular gravar a resposta, o reenvio com a MESMA chave devolve a visita já criada em vez de
  // duplicar — ver VisitaController::store e lib/filaEnvio.ts.
  idempotency_key?: string;
  // Hora do check-in no campo (ISO) — o servidor grava esta em vez da hora da chegada; sem ela
  // (ou com relógio absurdo) usa a da chegada. docs/51-ENVIO-DA-FILA-EM-TEMPO-REAL.md Fase 2.
  inicio_em?: string;
}

export async function iniciarVisita(payload: CheckinPayload): Promise<Visita> {
  const { data } = await apiClient.post<{ visita: Visita }>('/visitas', payload);
  return data.visita;
}

export interface LiberacaoVisita {
  id: string;
  expira_em: string;
  autorizada_por: { nome: string };
}

/**
 * Visita fora da agenda (ou fora da vez) autorizada por um gestor no aparelho do promotor (docs/74):
 * código de 6 dígitos gerado no admin, ou e-mail e senha dele. Precisa de sinal; o check-in depois
 * pode sair offline levando o `id` como `liberacao_uuid`.
 */
export async function liberarVisita(
  pontoVendaUuid: string,
  autorizacao: { codigo: string } | { email: string; senha: string },
): Promise<LiberacaoVisita> {
  const { data } = await apiClient.post<{ liberacao: LiberacaoVisita }>('/visitas/liberacoes', {
    ponto_venda_uuid: pontoVendaUuid,
    ...autorizacao,
  });
  return data.liberacao;
}

export async function buscarVisita(visitaId: string): Promise<Visita> {
  const { data } = await apiClient.get<{ visita: Visita }>(`/visitas/${visitaId}`);
  return data.visita;
}

// `fimEm` = hora em que o promotor finalizou no campo (docs/51 Fase 2).
export async function finalizarVisita(visitaId: string, latitude: number, longitude: number, fimEm?: string | null): Promise<Visita> {
  const { data } = await apiClient.patch<{ visita: Visita }>(`/visitas/${visitaId}/checkout`, {
    latitude,
    longitude,
    ...(fimEm ? { fim_em: fimEm } : {}),
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
  return redeComPrazo({
    rede: async () => (await apiClient.get<VisitasListResponse>('/visitas', { params: { usuario_uuid: 'eu' } })).data,
    salvar: (data) => salvarVisitasHistoricoCache(data.visitas),
    lerCache: async () => {
      const cache = await lerVisitasHistoricoCache();
      return {
        visitas: cache,
        meta: { current_page: 1, last_page: 1, per_page: cache.length, total: cache.length },
      };
    },
  });
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
  // Fotos que vão subir depois, uma por vez (`enviarImagemRegistro`) — contam pra foto obrigatória.
  imagensAEnviar?: number;
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
  // Hora em que o registro foi salvo no celular (ISO) — docs/51 Fase 2.
  criadoEm?: string;
  // Resposta a um "ainda está lá?" (docs/83): não abre acompanhamento novo.
  acompanhamentoUuid?: string;
  // Concorrentes por marca (docs/85): marca cadastrada offline (marcaUuid gerado no celular) e embalagem.
  marcaNovaDescricao?: string;
  embalagemQuantidade?: number;
  embalagemUnidade?: string;
}

export async function criarRegistro(payload: CriarRegistroPayload): Promise<VisitaRegistro> {
  const form = new FormData();
  form.append('idempotency_key', payload.idempotencyKey);
  form.append('tipo_registro_uuid', payload.tipoRegistroUuid);
  if (payload.imagensAEnviar) {
    form.append('imagens_a_enviar', String(payload.imagensAEnviar));
  }

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
  if (payload.criadoEm) {
    form.append('criado_em', payload.criadoEm);
  }
  if (payload.acompanhamentoUuid) {
    form.append('acompanhamento_uuid', payload.acompanhamentoUuid);
  }
  if (payload.marcaNovaDescricao) {
    form.append('marca_nova_descricao', payload.marcaNovaDescricao);
  }
  if (payload.embalagemQuantidade !== undefined && payload.embalagemUnidade) {
    form.append('embalagem_quantidade', String(payload.embalagemQuantidade));
    form.append('embalagem_unidade', payload.embalagemUnidade);
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
    // Proporcional ao que sobe (lib/timeoutEnvio.ts): os 8 s padrão do client são curtos pra rede
    // móvel lenta, e estourar aqui é lido como erro passageiro — o registro tentava de novo pra
    // sempre, travando o check-out atrás dele.
    { headers: { 'Content-Type': 'multipart/form-data' }, timeout: timeoutDeEnvio(await tamanhoTotal(payload.imagensUri ?? [])) },
  );
  return data.registro;
}

async function tamanhoTotal(uris: string[]): Promise<number> {
  const tamanhos = await Promise.all(uris.map(tamanhoDoArquivo));
  return tamanhos.reduce((soma, t) => soma + t, 0);
}

/**
 * Uma foto do registro, depois dele (rede lenta: o registro chega ao painel em segundos e cada
 * foto tem a própria retentativa). `idempotencyKey` estável por foto — reenviar depois de perder
 * a resposta não duplica. Ver VisitaRegistroController::adicionarImagem.
 */
export async function enviarImagemRegistro(
  visitaId: string,
  registroId: string,
  imagemUri: string,
  idempotencyKey: string,
): Promise<{ bytes: number }> {
  const nomeArquivo = imagemUri.split('/').pop() ?? 'foto.jpg';
  const extensao = /\.(\w+)$/.exec(nomeArquivo)?.[1]?.toLowerCase();
  const form = new FormData();
  form.append('idempotency_key', idempotencyKey);
  form.append('imagem', {
    uri: imagemUri,
    name: nomeArquivo,
    type: `image/${extensao === 'jpg' || !extensao ? 'jpeg' : extensao}`,
  } as unknown as Blob);

  const bytes = await tamanhoDoArquivo(imagemUri);
  await apiClient.post(`/visitas/${visitaId}/registros/${registroId}/imagens`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: timeoutDeEnvio(bytes),
  });
  return { bytes };
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
// Saída de segurança pra visita travada: um gestor/admin autoriza (auditado no servidor, com
// limite de tentativas). Dois jeitos — `codigo` gerado no admin web (o gestor nunca digita
// e-mail/senha no aparelho de outra pessoa, preferido) ou, por compatibilidade, e-mail+senha dele
// direto. Ver lib/useDescarteVisita.tsx e docs/15-INTERVENCAO-ADMINISTRATIVA-VISITA.md §12.
export async function cancelarVisitaAutorizado(
  visitaId: string,
  credencial: { codigo: string } | { email: string; senha: string },
): Promise<Visita> {
  const { data } = await apiClient.post<{ visita: Visita }>(`/visitas/${visitaId}/cancelar-autorizado`, credencial);
  return data.visita;
}

export async function cancelarVisita(visitaId: string): Promise<Visita> {
  const { data } = await apiClient.post<{ visita: Visita }>(`/visitas/${visitaId}/cancelar-propria`);
  return data.visita;
}

/** "Ainda está lá?" (docs/83 §5.2): resposta na visita, idempotente pela chave da fila. */
export async function responderAcompanhamento(
  visitaServidorId: string,
  acompanhamentoUuid: string,
  dados: { resposta: 'CONTINUA' | 'ACABOU' | 'NAO_CONSEGUI_VER'; idempotency_key: string; criado_em: string; registro_uuid?: string },
): Promise<void> {
  await apiClient.post(`/visitas/${visitaServidorId}/acompanhamentos/${acompanhamentoUuid}/respostas`, dados);
}
