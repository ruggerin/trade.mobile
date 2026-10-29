import { contagem, filtrar, marcarRestantesComoTem, responder, situacao } from './conferenciaMix';

// docs/100 — conferir item a item (Tem / Não tem).
const vazio = { presentes: [], ausentes: [] };

describe('conferência item a item', () => {
  it('nada vem marcado; Tem e Não tem trocam; tocar de novo desfaz', () => {
    expect(situacao(vazio, 'a')).toBe('PENDENTE');
    let e = responder(vazio, 'a', true);
    expect(situacao(e, 'a')).toBe('TEM');
    e = responder(e, 'a', false);
    expect(e).toEqual({ presentes: [], ausentes: ['a'] });
    e = responder(e, 'a', false);
    expect(situacao(e, 'a')).toBe('PENDENTE');
  });

  it('conta conferidos, pendentes e em falta', () => {
    const e = { presentes: ['a'], ausentes: ['b', 'c'] };
    expect(contagem(['a', 'b', 'c', 'd', 'e'], e)).toEqual({ conferidos: 3, pendentes: 2, emFalta: 2 });
  });

  it('marcar os restantes como Tem não mexe no que já foi respondido', () => {
    const e = marcarRestantesComoTem(['a', 'b', 'c'], { presentes: [], ausentes: ['b'] });
    expect(e).toEqual({ presentes: ['a', 'c'], ausentes: ['b'] });
  });

  it('filtra pendentes e em falta mantendo a ordem', () => {
    const produtos = ['a', 'b', 'c', 'd'].map((produto_uuid) => ({ produto_uuid }));
    const e = { presentes: ['a'], ausentes: ['c'] };
    expect(filtrar(produtos, e, 'PENDENTES').map((p) => p.produto_uuid)).toEqual(['b', 'd']);
    expect(filtrar(produtos, e, 'EM_FALTA').map((p) => p.produto_uuid)).toEqual(['c']);
    expect(filtrar(produtos, e, 'TODOS')).toHaveLength(4);
  });
});
