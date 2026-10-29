import { cabeMaisFoto, chaveDaFoto, contagemPorCampo, erroDasFotos, fotosDaVisita, legendaCaptura } from './fotosNomeadas';

// docs/98 — fotos nomeadas (antes/depois) e galeria Horus.
const antes = { chave: 'antes', rotulo: 'Antes', obrigatorio: true, foto_min: 1, foto_max: 2 };
const depois = { chave: 'depois', rotulo: 'Depois', obrigatorio: true, foto_min: null, foto_max: 3 };
const opcional = { chave: 'extra', rotulo: 'Extra', obrigatorio: false, foto_min: 2, foto_max: null };

describe('erroDasFotos', () => {
  it('cobra a obrigatória, o mínimo e o máximo, como o servidor', () => {
    const total = (contagem: Record<string, number>) => (c: string) => contagem[c] ?? 0;
    expect(erroDasFotos([antes, depois], total({ antes: 1 }))).toBe('Faça o registro fotográfico "Depois".');
    expect(erroDasFotos([antes, depois], total({ antes: 3, depois: 1 }))).toBe('"Antes" aceita no máximo 2 fotos.');
    expect(erroDasFotos([opcional], total({ extra: 1 }))).toBe('"Extra" pede pelo menos 2 fotos.');
    expect(erroDasFotos([opcional], total({}))).toBeNull();
    expect(erroDasFotos([antes, depois], total({ antes: 1, depois: 2 }))).toBeNull();
  });

  it('máximo 1 fala no singular', () => {
    expect(erroDasFotos([{ ...antes, foto_max: 1 }], () => 2)).toBe('"Antes" aceita no máximo 1 foto.');
  });
});

describe('contagemPorCampo', () => {
  it('conta por pergunta, inclusive zero, e ignora foto livre e pergunta desconhecida', () => {
    expect(
      contagemPorCampo([antes, depois], ['a', 'b', 'c', 'd'], {
        a: { campoChave: 'antes' },
        b: { campoChave: 'antes' },
        c: { campoChave: 'outra' },
      }),
    ).toEqual({ antes: 2, depois: 0 });
  });
});

describe('chaveDaFoto', () => {
  it('usa a chave da original quando reaproveitada, senão id do registro + posição', () => {
    expect(chaveDaFoto('r1', 0, undefined)).toBe('r1:0');
    expect(chaveDaFoto('r1', 2, { origem: 'CAMERA' })).toBe('r1:2');
    expect(chaveDaFoto('r1', 0, { chave: 'r0:1', origem: 'VISITA' })).toBe('r0:1');
  });
});

describe('fotosDaVisita', () => {
  it('lista as fotos dos registros sem repetir a mesma foto e sem as já usadas, mais recentes primeiro', () => {
    const lista = fotosDaVisita(
      [
        { id: 'r0', imagensLocais: ['/a.jpg', '/b.jpg'], descricao: 'Foto' },
        // Reaproveitou a /a.jpg de r0 (mesma chave), com outro arquivo.
        { id: 'r1', imagensLocais: ['/a-copia.jpg', '/c.jpg'], fotosMeta: { '/a-copia.jpg': { chave: 'r0:0', origem: 'VISITA' } }, descricao: 'Conquista' },
      ],
      ['r0:1'],
    );
    expect(lista.map((f) => [f.uri, f.chave, f.origemDescricao])).toEqual([
      ['/c.jpg', 'r1:1', 'Conquista'],
      ['/a.jpg', 'r0:0', 'Foto'],
    ]);
  });
});

describe('cabeMaisFoto / legendaCaptura', () => {
  it('respeita o máximo', () => {
    expect(cabeMaisFoto({ foto_max: 2 }, 1)).toBe(true);
    expect(cabeMaisFoto({ foto_max: 2 }, 2)).toBe(false);
    expect(cabeMaisFoto({ foto_max: null }, 50)).toBe(true);
  });

  it('hoje mostra só a hora; outro dia, a data', () => {
    const agora = new Date('2026-10-28T15:00:00');
    expect(legendaCaptura('2026-10-28T09:12:00', agora)).toMatch(/^Hoje às 09:12$/);
    expect(legendaCaptura('2026-10-21T09:12:00', agora)).toMatch(/^21\/10 às 09:12$/);
    expect(legendaCaptura(null, agora)).toBe('');
  });
});
