import { chaveRascunho, descricaoRascunho, resumoRascunho, temConteudo } from './rascunhoRegistro';

// docs/99 — rascunho de formulário (terminar depois).
const vazio = { valoresCampos: {}, imagensUri: [], fotosMeta: {}, fotosHistorico: [], ruptura: false };
const limpeza = { tipo: 'SECAO' as const, uuid: 's1', descricao: 'Limpeza', marca: null };

describe('temConteudo', () => {
  it('formulário intocado não vira rascunho; resposta, foto ou ruptura sim', () => {
    expect(temConteudo(vazio)).toBe(false);
    expect(temConteudo({ ...vazio, valoresCampos: { obs: '  ' } })).toBe(false);
    expect(temConteudo({ ...vazio, valoresCampos: { obs: 'ok' } })).toBe(true);
    expect(temConteudo({ ...vazio, imagensUri: ['/a.jpg'] })).toBe(true);
    expect(temConteudo({ ...vazio, ruptura: true })).toBe(true);
  });
});

describe('chaveRascunho / descricaoRascunho', () => {
  it('um por formulário + recorte ou produto', () => {
    const semAlvo = { recorte: null, produtoContexto: null, vinculo: null };
    expect(chaveRascunho('t1', { ...semAlvo, recorte: limpeza })).toBe('t1|SECAO:s1:');
    expect(chaveRascunho('t1', { ...semAlvo, recorte: { ...limpeza, uuid: 's2' } })).not.toBe(chaveRascunho('t1', { ...semAlvo, recorte: limpeza }));
    expect(chaveRascunho('t1', { ...semAlvo, produtoContexto: { uuid: 'p1', descricao: 'Omo' } })).toBe('t1|PRODUTO:p1');
    expect(chaveRascunho('t1', semAlvo)).toBe('t1|');
  });

  it('descreve o formulário e onde é o registro', () => {
    const semAlvo = { recorte: null, produtoContexto: null, vinculo: null };
    expect(descricaoRascunho('Planograma', { ...semAlvo, recorte: limpeza })).toBe('Planograma · Limpeza');
    expect(descricaoRascunho('Planograma', { ...semAlvo, recorte: { ...limpeza, marca: { uuid: 'm', descricao: 'Ypê' } } })).toBe('Planograma · Limpeza · Ypê');
    expect(descricaoRascunho('Foto', semAlvo)).toBe('Foto');
  });
});

describe('resumoRascunho', () => {
  const campos = [
    { chave: 'antes', rotulo: 'Antes', tipo_campo: 'FOTO' as const, obrigatorio: true, depende_de_chave: null, depende_de_valor: null },
    { chave: 'modulos', rotulo: 'Módulos', tipo_campo: 'NUMERO' as const, obrigatorio: false, depende_de_chave: null, depende_de_valor: null },
    { chave: 'depois', rotulo: 'Depois', tipo_campo: 'FOTO' as const, obrigatorio: true, depende_de_chave: null, depende_de_valor: null },
    { chave: 'motivo', rotulo: 'Motivo', tipo_campo: 'TEXTO' as const, obrigatorio: false, depende_de_chave: 'modulos', depende_de_valor: '0' },
  ];

  it('conta as respondidas (foto conta com foto) e aponta a foto obrigatória que falta', () => {
    expect(
      resumoRascunho(campos, { ...vazio, imagensUri: ['/a.jpg'], fotosMeta: { '/a.jpg': { campoChave: 'antes' } }, valoresCampos: { modulos: '2' } }),
    ).toBe('2 de 3 respondidas · falta Depois');
  });

  it('foto de visita anterior conta; condicional visível entra na conta', () => {
    expect(
      resumoRascunho(campos, { ...vazio, fotosHistorico: [{ uuid: 'x', campoChave: 'antes', url: 'u' }], valoresCampos: { modulos: '0' } }),
    ).toBe('2 de 4 respondidas · falta Depois');
  });

  it('formulário sem perguntas mostra as fotos', () => {
    expect(resumoRascunho([], { ...vazio, imagensUri: ['/a.jpg', '/b.jpg'] })).toBe('2 fotos');
  });
});
