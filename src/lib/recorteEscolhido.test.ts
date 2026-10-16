import type { ProdutoSortimento, RecortesDoMix } from './api/campoSortimento';
import type { CatalogoItem, SortimentoPontoVenda } from '../types/api';
import { agruparChecklist, descricaoRecorte, estaNaLoja, marcasNaLoja, mixAprovado, opcoesDaAba, produtosDoRecorte, recortesPermitidos } from './recorteEscolhido';

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

// docs/82 — marca pelo produto, "Na loja" e marcas do passo 2.
describe('docs/82', () => {
  const comMarca = (uuid: string, secao: string, departamento: string, marca: string) =>
    ({ ...produto(uuid, secao, departamento), marca_uuid: marca, marca_descricao: marca }) as ProdutoSortimento;
  const biscoitos = [
    comMarca('recheado-piraque', 'Recheado', 'Biscoitos', 'Piraquê'),
    comMarca('recheado-outra', 'Recheado', 'Biscoitos', 'Outra'),
    comMarca('cream-piraque', 'Cream', 'Biscoitos', 'Piraquê'),
  ];

  it('marca é a do produto, e o filtro de marca faz a interseção com a seção', () => {
    expect(produtosDoRecorte(biscoitos, { tipo: 'MARCA', uuid: 'Piraquê', descricao: '' }, undefined).map((p) => p.produto_uuid)).toEqual([
      'recheado-piraque',
      'cream-piraque',
    ]);
    const recheadoPiraque = { tipo: 'SECAO' as const, uuid: 'Recheado', descricao: 'Recheado', marca: { uuid: 'Piraquê', descricao: 'Piraquê' } };
    expect(produtosDoRecorte(biscoitos, recheadoPiraque, undefined).map((p) => p.produto_uuid)).toEqual(['recheado-piraque']);
    expect(descricaoRecorte(recheadoPiraque)).toBe('Recheado · Piraquê');
  });

  const item = (tipo_item: SortimentoPontoVenda['tipo_item'], extra: Partial<SortimentoPontoVenda>) =>
    ({ id: Math.random().toString(), tipo_item, produto: null, usuario: null, status_aprovacao: null, ...extra }) as SortimentoPontoVenda;
  const catalogoSecoes: CatalogoItem[] = [
    { id: 'Recheado', descricao: 'Recheado', departamento: { id: 'Biscoitos', descricao: 'Biscoitos' } },
    { id: 'Amaciante', descricao: 'Amaciante', departamento: { id: 'Limpeza', descricao: 'Limpeza' } },
  ];

  it('"Na loja": item de departamento cobre as seções dele; pendente não conta', () => {
    const opcoes = opcoesDaAba('SECAO', catalogoSecoes, undefined);
    const mixLoja = mixAprovado([
      item('DEPARTAMENTO', { departamento: { id: 'Biscoitos', descricao: 'Biscoitos' } }),
      item('SECAO', { secao: { id: 'Amaciante', descricao: 'Amaciante' }, status_aprovacao: 'PENDENTE' as SortimentoPontoVenda['status_aprovacao'] }),
    ]);
    expect(opcoes.filter((o) => estaNaLoja('SECAO', o, mixLoja, undefined)).map((o) => o.uuid)).toEqual(['Recheado']);
  });

  it('marcas do passo 2: só as que a loja tem naquela seção', () => {
    const recheado = { tipo: 'SECAO' as const, uuid: 'Recheado', descricao: 'Recheado' };
    expect(marcasNaLoja(recheado, biscoitos, [], []).map((m) => m.uuid)).toEqual(['Outra', 'Piraquê']);
    expect(marcasNaLoja({ tipo: 'SECAO', uuid: 'Cream', descricao: 'Cream' }, biscoitos, [], []).map((m) => m.uuid)).toEqual(['Piraquê']);
  });
});
