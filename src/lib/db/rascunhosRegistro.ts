import { apagarImagemPersistente } from './filaRegistros';
import { escrever, getDatabase } from './database';
import type { FotoHistorico, FotoMeta } from '../fotosNomeadas';
import type { RecorteEscolhido } from '../recorteEscolhido';
import type { TipoVinculoRegistro } from '../../types/api';

// Rascunho de um formulário comum (um registro): o promotor começa, sai pra arrumar a gôndola e
// volta pra terminar (ex.: planograma por seção — o "Antes" agora, o "Depois" depois). Gravado no
// SQLite a cada resposta ou foto, então sobrevive a fechar a janela, o app cair ou a bateria
// acabar. Só vira registro (fila de envio) no "Salvar". Fica só no aparelho e pertence à visita.
// A coleta guiada tem o próprio rascunho (rascunhosColeta.ts). Ver docs/99.

export interface DadosRascunhoRegistro {
  // Como estão no formulário (MOEDA ainda mascarado) — normaliza só no envio.
  valoresCampos: Record<string, string>;
  // Cópias persistentes das fotos (mesmo esquema da fila de registros).
  imagensUri: string[];
  fotosMeta: Record<string, FotoMeta>;
  fotosHistorico: FotoHistorico[];
  ruptura: boolean;
  vinculo: { categoria: Extract<TipoVinculoRegistro, 'PRODUTO' | 'SECAO' | 'DEPARTAMENTO' | 'MARCA'>; uuid: string; label: string } | null;
  recorte: RecorteEscolhido | null;
  // Produto que já veio como contexto ao abrir (toque num item do Mix).
  produtoContexto: { uuid: string; descricao: string } | null;
}

export interface RascunhoRegistro {
  id: string;
  visitaLocalId: string;
  tipoRegistroUuid: string;
  // "Planograma · Limpeza" — o que aparece no card "Em andamento".
  descricao: string;
  // Formulário + recorte/produto: abrir o mesmo de novo retoma este rascunho em vez de criar outro.
  chave: string;
  dados: DadosRascunhoRegistro;
  atualizadoEm: string;
}

interface Linha {
  id: string;
  visita_local_id: string;
  tipo_registro_uuid: string;
  descricao: string;
  chave: string;
  dados_json: string;
  atualizado_em: string;
}

function paraRascunho(l: Linha): RascunhoRegistro | null {
  try {
    return {
      id: l.id,
      visitaLocalId: l.visita_local_id,
      tipoRegistroUuid: l.tipo_registro_uuid,
      descricao: l.descricao,
      chave: l.chave,
      dados: JSON.parse(l.dados_json) as DadosRascunhoRegistro,
      atualizadoEm: l.atualizado_em,
    };
  } catch {
    return null; // JSON corrompido — some da lista.
  }
}

export async function listarRascunhosRegistro(visitaLocalId: string): Promise<RascunhoRegistro[]> {
  const db = await getDatabase();
  const linhas = await db.getAllAsync<Linha>(
    'SELECT * FROM rascunhos_registro WHERE visita_local_id = ? ORDER BY atualizado_em DESC',
    [visitaLocalId],
  );
  return linhas.map(paraRascunho).filter((r): r is RascunhoRegistro => r !== null);
}

export async function salvarRascunhoRegistro(r: Omit<RascunhoRegistro, 'atualizadoEm'>): Promise<void> {
  await escrever(
    `INSERT INTO rascunhos_registro (id, visita_local_id, tipo_registro_uuid, descricao, chave, dados_json, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET tipo_registro_uuid = excluded.tipo_registro_uuid, descricao = excluded.descricao,
       chave = excluded.chave, dados_json = excluded.dados_json, atualizado_em = excluded.atualizado_em`,
    [r.id, r.visitaLocalId, r.tipoRegistroUuid, r.descricao, r.chave, JSON.stringify(r.dados), new Date().toISOString()],
  );
}

/** Virou registro (ou ficou vazio): some a linha, as fotos ficam. */
export async function concluirRascunhoRegistro(id: string): Promise<void> {
  await escrever('DELETE FROM rascunhos_registro WHERE id = ?', [id]);
}

/** Descartado pelo promotor: some a linha e as fotos (ninguém mais aponta pra elas). */
export async function descartarRascunhoRegistro(r: RascunhoRegistro): Promise<void> {
  for (const uri of r.dados.imagensUri) void apagarImagemPersistente(uri);
  await concluirRascunhoRegistro(r.id);
}

/** Visita finalizada, cancelada ou excluída do aparelho: some todo rascunho dela, com as fotos. */
export async function apagarRascunhosRegistroDaVisita(visitaLocalId: string): Promise<void> {
  for (const r of await listarRascunhosRegistro(visitaLocalId)) await descartarRascunhoRegistro(r);
}
