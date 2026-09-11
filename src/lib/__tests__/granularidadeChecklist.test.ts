import { resolverGranularidade } from '../granularidadeChecklist';
import type { GranularidadeResposta, TipoRegistro } from '../../types/api';

// Mesma bateria de casos de App\Support\GranularidadeChecklist no backend
// (api/tests/Feature/Visita/GranularidadeChecklistTest.php) — as duas implementações precisam
// concordar, senão o app deixaria o promotor seguir um caminho que o servidor rejeita (ou
// vice-versa). Ver docs/16-GRANULARIDADE-CHECKLIST-AUDITORIA.md §4.

const SECAO_AMACIANTE = 'secao-amaciante-uuid';
const SECAO_PILHAS = 'secao-pilhas-uuid';

function criarTipo(overrides: Partial<TipoRegistro> = {}): TipoRegistro {
  return {
    id: 'tipo-uuid',
    descricao: 'Ponto Natural',
    exige_foto: false,
    permite_vincular_catalogo: true,
    acao_obrigatoria: false,
    escopo_acao: null,
    campanha_auditoria_uuid: null,
    granularidade_padrao: null,
    excecoes_granularidade: [],
    eh_ruptura: false,
    campos: [],
    ativo: true,
    ...overrides,
  };
}

describe('resolverGranularidade', () => {
  it('sem padrão e sem exceção retorna null (comportamento livre)', () => {
    const tipo = criarTipo({ granularidade_padrao: null });
    expect(resolverGranularidade(tipo, SECAO_AMACIANTE)).toBeNull();
    expect(resolverGranularidade(tipo, null)).toBeNull();
  });

  it('sem exceção, retorna o padrão do tipo', () => {
    const linha = criarTipo({ granularidade_padrao: 'LINHA' });
    const produto = criarTipo({ granularidade_padrao: 'PRODUTO' });
    expect(resolverGranularidade(linha, SECAO_AMACIANTE)).toBe('LINHA');
    expect(resolverGranularidade(produto, SECAO_AMACIANTE)).toBe('PRODUTO');
  });

  it('exceção da seção sobrepõe o padrão (aperta: LINHA -> PRODUTO)', () => {
    const tipo = criarTipo({
      granularidade_padrao: 'LINHA',
      excecoes_granularidade: [{ secao_uuid: SECAO_PILHAS, secao_descricao: 'Pilhas', granularidade: 'PRODUTO' }],
    });
    expect(resolverGranularidade(tipo, SECAO_PILHAS)).toBe('PRODUTO');
  });

  it('exceção da seção também pode afrouxar o padrão (PRODUTO -> LINHA)', () => {
    const tipo = criarTipo({
      granularidade_padrao: 'PRODUTO',
      excecoes_granularidade: [{ secao_uuid: SECAO_AMACIANTE, secao_descricao: 'Amaciante', granularidade: 'LINHA' }],
    });
    expect(resolverGranularidade(tipo, SECAO_AMACIANTE)).toBe('LINHA');
  });

  it('exceção de uma seção não afeta outra seção sem exceção própria', () => {
    const tipo = criarTipo({
      granularidade_padrao: 'LINHA',
      excecoes_granularidade: [{ secao_uuid: SECAO_PILHAS, secao_descricao: 'Pilhas', granularidade: 'PRODUTO' }],
    });
    expect(resolverGranularidade(tipo, SECAO_AMACIANTE)).toBe('LINHA');
  });

  it('sem seção conhecida (null), nenhuma exceção pode ser checada — só o padrão vale', () => {
    const tipo = criarTipo({
      granularidade_padrao: 'LINHA',
      excecoes_granularidade: [{ secao_uuid: SECAO_PILHAS, secao_descricao: 'Pilhas', granularidade: 'PRODUTO' }],
    });
    expect(resolverGranularidade(tipo, null)).toBe('LINHA');
  });

  it('múltiplas exceções — cada seção resolve pra sua própria linha, sem vazar pras demais', () => {
    const tipo = criarTipo({
      granularidade_padrao: null,
      excecoes_granularidade: [
        { secao_uuid: SECAO_AMACIANTE, secao_descricao: 'Amaciante', granularidade: 'LINHA' },
        { secao_uuid: SECAO_PILHAS, secao_descricao: 'Pilhas', granularidade: 'PRODUTO' },
      ],
    });
    expect(resolverGranularidade(tipo, SECAO_AMACIANTE)).toBe('LINHA');
    expect(resolverGranularidade(tipo, SECAO_PILHAS)).toBe('PRODUTO');
    expect(resolverGranularidade(tipo, 'secao-sem-exececao')).toBeNull();
  });

  it.each<GranularidadeResposta>(['LINHA', 'PRODUTO'])(
    'tipo "Ruptura" (eh_ruptura) resolve igual a qualquer outro tipo — %s não é caso especial na resolução',
    (granularidade) => {
      const ruptura = criarTipo({ descricao: 'Ruptura', eh_ruptura: true, granularidade_padrao: granularidade });
      expect(resolverGranularidade(ruptura, SECAO_AMACIANTE)).toBe(granularidade);
    },
  );
});
