import type { GranularidadeResposta, TipoRegistro } from '../types/api';

/**
 * Mesma resolução de App\Support\GranularidadeChecklist no backend: exceção por seção vence o
 * padrão do tipo; sem seção conhecida, só o padrão se aplica. `null` = sem regra (comportamento
 * livre). O backend continua sendo a autoridade final (StoreVisitaRegistroRequest) — isto aqui
 * só evita mandar o promotor por um caminho que já sabe que vai ser rejeitado.
 */
export function resolverGranularidade(tipo: TipoRegistro, secaoUuid: string | null): GranularidadeResposta | null {
  if (secaoUuid) {
    const excecao = tipo.excecoes_granularidade.find((e) => e.secao_uuid === secaoUuid);
    if (excecao) return excecao.granularidade;
  }
  return tipo.granularidade_padrao;
}
