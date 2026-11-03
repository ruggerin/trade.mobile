import { nivelDoCardPorLinha, nomeDoCardDaLinha, registrosDaLinha } from './linhasGuiadas';

// docs/103 — um card por linha na aba Ações.
describe('nivelDoCardPorLinha', () => {
  it('só com lista guiada e a opção ligada', () => {
    expect(nivelDoCardPorLinha({ granularidade_padrao: 'LINHA', linha_nivel: 'SECAO', linha_exibicao: 'CARDS' })).toBe('SECAO');
    expect(nivelDoCardPorLinha({ granularidade_padrao: 'LINHA', linha_nivel: 'SECAO', linha_exibicao: 'JANELA' })).toBeNull();
    expect(nivelDoCardPorLinha({ granularidade_padrao: 'LINHA', linha_nivel: null, linha_exibicao: 'CARDS' })).toBeNull();
    expect(nivelDoCardPorLinha({ granularidade_padrao: 'PRODUTO', linha_nivel: 'SECAO', linha_exibicao: 'CARDS' })).toBeNull();
  });

  it('API antiga (sem o campo) = janela, como antes', () => {
    expect(nivelDoCardPorLinha({ granularidade_padrao: 'LINHA', linha_nivel: 'MARCA' })).toBeNull();
  });
});

it('nome do card junta formulário e linha', () => {
  expect(nomeDoCardDaLinha('Planograma', { uuid: 'a', descricao: 'Amaciante' })).toBe('Planograma › Amaciante');
});

it('registros da linha pelo vínculo do nível', () => {
  const r = (secao: string | null, marca: string | null) => ({ secaoUuid: secao, departamentoUuid: null, marcaUuid: marca });
  const registros = [r('casa', null), r('roupas', null), r(null, 'casa'), r('casa', 'x')];
  expect(registrosDaLinha(registros, 'SECAO', 'casa')).toHaveLength(2);
  expect(registrosDaLinha(registros, 'MARCA', 'casa')).toHaveLength(1);
  expect(registrosDaLinha(registros, 'DEPARTAMENTO', 'casa')).toHaveLength(0);
});
