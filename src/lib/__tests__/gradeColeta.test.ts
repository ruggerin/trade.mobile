import { chaveGrade, contarProdutosRespondidos, resolverGrade } from '../gradeColeta';
import type { TipoRegistro } from '../../types/api';

function criarTipo(overrides: Partial<TipoRegistro> = {}): TipoRegistro {
  return {
    id: 'tipo-uuid',
    descricao: 'Ponto Natural',
    icone: null,
    ordem: 0,
    exige_foto: false,
    permite_vincular_catalogo: true,
    acao_obrigatoria: false,
    escopo_acao: null,
    campanha_auditoria_uuid: null,
    granularidade_padrao: 'PRODUTO',
    excecoes_granularidade: [],
    eh_ruptura: false,
    disponivel_registro_livre: true,
    campos: [],
    ativo: true,
    ...overrides,
  };
}

const PRODUTO_A = { uuid: 'produto-a', descricao: 'Amaciante Azul' };
const PRODUTO_B = { uuid: 'produto-b', descricao: 'Amaciante Verde' };

const RUPTURA = criarTipo({ id: 'tipo-ruptura', descricao: 'Ruptura', eh_ruptura: true });
const PONTO_NATURAL = criarTipo({ id: 'tipo-ponto-natural', descricao: 'Ponto Natural' });
const PRECIFICADO = criarTipo({ id: 'tipo-precificado', descricao: 'Produto Precificado' });
const COLUNAS = [RUPTURA, PONTO_NATURAL, PRECIFICADO];

describe('resolverGrade', () => {
  it('sem ruptura marcada, não remove nada', () => {
    const marcados = new Set([chaveGrade(PONTO_NATURAL.id, PRODUTO_A.uuid)]);
    const { marcadosFinais, removidosPorRuptura } = resolverGrade(marcados, COLUNAS, [PRODUTO_A], RUPTURA);

    expect(marcadosFinais.has(chaveGrade(PONTO_NATURAL.id, PRODUTO_A.uuid))).toBe(true);
    expect(removidosPorRuptura).toHaveLength(0);
  });

  it('ruptura remove as outras respostas já marcadas pra aquele produto, e avisa o que removeu', () => {
    const marcados = new Set([
      chaveGrade(RUPTURA.id, PRODUTO_A.uuid),
      chaveGrade(PONTO_NATURAL.id, PRODUTO_A.uuid),
      chaveGrade(PRECIFICADO.id, PRODUTO_A.uuid),
    ]);

    const { marcadosFinais, removidosPorRuptura } = resolverGrade(marcados, COLUNAS, [PRODUTO_A], RUPTURA);

    expect(marcadosFinais.has(chaveGrade(RUPTURA.id, PRODUTO_A.uuid))).toBe(true);
    expect(marcadosFinais.has(chaveGrade(PONTO_NATURAL.id, PRODUTO_A.uuid))).toBe(false);
    expect(marcadosFinais.has(chaveGrade(PRECIFICADO.id, PRODUTO_A.uuid))).toBe(false);
    expect(removidosPorRuptura).toEqual(
      expect.arrayContaining([
        { produtoDescricao: PRODUTO_A.descricao, tipoDescricao: PONTO_NATURAL.descricao },
        { produtoDescricao: PRODUTO_A.descricao, tipoDescricao: PRECIFICADO.descricao },
      ]),
    );
    expect(removidosPorRuptura).toHaveLength(2);
  });

  it('ruptura de um produto não afeta as respostas de outro produto', () => {
    const marcados = new Set([
      chaveGrade(RUPTURA.id, PRODUTO_A.uuid),
      chaveGrade(PONTO_NATURAL.id, PRODUTO_A.uuid),
      chaveGrade(PONTO_NATURAL.id, PRODUTO_B.uuid),
    ]);

    const { marcadosFinais, removidosPorRuptura } = resolverGrade(marcados, COLUNAS, [PRODUTO_A, PRODUTO_B], RUPTURA);

    expect(marcadosFinais.has(chaveGrade(PONTO_NATURAL.id, PRODUTO_B.uuid))).toBe(true);
    expect(removidosPorRuptura).toEqual([{ produtoDescricao: PRODUTO_A.descricao, tipoDescricao: PONTO_NATURAL.descricao }]);
  });

  it('sem coluna de ruptura configurada, não remove nada (grade sem Ruptura disponível)', () => {
    const marcados = new Set([chaveGrade(PONTO_NATURAL.id, PRODUTO_A.uuid)]);
    const { marcadosFinais, removidosPorRuptura } = resolverGrade(marcados, [PONTO_NATURAL], [PRODUTO_A], null);

    expect(marcadosFinais.has(chaveGrade(PONTO_NATURAL.id, PRODUTO_A.uuid))).toBe(true);
    expect(removidosPorRuptura).toHaveLength(0);
  });

  it('não modifica o Set original recebido (marcadosFinais é uma cópia)', () => {
    const marcados = new Set([chaveGrade(RUPTURA.id, PRODUTO_A.uuid), chaveGrade(PONTO_NATURAL.id, PRODUTO_A.uuid)]);
    resolverGrade(marcados, COLUNAS, [PRODUTO_A], RUPTURA);

    expect(marcados.has(chaveGrade(PONTO_NATURAL.id, PRODUTO_A.uuid))).toBe(true);
  });
});

describe('contarProdutosRespondidos', () => {
  it('conta um produto só uma vez mesmo com várias colunas marcadas', () => {
    const marcados = new Set([
      chaveGrade(RUPTURA.id, PRODUTO_A.uuid),
      chaveGrade(PONTO_NATURAL.id, PRODUTO_A.uuid),
    ]);
    expect(contarProdutosRespondidos(marcados, COLUNAS, [PRODUTO_A, PRODUTO_B])).toBe(1);
  });

  it('sem nenhuma marcação, conta zero', () => {
    expect(contarProdutosRespondidos(new Set(), COLUNAS, [PRODUTO_A, PRODUTO_B])).toBe(0);
  });

  it('conta cada produto com ao menos uma resposta', () => {
    const marcados = new Set([
      chaveGrade(PONTO_NATURAL.id, PRODUTO_A.uuid),
      chaveGrade(PRECIFICADO.id, PRODUTO_B.uuid),
    ]);
    expect(contarProdutosRespondidos(marcados, COLUNAS, [PRODUTO_A, PRODUTO_B])).toBe(2);
  });
});
