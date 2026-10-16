// Embalagem do registro por marca concorrente (docs/85): quantidade + unidade, nunca texto livre —
// é o que permite comparar R$ por litro/kg entre marcas. Mesma lista da API (App\Enums\UnidadeEmbalagem).

export type UnidadeEmbalagem = 'ML' | 'L' | 'G' | 'KG' | 'UN';

export const UNIDADES_EMBALAGEM: { valor: UnidadeEmbalagem; rotulo: string }[] = [
  { valor: 'ML', rotulo: 'ml' },
  { valor: 'L', rotulo: 'L' },
  { valor: 'G', rotulo: 'g' },
  { valor: 'KG', rotulo: 'kg' },
  { valor: 'UN', rotulo: 'un' },
];

/** "1,5" ou "500" digitado → número; null se não for um número > 0. */
export function quantidadeDigitada(texto: string): number | null {
  const n = Number(texto.trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "500 ml", "1,5 L" — null sem quantidade ou unidade. */
export function descreverEmbalagem(quantidade: number | null | undefined, unidade: string | null | undefined): string | null {
  const u = UNIDADES_EMBALAGEM.find((x) => x.valor === unidade);
  if (!u || !quantidade) return null;
  return `${quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${u.rotulo}`;
}

/** R$ por litro/kg (só exibição, nunca gravado); null pra unidade avulsa, sem preço ou sem embalagem. */
export function precoPorReferencia(
  preco: number | null,
  quantidade: number | null,
  unidade: UnidadeEmbalagem | null,
): { valor: number; referencia: 'L' | 'kg' } | null {
  if (preco === null || !quantidade || !unidade || unidade === 'UN') return null;
  const emReferencia = unidade === 'ML' || unidade === 'G' ? quantidade / 1000 : quantidade;
  return { valor: Math.round((preco / emReferencia) * 100) / 100, referencia: unidade === 'ML' || unidade === 'L' ? 'L' : 'kg' };
}
