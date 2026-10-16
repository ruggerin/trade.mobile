import { cartoesDaVisita, diaMes } from './acompanhamentos';
import type { AcompanhamentoAberto } from '../types/api';

function acomp(sobrescrever: Partial<AcompanhamentoAberto> = {}, origem: Partial<AcompanhamentoAberto['origem']> = {}): AcompanhamentoAberto {
  return {
    id: 'a1',
    tipo_registro: { id: 't1', descricao: 'Ponta de gôndola' },
    proxima_verificacao_em: '2026-10-10',
    ultima_resposta_em: null,
    expira_em: null,
    rotulo_continua: 'Continua',
    rotulo_acabou: 'Acabou',
    ao_continuar: 'CONFIRMA',
    formulario_acabou: null,
    ...sobrescrever,
    origem: {
      id: 'r1',
      criado_em: '2026-10-01T12:00:00Z',
      usuario_nome: 'Ana Souza',
      miniatura_url: null,
      produto: null,
      tipo_vinculo: null,
      secao_uuid: null,
      departamento_uuid: null,
      marca_uuid: null,
      vinculo_descricao: null,
      resumo: [],
      valores_campos: null,
      ...origem,
    },
  };
}

const hoje = new Date(2026, 9, 16, 10, 0, 0);
const inicioVisita = new Date(2026, 9, 16, 9, 0, 0).toISOString();

describe('cartoesDaVisita', () => {
  it('mostra o que já chegou na data de verificação', () => {
    const r = cartoesDaVisita([acomp()], { hoje, inicioVisita });
    expect(r).toHaveLength(1);
    expect(r[0].respostaNestaVisita).toBeNull();
  });

  it('a verificação de hoje já aparece; a de amanhã ainda não', () => {
    expect(cartoesDaVisita([acomp({ proxima_verificacao_em: '2026-10-16' })], { hoje, inicioVisita })).toHaveLength(1);
    expect(cartoesDaVisita([acomp({ proxima_verificacao_em: '2026-10-17' })], { hoje, inicioVisita })).toHaveLength(0);
  });

  it('esconde o que passou do prazo, mas não o que vence hoje', () => {
    expect(cartoesDaVisita([acomp({ expira_em: '2026-10-15' })], { hoje, inicioVisita })).toHaveLength(0);
    expect(cartoesDaVisita([acomp({ expira_em: '2026-10-16' })], { hoje, inicioVisita })).toHaveLength(1);
  });

  it('não pede pra conferir o que foi registrado nesta mesma visita', () => {
    const r = cartoesDaVisita([acomp({ proxima_verificacao_em: '2026-10-16' }, { criado_em: new Date(2026, 9, 16, 9, 30).toISOString() })], {
      hoje,
      inicioVisita,
    });
    expect(r).toHaveLength(0);
  });

  it('respondido em outra visita do aparelho some', () => {
    expect(cartoesDaVisita([acomp()], { hoje, inicioVisita, respondidosEmOutrasVisitas: new Set(['a1']) })).toHaveLength(0);
  });

  it('respondido nesta visita fica como feito, mesmo fora da data', () => {
    const r = cartoesDaVisita([acomp({ proxima_verificacao_em: '2026-10-23' })], {
      hoje,
      inicioVisita,
      respostasDestaVisita: new Map([['a1', 'CONTINUA']]),
    });
    expect(r).toHaveLength(1);
    expect(r[0].respostaNestaVisita).toBe('CONTINUA');
  });
});

describe('diaMes', () => {
  it('formata dd/mm e aceita nulo', () => {
    expect(diaMes(new Date(2026, 9, 8, 12).toISOString())).toBe('08/10');
    expect(diaMes(null)).toBe('');
  });
});
