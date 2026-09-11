import type { TipoRegistro } from '../types/api';

export function chaveGrade(tipoUuid: string, produtoUuid: string): string {
  return `${tipoUuid}:${produtoUuid}`;
}

export interface RemocaoPorRuptura {
  produtoDescricao: string;
  tipoDescricao: string;
}

export interface ResolucaoGrade {
  marcadosFinais: Set<string>;
  removidosPorRuptura: RemocaoPorRuptura[];
}

/**
 * Aplica a regra fixa da Decisão 2 (docs/16-GRANULARIDADE-CHECKLIST-AUDITORIA.md §5): produto
 * marcado em ruptura sai de todas as outras colunas da mesma linha, sempre, sem exceção — mesmo
 * que o promotor tenha marcado outras respostas pra ele antes de marcar ruptura depois. Retorna
 * também o que foi removido por essa regra, pra avisar o promotor antes de salvar (ver
 * GradeColetaScreen.confirmarSalvar) em vez de descartar silenciosamente sem aviso.
 */
export function resolverGrade(
  marcados: Set<string>,
  colunas: TipoRegistro[],
  produtos: { uuid: string; descricao: string }[],
  colunaRuptura: TipoRegistro | null,
): ResolucaoGrade {
  const marcadosFinais = new Set(marcados);
  const removidosPorRuptura: RemocaoPorRuptura[] = [];

  if (colunaRuptura) {
    for (const produto of produtos) {
      if (!marcadosFinais.has(chaveGrade(colunaRuptura.id, produto.uuid))) continue;

      for (const coluna of colunas) {
        if (coluna.eh_ruptura) continue;
        const k = chaveGrade(coluna.id, produto.uuid);
        if (marcadosFinais.delete(k)) {
          removidosPorRuptura.push({ produtoDescricao: produto.descricao, tipoDescricao: coluna.descricao });
        }
      }
    }
  }

  return { marcadosFinais, removidosPorRuptura };
}

/** Quantos produtos já têm ao menos uma resposta marcada em alguma coluna — pra indicador de progresso. */
export function contarProdutosRespondidos(
  marcados: Set<string>,
  colunas: TipoRegistro[],
  produtos: { uuid: string; descricao: string }[],
): number {
  return produtos.filter((p) => colunas.some((c) => marcados.has(chaveGrade(c.id, p.uuid)))).length;
}
