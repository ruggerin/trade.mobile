import type { SortimentoPontoVenda, TipoRegistro } from '../types/api';
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

// docs/80-MONITORAMENTO-LINHA-AUSENTE.md §5.1 e §5.4.
describe('acaoValeNestaVisita — LINHA_AUSENTE e filtro por ramo', () => {
  const linha = (over: Partial<TipoRegistro> = {}) =>
    tipo({
      escopo_acao: 'LINHA_AUSENTE',
      escopo_tipo_vinculo: 'SECAO',
      escopo_secao: { id: 'batata', descricao: 'Batatas Palha', departamento_uuid: 'snacks' },
      ...over,
    });
  const produto = (secao: string, departamento = 'snacks', marca: string | null = null, status: 'PENDENTE' | null = null) =>
    ({
      id: `i-${secao}-${status}`,
      tipo_item: 'PRODUTO',
      produto: { secao_uuid: secao, departamento_uuid: departamento, marca_uuid: marca },
      status_aprovacao: status,
    }) as unknown as SortimentoPontoVenda;
  const recorte = (tipo_item: 'SECAO' | 'DEPARTAMENTO' | 'MARCA', id: string, departamento?: string) =>
    ({
      id: `r-${id}`,
      tipo_item,
      produto: null,
      secao: tipo_item === 'SECAO' ? { id, descricao: id, departamento_uuid: departamento } : null,
      departamento: tipo_item === 'DEPARTAMENTO' ? { id, descricao: id } : null,
      marca: tipo_item === 'MARCA' ? { id, descricao: id } : null,
      status_aprovacao: null,
    }) as unknown as SortimentoPontoVenda;
  const loja = pdv('l1', null);

  it('vale quando o Mix existe e não tem a linha', () => {
    expect(acaoValeNestaVisita(linha(), loja, semCampanha, [produto('chips')])).toBe(true);
  });

  it('não vale com Mix vazio ou ainda não carregado', () => {
    expect(acaoValeNestaVisita(linha(), loja, semCampanha, [])).toBe(false);
    expect(acaoValeNestaVisita(linha(), loja, semCampanha, undefined)).toBe(false);
  });

  it('produto da seção, a seção inteira ou o departamento dela cobrem a linha', () => {
    expect(acaoValeNestaVisita(linha(), loja, semCampanha, [produto('chips'), produto('batata')])).toBe(false);
    expect(acaoValeNestaVisita(linha(), loja, semCampanha, [recorte('SECAO', 'batata', 'snacks')])).toBe(false);
    expect(acaoValeNestaVisita(linha(), loja, semCampanha, [recorte('DEPARTAMENTO', 'snacks')])).toBe(false);
  });

  it('item pendente não conta como linha presente', () => {
    expect(acaoValeNestaVisita(linha(), loja, semCampanha, [produto('chips'), produto('batata', 'snacks', null, 'PENDENTE')])).toBe(true);
  });

  it('recorte por departamento e por marca', () => {
    const porDepartamento = linha({ escopo_tipo_vinculo: 'DEPARTAMENTO', escopo_secao: null, escopo_departamento: { id: 'snacks', descricao: 'Snacks' } });
    expect(acaoValeNestaVisita(porDepartamento, loja, semCampanha, [produto('amaciante', 'limpeza')])).toBe(true);
    expect(acaoValeNestaVisita(porDepartamento, loja, semCampanha, [recorte('SECAO', 'chips', 'snacks')])).toBe(false);

    const porMarca = linha({ escopo_tipo_vinculo: 'MARCA', escopo_secao: null, escopo_marca: { id: 'm1', descricao: 'Marca' } });
    expect(acaoValeNestaVisita(porMarca, loja, semCampanha, [produto('batata', 'snacks', 'm2')])).toBe(true);
    expect(acaoValeNestaVisita(porMarca, loja, semCampanha, [produto('batata', 'snacks', 'm1')])).toBe(false);
    expect(acaoValeNestaVisita(porMarca, loja, semCampanha, [recorte('MARCA', 'm1')])).toBe(false);
  });

  it('filtro por ramo vale em qualquer escopo; loja sem ramo passa', () => {
    const sempre = tipo({ escopo_acao: 'SEMPRE', ramos_atividade_uuids: ['supermercado'] });
    const comRamo = (ramo: string | null) => ({ ...loja, ramo_atividade: ramo ? { id: ramo, descricao: ramo } : null });
    expect(acaoValeNestaVisita(sempre, comRamo('supermercado'), semCampanha)).toBe(true);
    expect(acaoValeNestaVisita(sempre, comRamo('drogaria'), semCampanha)).toBe(false);
    expect(acaoValeNestaVisita(sempre, comRamo(null), semCampanha)).toBe(true);
    expect(acaoValeNestaVisita(linha({ ramos_atividade_uuids: ['supermercado'] }), comRamo('drogaria'), semCampanha, [produto('chips')])).toBe(false);
  });
});

// docs/80-MONITORAMENTO-LINHA-AUSENTE.md §5.2 — intervalo entre cobranças.
describe('acaoValeNestaVisita — intervalo em dias', () => {
  const sempre = (intervalo_dias: number) => tipo({ id: 'f1', escopo_acao: 'SEMPRE', intervalo_dias });
  const agora = new Date(2026, 9, 15, 9, 0);
  const inicioVisita = new Date(2026, 9, 15, 8, 30).toISOString();
  const ultimo = (ano: number, mes: number, dia: number, hora = 10) => ({ f1: new Date(ano, mes, dia, hora).toISOString() });
  const loja = pdv('l1', null);

  it('0 = toda visita, mesmo com registro ontem', () => {
    expect(acaoValeNestaVisita(sempre(0), loja, semCampanha, undefined, { ultimosRegistros: ultimo(2026, 9, 14), inicioVisita, agora })).toBe(true);
  });

  it('7 dias: some até completar os dias de calendário e volta no 7º dia', () => {
    expect(acaoValeNestaVisita(sempre(7), loja, semCampanha, undefined, { ultimosRegistros: ultimo(2026, 9, 9), inicioVisita, agora })).toBe(false);
    expect(acaoValeNestaVisita(sempre(7), loja, semCampanha, undefined, { ultimosRegistros: ultimo(2026, 9, 8), inicioVisita, agora })).toBe(true);
  });

  it('1 dia: registro de ontem à noite já libera hoje', () => {
    expect(acaoValeNestaVisita(sempre(1), loja, semCampanha, undefined, { ultimosRegistros: ultimo(2026, 9, 14, 23), inicioVisita, agora })).toBe(true);
  });

  it('registro desta mesma visita não esconde a Ação, e sem histórico ela vale', () => {
    const destaVisita = { f1: new Date(2026, 9, 15, 8, 45).toISOString() };
    expect(acaoValeNestaVisita(sempre(7), loja, semCampanha, undefined, { ultimosRegistros: destaVisita, inicioVisita, agora })).toBe(true);
    expect(acaoValeNestaVisita(sempre(7), loja, semCampanha, undefined, { ultimosRegistros: {}, inicioVisita, agora })).toBe(true);
  });
});
