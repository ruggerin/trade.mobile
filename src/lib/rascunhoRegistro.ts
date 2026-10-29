import type { CampoTipoRegistro } from '../types/api';
import type { DadosRascunhoRegistro } from './db/rascunhosRegistro';

// Lógica pura do rascunho de formulário (lib/db/rascunhosRegistro.ts, docs/99): se vale guardar,
// qual a chave (formulário + recorte/produto) e o resumo do card "Em andamento".

/** Tem algo pra não perder? Formulário aberto e intocado não vira rascunho. */
export function temConteudo(d: Pick<DadosRascunhoRegistro, 'valoresCampos' | 'imagensUri' | 'fotosHistorico' | 'ruptura'>): boolean {
  return (
    d.ruptura ||
    d.imagensUri.length > 0 ||
    d.fotosHistorico.length > 0 ||
    Object.values(d.valoresCampos).some((v) => v !== undefined && v.trim() !== '')
  );
}

/** Um rascunho por formulário + recorte (ou produto): "Planograma · Limpeza" e "· Bebidas" convivem. */
export function chaveRascunho(
  tipoRegistroUuid: string,
  d: Pick<DadosRascunhoRegistro, 'recorte' | 'produtoContexto' | 'vinculo'>,
): string {
  const alvo = d.recorte
    ? `${d.recorte.tipo}:${d.recorte.uuid}:${d.recorte.marca?.uuid ?? ''}`
    : d.produtoContexto
      ? `PRODUTO:${d.produtoContexto.uuid}`
      : d.vinculo
        ? `${d.vinculo.categoria}:${d.vinculo.uuid}`
        : '';
  return `${tipoRegistroUuid}|${alvo}`;
}

/** "Planograma · Limpeza" — formulário e, se houver, onde é o registro. */
export function descricaoRascunho(tipoDescricao: string, d: Pick<DadosRascunhoRegistro, 'recorte' | 'produtoContexto' | 'vinculo'>): string {
  const alvo = d.recorte
    ? [d.recorte.descricao, d.recorte.marca?.descricao].filter(Boolean).join(' · ')
    : (d.produtoContexto?.descricao ?? d.vinculo?.label ?? '');
  return alvo ? `${tipoDescricao} · ${alvo}` : tipoDescricao;
}

/**
 * "2 de 4 respondidas · falta Depois" — perguntas visíveis respondidas (FOTO conta com foto) e a
 * primeira pergunta de foto obrigatória ainda sem foto, que é o que o promotor costuma ter
 * deixado pra depois.
 */
export function resumoRascunho(
  campos: Pick<CampoTipoRegistro, 'chave' | 'rotulo' | 'tipo_campo' | 'obrigatorio' | 'depende_de_chave' | 'depende_de_valor'>[],
  d: Pick<DadosRascunhoRegistro, 'valoresCampos' | 'imagensUri' | 'fotosMeta' | 'fotosHistorico'>,
): string {
  const visiveis = campos.filter((c) => !c.depende_de_chave || d.valoresCampos[c.depende_de_chave] === c.depende_de_valor);
  const fotosDe = (chave: string) =>
    d.imagensUri.filter((u) => d.fotosMeta[u]?.campoChave === chave).length + d.fotosHistorico.filter((f) => f.campoChave === chave).length;
  const respondida = (c: (typeof visiveis)[number]) =>
    c.tipo_campo === 'FOTO' ? fotosDe(c.chave) > 0 : (d.valoresCampos[c.chave] ?? '').trim() !== '';

  const partes: string[] = [];
  if (visiveis.length > 0) partes.push(`${visiveis.filter(respondida).length} de ${visiveis.length} respondidas`);
  const fotoPendente = visiveis.find((c) => c.tipo_campo === 'FOTO' && c.obrigatorio && !respondida(c));
  if (fotoPendente) partes.push(`falta ${fotoPendente.rotulo}`);
  else if (visiveis.length === 0 && d.imagensUri.length > 0) partes.push(`${d.imagensUri.length} ${d.imagensUri.length === 1 ? 'foto' : 'fotos'}`);
  return partes.join(' · ');
}
