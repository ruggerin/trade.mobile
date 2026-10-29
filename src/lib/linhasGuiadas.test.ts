import { linhasDoFormulario, linhasFeitas } from './linhasGuiadas';
import type { SortimentoPontoVenda } from '../types/api';

// docs/100 — "Cada seção / linha" como lista guiada.
const catalogo = [
  { id: 's-limpeza', descricao: 'Limpeza' },
  { id: 's-bebidas', descricao: 'Bebidas' },
  { id: 's-higiene', descricao: 'Higiene' },
];
const item = (secao: string, pendente = false) =>
  ({
    id: secao,
    tipo_item: 'PRODUTO',
    produto: { id: `p-${secao}`, descricao: 'x', secao_uuid: secao, departamento_uuid: 'd1' },
    status_aprovacao: pendente ? 'PENDENTE' : null,
  }) as unknown as SortimentoPontoVenda;

describe('linhasDoFormulario', () => {
  it('sem nível = sem lista guiada', () => {
    expect(linhasDoFormulario({ linha_nivel: null }, catalogo, [])).toBeNull();
  });

  it('lista fixa vem pronta, na ordem do cadastro', () => {
    expect(
      linhasDoFormulario(
        { linha_nivel: 'SECAO', linha_origem: 'FIXA', linhas_fixas: [{ id: 'b', descricao: 'Bebidas' }, { id: 'a', descricao: 'Limpeza' }] },
        [],
        [],
      ),
    ).toEqual([
      { uuid: 'b', descricao: 'Bebidas' },
      { uuid: 'a', descricao: 'Limpeza' },
    ]);
  });

  it('Mix da loja: só as seções que a loja tem (aprovadas), em ordem alfabética', () => {
    const mix = [item('s-limpeza'), item('s-bebidas'), item('s-higiene', true)];
    expect(linhasDoFormulario({ linha_nivel: 'SECAO', linha_origem: 'MIX_LOJA' }, catalogo, mix)).toEqual([
      { uuid: 's-bebidas', descricao: 'Bebidas' },
      { uuid: 's-limpeza', descricao: 'Limpeza' },
    ]);
  });
});

describe('linhasFeitas', () => {
  it('pega as linhas já registradas deste formulário', () => {
    const registros = [
      { tipoRegistroUuid: 't1', secaoUuid: 's1', departamentoUuid: null, marcaUuid: null },
      { tipoRegistroUuid: 't2', secaoUuid: 's2', departamentoUuid: null, marcaUuid: null },
      { tipoRegistroUuid: 't1', secaoUuid: null, departamentoUuid: 'd1', marcaUuid: null },
    ];
    expect([...linhasFeitas(registros, 't1', 'SECAO')]).toEqual(['s1']);
    expect([...linhasFeitas(registros, 't1', 'DEPARTAMENTO')]).toEqual(['d1']);
  });
});
