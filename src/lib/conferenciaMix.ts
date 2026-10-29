// Checklist no formato "conferir item a item" (docs/100): nada vem marcado; em cada produto o
// promotor toca Tem ou Não tem. O valor gravado é o mesmo de sempre ({ presentes, ausentes }), só
// que um produto pode estar pendente (em nenhuma das duas listas).

export interface EstadoConferencia {
  presentes: string[];
  ausentes: string[];
  fora_do_mix?: string[];
}

export type Situacao = 'TEM' | 'NAO_TEM' | 'PENDENTE';
export type FiltroConferencia = 'PENDENTES' | 'EM_FALTA' | 'TODOS';

export function situacao(estado: EstadoConferencia, uuid: string): Situacao {
  if (estado.presentes.includes(uuid)) return 'TEM';
  if (estado.ausentes.includes(uuid)) return 'NAO_TEM';
  return 'PENDENTE';
}

/** Responde um produto; tocar de novo na mesma resposta desfaz (volta a pendente). */
export function responder(estado: EstadoConferencia, uuid: string, tem: boolean): EstadoConferencia {
  const atual = situacao(estado, uuid);
  const semEle = { ...estado, presentes: estado.presentes.filter((u) => u !== uuid), ausentes: estado.ausentes.filter((u) => u !== uuid) };
  if ((tem && atual === 'TEM') || (!tem && atual === 'NAO_TEM')) return semEle;
  return tem ? { ...semEle, presentes: [...semEle.presentes, uuid] } : { ...semEle, ausentes: [...semEle.ausentes, uuid] };
}

export function contagem(produtos: string[], estado: EstadoConferencia): { conferidos: number; pendentes: number; emFalta: number } {
  let conferidos = 0;
  let emFalta = 0;
  for (const uuid of produtos) {
    const s = situacao(estado, uuid);
    if (s !== 'PENDENTE') conferidos += 1;
    if (s === 'NAO_TEM') emFalta += 1;
  }
  return { conferidos, pendentes: produtos.length - conferidos, emFalta };
}

/** "Marcar os restantes como Tem": acelera o fim sem mexer no que já foi respondido. */
export function marcarRestantesComoTem(produtos: string[], estado: EstadoConferencia): EstadoConferencia {
  const pendentes = produtos.filter((u) => situacao(estado, u) === 'PENDENTE');
  return { ...estado, presentes: [...estado.presentes, ...pendentes] };
}

export function filtrar<T extends { produto_uuid: string }>(produtos: T[], estado: EstadoConferencia, filtro: FiltroConferencia): T[] {
  if (filtro === 'TODOS') return produtos;
  const alvo: Situacao = filtro === 'PENDENTES' ? 'PENDENTE' : 'NAO_TEM';
  return produtos.filter((p) => situacao(estado, p.produto_uuid) === alvo);
}
