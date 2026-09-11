// SDK 57 trocou expo-file-system pra uma API baseada em classes (Paths/File/Directory) — o
// submódulo /legacy mantém a API antiga (documentDirectory/copyAsync/deleteAsync), oficialmente
// suportada, mais simples pro que a gente precisa aqui (copiar/apagar por caminho string).
import * as FileSystem from 'expo-file-system/legacy';
import type { MomentoRegistro, TipoVinculoRegistro } from '../../types/api';
import { gerarUuidLocal } from '../uuid';
import { getDatabase } from './database';

/**
 * PENDENTE   ainda não foi tentado enviar, ou tentou e caiu por falta de rede.
 * ENVIADO    servidor confirmou — mesma lógica de fila_visitas: fica visível só até a visita
 *            inteira ser apagada em `excluirVisitaLocalCompleta`, não existe estado terminal
 *            "guardado pra sempre" aqui.
 * ERRO       servidor recusou este registro específico (ex.: validação) — não trava os outros
 *            registros da mesma visita, cada um segue independente.
 * DESCARTADO a visita-mãe foi REJEITADA (check-in recusado) — nunca vai ter pra onde enviar.
 */
export type StatusRegistroLocal = 'PENDENTE' | 'ENVIADO' | 'ERRO' | 'DESCARTADO';

export interface RegistroLocal {
  id: string;
  visitaLocalId: string;
  /** Uuid do registro no servidor — só preenchido depois que ENVIADO é confirmado. */
  servidorId: string | null;
  status: StatusRegistroLocal;
  tipoRegistroUuid: string;
  produtoAuditoriaUuid: string | null;
  produtoDescricao: string | null;
  tipoVinculo: TipoVinculoRegistro | null;
  secaoUuid: string | null;
  departamentoUuid: string | null;
  marcaUuid: string | null;
  /** Nome legível de secao/departamento/marca escolhido em "Vincular a" — ver RegistroFormModal.vinculoLabel. */
  vinculoDescricao: string | null;
  valoresCampos: Record<string, string> | null;
  ruptura: boolean | null;
  observacao: string | null;
  momento: MomentoRegistro | null;
  imagemLocalPath: string | null;
  erro: string | null;
  criadoEm: string;
  atualizadoEm: string;
}

interface LinhaFilaRegistro {
  id: string;
  visita_local_id: string;
  servidor_id: string | null;
  status: string;
  tipo_registro_uuid: string;
  produto_auditoria_uuid: string | null;
  produto_descricao: string | null;
  tipo_vinculo: string | null;
  secao_uuid: string | null;
  departamento_uuid: string | null;
  marca_uuid: string | null;
  vinculo_descricao: string | null;
  valores_campos_json: string | null;
  ruptura: number | null;
  observacao: string | null;
  momento: string | null;
  imagem_local_path: string | null;
  erro: string | null;
  criado_em: string;
  atualizado_em: string;
}

function paraRegistroLocal(linha: LinhaFilaRegistro): RegistroLocal {
  return {
    id: linha.id,
    visitaLocalId: linha.visita_local_id,
    servidorId: linha.servidor_id,
    status: linha.status as StatusRegistroLocal,
    tipoRegistroUuid: linha.tipo_registro_uuid,
    produtoAuditoriaUuid: linha.produto_auditoria_uuid,
    produtoDescricao: linha.produto_descricao,
    tipoVinculo: linha.tipo_vinculo as TipoVinculoRegistro | null,
    secaoUuid: linha.secao_uuid,
    departamentoUuid: linha.departamento_uuid,
    marcaUuid: linha.marca_uuid,
    vinculoDescricao: linha.vinculo_descricao,
    valoresCampos: linha.valores_campos_json ? (JSON.parse(linha.valores_campos_json) as Record<string, string>) : null,
    ruptura: linha.ruptura === null ? null : Boolean(linha.ruptura),
    observacao: linha.observacao,
    momento: linha.momento as MomentoRegistro | null,
    imagemLocalPath: linha.imagem_local_path,
    erro: linha.erro,
    criadoEm: linha.criado_em,
    atualizadoEm: linha.atualizado_em,
  };
}

export interface NovoRegistroLocal {
  visitaLocalId: string;
  tipoRegistroUuid: string;
  produtoAuditoriaUuid?: string | null;
  produtoDescricao?: string | null;
  tipoVinculo?: TipoVinculoRegistro | null;
  secaoUuid?: string | null;
  departamentoUuid?: string | null;
  marcaUuid?: string | null;
  vinculoDescricao?: string | null;
  valoresCampos?: Record<string, string> | null;
  ruptura?: boolean | null;
  observacao?: string | null;
  momento?: MomentoRegistro | null;
  /** Caminho já persistente (copiado pro FileSystem.documentDirectory) — nunca a uri transitória do image picker. */
  imagemLocalPath?: string | null;
}

