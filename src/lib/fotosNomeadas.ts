import type { CampoTipoRegistro } from '../types/api';

// Fotos nomeadas no formulário e galeria Horus (docs/98). Lógica pura — o RegistroFormModal, a
// fila (lib/filaEnvio.ts) e os testes usam daqui.

/** De onde veio a foto: tirada agora, reaproveitada desta visita ou de uma visita anterior. */
export type OrigemFoto = 'CAMERA' | 'VISITA' | 'HISTORICO';

/** O que o app sabe de cada foto local além do arquivo (chaveado pelo caminho persistente). */
export interface FotoMeta {
  /** Pergunta FOTO que a foto responde; ausente = foto livre do registro. */
  campoChave?: string | null;
  origem?: OrigemFoto;
  /** Hora e posição da captura no aparelho (docs/98 §9.1). */
  capturadaEm?: string;
  latitude?: number;
  longitude?: number;
  precisao?: number;
  /**
   * Chave de idempotência da foto no servidor. Foto reaproveitada desta visita leva a chave da
   * original: o servidor devolve a mesma foto em vez de guardar outra cópia.
   */
  chave?: string;
}

/** Foto de visita anterior nesta loja, que já está no servidor — vira só vínculo. */
export interface FotoHistorico {
  uuid: string;
  campoChave: string;
  url: string;
  capturadaEm?: string | null;
}

/** Foto que já existe nesta visita, oferecida em "Usar foto já tirada". */
export interface FotoDaVisita {
  uri: string;
  chave: string;
  meta: FotoMeta;
  /** Formulário em que ela foi tirada (rótulo pro promotor). */
  origemDescricao: string;
}

export function ehFoto(campo: Pick<CampoTipoRegistro, 'tipo_campo'>): boolean {
  return campo.tipo_campo === 'FOTO';
}

/** Chave da foto no servidor: a guardada na foto (reaproveitada) ou id do registro + posição. */
export function chaveDaFoto(registroId: string, indice: number, meta: FotoMeta | undefined): string {
  return meta?.chave ?? `${registroId}:${indice}`;
}

/**
 * Quantas fotos o app manda pra cada pergunta FOTO (`imagens_por_campo` do servidor): todas as
 * perguntas FOTO visíveis, inclusive com 0, pra o servidor cobrar a obrigatória. As de visita
 * anterior não entram aqui (vão em `imagens_historico`).
 */
export function contagemPorCampo(
  camposFoto: Pick<CampoTipoRegistro, 'chave'>[],
  imagensUri: string[],
  fotosMeta: Record<string, FotoMeta>,
): Record<string, number> {
  const contagem: Record<string, number> = Object.fromEntries(camposFoto.map((c) => [c.chave, 0]));
  for (const uri of imagensUri) {
    const chave = fotosMeta[uri]?.campoChave;
    if (chave && chave in contagem) contagem[chave] += 1;
  }
  return contagem;
}

/** Mesma regra do servidor (StoreVisitaRegistroRequest::validarFotos). null = tudo certo. */
export function erroDasFotos(
  camposFoto: Pick<CampoTipoRegistro, 'chave' | 'rotulo' | 'obrigatorio' | 'foto_min' | 'foto_max'>[],
  total: (chave: string) => number,
): string | null {
  for (const campo of camposFoto) {
    const n = total(campo.chave);
    const minimo = campo.foto_min ?? 0;
    if (n === 0) {
      if (campo.obrigatorio) return `Faça o registro fotográfico "${campo.rotulo}".`;
      continue;
    }
    if (n < minimo) return `"${campo.rotulo}" pede pelo menos ${minimo} fotos.`;
    if (campo.foto_max && n > campo.foto_max) return `"${campo.rotulo}" aceita no máximo ${campo.foto_max} ${campo.foto_max === 1 ? 'foto' : 'fotos'}.`;
  }
  return null;
}

/** Ainda cabe foto nesta pergunta? */
export function cabeMaisFoto(campo: Pick<CampoTipoRegistro, 'foto_max'>, atual: number): boolean {
  return !campo.foto_max || atual < campo.foto_max;
}

/**
 * Fotos desta visita que podem ser reaproveitadas: todas as dos registros já salvos no aparelho,
 * sem repetir a mesma foto (mesma chave) e sem as já escolhidas neste formulário.
 */
export function fotosDaVisita(
  registros: { id: string; imagensLocais: string[]; fotosMeta?: Record<string, FotoMeta> | null; descricao: string }[],
  jaUsadas: string[] = [],
): FotoDaVisita[] {
  const vistas = new Set(jaUsadas);
  const lista: FotoDaVisita[] = [];
  for (const r of registros) {
    r.imagensLocais.forEach((uri, indice) => {
      const meta = r.fotosMeta?.[uri] ?? {};
      const chave = chaveDaFoto(r.id, indice, meta);
      if (vistas.has(chave)) return;
      vistas.add(chave);
      lista.push({ uri, chave, meta, origemDescricao: r.descricao });
    });
  }
  // Mais recentes primeiro (sem hora de captura, mantém a ordem dos registros).
  return lista.reverse();
}

/** "Tirada às 09:12" / "21/10 às 09:12" — rodapé da miniatura. */
export function legendaCaptura(iso: string | null | undefined, agora = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const mesmoDia = d.toDateString() === agora.toDateString();
  return mesmoDia ? `Hoje às ${hora}` : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${hora}`;
}
