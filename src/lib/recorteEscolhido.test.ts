import type { ProdutoSortimento, RecortesDoMix } from './api/campoSortimento';
import { agruparChecklist, produtosDoRecorte, recortesPermitidos } from './recorteEscolhido';

// docs/79-CHECKLIST-MIX-POR-ESCOLHA-DO-PROMOTOR.md decisões 3 e 4.
const produto = (uuid: string, secao: string, departamento: string) =>
  ({
    produto_uuid: uuid,
    descricao: uuid,
    secao_uuid: secao,
    secao_descricao: secao,
    departamento_uuid: departamento,
    departamento_descricao: departamento,
  }) as ProdutoSortimento;

const mix = [
  produto('amaciante-azul', 'Amaciante', 'Limpeza'),
  produto('sabao-po', 'Lava-roupas', 'Limpeza'),
  produto('amaciante-rosa', 'Amaciante', 'Limpeza'),
  produto('sabonete', 'Sabonete', 'Higiene'),
];
const recortes: RecortesDoMix = {
  marcas: [{ uuid: 'brisa', descricao: 'Brisa', departamentos_uuids: ['Limpeza', 'Higiene'] }],
  departamentos: [],
  secoes: [],
};

describe('recortesPermitidos', () => {
  it('segue as caixinhas do formulário, na ordem marca, departamento, seção', () => {
    expect(recortesPermitidos({ escolhe_marca: false, escolhe_departamento: true, escolhe_secao: true })).toEqual(['DEPARTAMENTO', 'SECAO']);
    expect(recortesPermitidos({})).toEqual([]);
  });
});

describe('produtosDoRecorte', () => {
  it('seção e departamento filtram pelo produto; marca pelos departamentos dela', () => {
    expect(produtosDoRecorte(mix, { tipo: 'SECAO', uuid: 'Amaciante', descricao: '' }, recortes).map((p) => p.produto_uuid)).toEqual([
      'amaciante-azul',
      'amaciante-rosa',
    ]);
    expect(produtosDoRecorte(mix, { tipo: 'DEPARTAMENTO', uuid: 'Limpeza', descricao: '' }, recortes)).toHaveLength(3);
    expect(produtosDoRecorte(mix, { tipo: 'MARCA', uuid: 'brisa', descricao: '' }, recortes)).toHaveLength(4);
    expect(produtosDoRecorte(mix, { tipo: 'MARCA', uuid: 'outra', descricao: '' }, recortes)).toHaveLength(0);
  });
});

describe('agruparChecklist', () => {
  it('seção vira lista simples; departamento agrupa por seção; marca por departamento e seção', () => {
    expect(agruparChecklist(mix, 'SECAO')).toHaveLength(1);

    const porSecao = agruparChecklist(mix.slice(0, 3), 'DEPARTAMENTO');
    expect(porSecao.map((g) => [g.titulo, g.produtos.length])).toEqual([
      ['Amaciante', 2],
      ['Lava-roupas', 1],
    ]);

    const porMarca = agruparChecklist(mix, 'MARCA');
    expect(porMarca.map((g) => `${g.supertitulo} › ${g.titulo}`)).toEqual(['Higiene › Sabonete', 'Limpeza › Amaciante', 'Limpeza › Lava-roupas']);
  });
});