export async function criarRegistroLocal(dados: NovoRegistroLocal): Promise<RegistroLocal> {
  const db = await getDatabase();
  const agora = new Date().toISOString();
  const id = gerarUuidLocal();

  await db.runAsync(
    `INSERT INTO fila_registros (
      id, visita_local_id, status, tipo_registro_uuid, produto_auditoria_uuid, produto_descricao,
      tipo_vinculo, secao_uuid, departamento_uuid, marca_uuid, vinculo_descricao,
      valores_campos_json, ruptura, observacao, momento, imagem_local_path, erro, criado_em,
      atualizado_em
    ) VALUES (?, ?, 'PENDENTE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    [
      id,
      dados.visitaLocalId,
      dados.tipoRegistroUuid,
      dados.produtoAuditoriaUuid ?? null,
      dados.produtoDescricao ?? null,
      dados.tipoVinculo ?? null,
      dados.secaoUuid ?? null,
      dados.departamentoUuid ?? null,
      dados.marcaUuid ?? null,
      dados.vinculoDescricao ?? null,
      dados.valoresCampos ? JSON.stringify(dados.valoresCampos) : null,
      dados.ruptura === undefined || dados.ruptura === null ? null : dados.ruptura ? 1 : 0,
      dados.observacao ?? null,
      dados.momento ?? null,
      dados.imagemLocalPath ?? null,
      agora,
      agora,
    ],
  );

  const linha = await db.getFirstAsync<LinhaFilaRegistro>('SELECT * FROM fila_registros WHERE id = ?', [id]);
  return paraRegistroLocal(linha!);
}

export async function listarRegistrosLocais(visitaLocalId: string): Promise<RegistroLocal[]> {
  const db = await getDatabase();
  const linhas = await db.getAllAsync<LinhaFilaRegistro>(
    'SELECT * FROM fila_registros WHERE visita_local_id = ? ORDER BY criado_em ASC',
    [visitaLocalId],
  );
  return linhas.map(paraRegistroLocal);
}

export async function marcarRegistroEnviado(id: string, servidorId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE fila_registros SET status = 'ENVIADO', servidor_id = ?, erro = NULL, atualizado_em = ? WHERE id = ?`,
    [servidorId, new Date().toISOString(), id],
  );
}

export async function marcarRegistroComErro(id: string, erro: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE fila_registros SET status = 'ERRO', erro = ?, atualizado_em = ? WHERE id = ?`, [
    erro,
    new Date().toISOString(),
    id,
  ]);
}

/** Visita-mãe foi REJEITADA — nenhum registro dela tem mais pra onde ir. */
export async function descartarRegistrosDaVisita(visitaLocalId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE fila_registros SET status = 'DESCARTADO', atualizado_em = ? WHERE visita_local_id = ? AND status = 'PENDENTE'`,
    [new Date().toISOString(), visitaLocalId],
  );
}

export async function excluirRegistrosDaVisita(visitaLocalId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM fila_registros WHERE visita_local_id = ?', [visitaLocalId]);
}

/**
 * Cancelamento de UM registro local (ver lib/visitaLocal.ts::cancelarRegistroVisitaLocal) —
 * diferente de excluirRegistrosDaVisita (apaga tudo da visita), aqui é só a linha cancelada.
 * Hard delete de verdade: se ainda não sincronizou (PENDENTE), o servidor nunca chegou a saber
 * desse registro, não tem rastro pra manter. Se já sincronizou, quem guarda o rastro histórico
 * é o servidor (`cancelado_em`, soft) — a cópia local perdeu utilidade, mesmo raciocínio de
 * excluirVisitaLocalCompleta.
 */
export async function excluirRegistroLocal(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM fila_registros WHERE id = ?', [id]);
}

/**
 * Copia o arquivo temporário do image picker pra um diretório persistente do app — a uri que o
 * picker devolve vive no cache do SO, que pode ser limpo a qualquer momento (mais ainda num
 * cenário de horas/dia inteiro offline, o próprio ponto de existir a fila). Sem isso, a fila
 * teria a referência mas o arquivo já não existiria mais na hora de enviar.
 */
export async function copiarImagemParaArmazenamentoPersistente(uriTemporaria: string): Promise<string> {
  // Só é null em ambientes sem filesystem nativo de verdade (web) — este app nunca roda lá.
  if (!FileSystem.documentDirectory) {
    throw new Error('Diretório de documentos indisponível neste ambiente.');
  }

  const pasta = `${FileSystem.documentDirectory}fila-envio/`;
  await FileSystem.makeDirectoryAsync(pasta, { intermediates: true }).catch(() => {});

  const nomeArquivo = uriTemporaria.split('/').pop() ?? `${gerarUuidLocal()}.jpg`;
  const destino = `${pasta}${gerarUuidLocal()}-${nomeArquivo}`;
  await FileSystem.copyAsync({ from: uriTemporaria, to: destino });
  return destino;
}

/**
 * Apaga uma foto já copiada pro armazenamento persistente que acabou não sendo usada — o
 * promotor tocou "Remover foto" no formulário, ou fechou o modal sem salvar o registro. Sem
 * isso, a cópia (feita logo na captura, ver RegistroFormModal.capturarFoto) ficava no disco pra
 * sempre, sem nenhuma linha de fila_registros referenciando ela.
 */
export async function apagarImagemPersistente(caminho: string): Promise<void> {
  await FileSystem.deleteAsync(caminho, { idempotent: true }).catch(() => {});
}
