import type { TipoRegistro } from '../types/api';
import { acaoConcluida, acaoValeNestaVisita, progressoLista } from './acaoObrigatoria';

// docs/40-ACAO-OBRIGATORIA-LOJA-REDE.md §4.
const tipo = (over: Partial<TipoRegistro>) =>
  ({ acao_obrigatoria: true, escopo_acao: 'LOJA_REDE', campanha_auditoria_uuid: null, ...over }) as TipoRegistro;
const pdv = (id: string, rede: string | null) => ({
  id,
  rede_loja: rede ? { id: rede, descricao: rede } : null,
  tem_contrato_ativo: false,
});
const semCampanha = new Set<string>();

describe('acaoValeNestaVisita — LOJA_REDE', () => {
  it('sem nada nas duas listas dispara em qualquer PDV', () => {
    expect(acaoValeNestaVisita(tipo({}), pdv('l1', null), semCampanha)).toBe(true);
    expect(acaoValeNestaVisita(tipo({ pontos_venda_uuids: [], redes_lojas_uuids: [] }), pdv('l2', 'r9'), semCampanha)).toBe(true);
  });

  it('só rede: dispara em PDV daquela rede, não em PDV de outra rede nem sem rede', () => {
    const t = tipo({ redes_lojas_uuids: ['atacadao'] });
    expect(acaoValeNestaVisita(t, pdv('l1', 'atacadao'), semCampanha)).toBe(true);
    expect(acaoValeNestaVisita(t, pdv('l2', 'mundial'), semCampanha)).toBe(false);
    expect(acaoValeNestaVisita(t, pdv('l3', null), semCampanha)).toBe(false);
  });

  it('só loja: dispara só naquela loja, mesmo com outra loja da mesma rede', () => {
    const t = tipo({ pontos_venda_uuids: ['l1'] });
    expect(acaoValeNestaVisita(t, pdv('l1', 'atacadao'), semCampanha)).toBe(true);
    expect(acaoValeNestaVisita(t, pdv('l2', 'atacadao'), semCampanha)).toBe(false);
  });

  it('rede e loja preenchidas: basta bater em qualquer uma (OR)', () => {
    const t = tipo({ redes_lojas_uuids: ['atacadao'], pontos_venda_uuids: ['avulsa-mundial'] });
    expect(acaoValeNestaVisita(t, pdv('qualquer-atacadao', 'atacadao'), semCampanha)).toBe(true);
    expect(acaoValeNestaVisita(t, pdv('avulsa-mundial', 'mundial'), semCampanha)).toBe(true);
    expect(acaoValeNestaVisita(t, pdv('outra-mundial', 'mundial'), semCampanha)).toBe(false);
  });

  it('não obrigatória nunca vira Ação, e os outros escopos seguem como antes', () => {
    expect(acaoValeNestaVisita(tipo({ acao_obrigatoria: false }), pdv('l1', null), semCampanha)).toBe(false);
    expect(acaoValeNestaVisita(tipo({ escopo_acao: 'SEMPRE' }), pdv('l1', null), semCampanha)).toBe(true);
    expect(acaoValeNestaVisita(tipo({ escopo_acao: 'CONTRATO' }), { ...pdv('l1', null), tem_contrato_ativo: true }, semCampanha)).toBe(true);
    expect(acaoValeNestaVisita(tipo({ escopo_acao: 'CAMPANHA', campanha_auditoria_uuid: 'c1' }), pdv('l1', null), new Set(['c1']))).toBe(true);
    expect(acaoValeNestaVisita(tipo({ escopo_acao: null }), pdv('l1', null), semCampanha)).toBe(false);
  });
});

describe('ação com lista predefinida de produtos', () => {
  const lista = [
    { id: 'a', descricao: 'A', codigo_barras: null, codigo_externo: null },
    { id: 'b', descricao: 'B', codigo_barras: null, codigo_externo: null },
  ];
  const comLista = { granularidade_padrao: 'PRODUTO' as const, produtos_predefinidos: lista };

  it('só conta como feita com todos os produtos coletados', () => {
    expect(acaoConcluida(comLista, [{ produtoAuditoriaUuid: 'a' }])).toBe(false);
    expect(acaoConcluida(comLista, [{ produtoAuditoriaUuid: 'a' }, { produtoAuditoriaUuid: 'b' }])).toBe(true);
    // Produto repetido ou fora da lista não conta a mais.
    expect(progressoLista(comLista, ['a', 'a', 'x'])).toEqual({ feitos: 1, total: 2 });
  });

  it('sem lista (ou granularidade que não é PRODUTO), um registro basta como antes', () => {
    expect(acaoConcluida({ granularidade_padrao: null, produtos_predefinidos: [] }, [{ produtoAuditoriaUuid: null }])).toBe(true);
    expect(acaoConcluida({ granularidade_padrao: 'LINHA', produtos_predefinidos: lista }, [{ produtoAuditoriaUuid: null }])).toBe(true);
    expect(progressoLista({ granularidade_padrao: 'PRODUTO', produtos_predefinidos: [] }, [])).toBeNull();
  });
});
