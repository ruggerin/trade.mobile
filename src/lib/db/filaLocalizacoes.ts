import { escrever, getDatabase } from './database';

// Posições lidas pelo GPS e ainda não confirmadas pelo servidor (docs/101). A tarefa de
// rastreamento grava aqui ANTES de tentar enviar; sem internet, a fila cresce e sobe em lote
// quando o sinal volta (lib/filaLocalizacao.ts). As mudanças de situação do rastreamento (docs/94)
// usam a mesma descarga, numa tabela ao lado.

export interface BateriaLida {
  nivel: number | null;
  carregando: boolean | null;
  economia: boolean | null;
}

export interface PosicaoNaFila {
  id: number;
  latitude: number;
  longitude: number;
  capturadoEm: string;
  simulada: boolean;
  bateria: BateriaLida | null;
}

export interface SituacaoNaFila {
  id: number;
  situacao: string;
  detalhe: string | null;
  ocorridoEm: string;
}

interface Linha {
  id: number;
  latitude: number;
  longitude: number;
  capturado_em: string;
  simulada: number;
  bateria_nivel: number | null;
  bateria_carregando: number | null;
  bateria_economia: number | null;
}

const paraInt = (v: boolean | null | undefined) => (v === null || v === undefined ? null : v ? 1 : 0);
const paraBool = (v: number | null) => (v === null ? null : v === 1);

export async function enfileirarPosicoes(posicoes: Omit<PosicaoNaFila, 'id'>[]): Promise<void> {
  for (const p of posicoes) {
    await escrever(
      `INSERT INTO fila_localizacoes (latitude, longitude, capturado_em, simulada, bateria_nivel, bateria_carregando, bateria_economia)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [p.latitude, p.longitude, p.capturadoEm, p.simulada ? 1 : 0, p.bateria?.nivel ?? null, paraInt(p.bateria?.carregando), paraInt(p.bateria?.economia)],
    );
  }
}

/** As mais antigas primeiro — o trajeto chega em ordem. */
export async function lerLotePosicoes(limite: number): Promise<PosicaoNaFila[]> {
  const db = await getDatabase();
  const linhas = await db.getAllAsync<Linha>('SELECT * FROM fila_localizacoes ORDER BY capturado_em, id LIMIT ?', [limite]);
  return linhas.map((l) => ({
    id: l.id,
    latitude: l.latitude,
    longitude: l.longitude,
    capturadoEm: l.capturado_em,
    simulada: l.simulada === 1,
    bateria:
      l.bateria_nivel === null && l.bateria_carregando === null && l.bateria_economia === null
        ? null
        : { nivel: l.bateria_nivel, carregando: paraBool(l.bateria_carregando), economia: paraBool(l.bateria_economia) },
  }));
}

export async function apagarPosicoes(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await escrever(`DELETE FROM fila_localizacoes WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
}

/** Teto da fila: leituras mais velhas que o limite já não ajudam ninguém e só ocupam espaço. */
export async function podarPosicoesAntesDe(isoLimite: string): Promise<void> {
  await escrever('DELETE FROM fila_localizacoes WHERE capturado_em < ?', [isoLimite]);
  await escrever('DELETE FROM fila_situacoes_rastreamento WHERE ocorrido_em < ?', [isoLimite]);
}

export async function limparFilaPosicoes(): Promise<void> {
  await escrever('DELETE FROM fila_localizacoes');
  await escrever('DELETE FROM fila_situacoes_rastreamento');
}

export async function enfileirarSituacao(s: Omit<SituacaoNaFila, 'id'>): Promise<void> {
  await escrever('INSERT INTO fila_situacoes_rastreamento (situacao, detalhe, ocorrido_em) VALUES (?, ?, ?)', [s.situacao, s.detalhe, s.ocorridoEm]);
}

export async function lerSituacoes(): Promise<SituacaoNaFila[]> {
  const db = await getDatabase();
  const linhas = await db.getAllAsync<{ id: number; situacao: string; detalhe: string | null; ocorrido_em: string }>(
    'SELECT * FROM fila_situacoes_rastreamento ORDER BY ocorrido_em, id',
  );
  return linhas.map((l) => ({ id: l.id, situacao: l.situacao, detalhe: l.detalhe, ocorridoEm: l.ocorrido_em }));
}

export async function apagarSituacao(id: number): Promise<void> {
  await escrever('DELETE FROM fila_situacoes_rastreamento WHERE id = ?', [id]);
}
