// Escolha da OS do check-in quando a loja tem mais de uma pendente — mesma regra da API
// (App\Support\OrdemDoCheckin). Caso real de 13/10/2026: a vencida de domingo ganhava da de hoje.

jest.mock('./client', () => ({ apiClient: {} }));
jest.mock('../db/database', () => ({ ehErroDeRede: () => false }));
jest.mock('../db/ordensServicoCache', () => ({}));

import type { OrdemServico } from '../../types/api';
import { escolherOrdemDaLoja } from './ordensServico';

const agora = new Date(2026, 9, 13, 15, 0); // 13/10/2026 15h, horário local do aparelho

function os(id: string, inicio: [number, number], fim: [number, number], comFormulario = false): OrdemServico {
  return {
    id,
    prazo_inicio: new Date(2026, inicio[0] - 1, inicio[1], 0, 0).toISOString(),
    prazo_fim: new Date(2026, fim[0] - 1, fim[1], 23, 59).toISOString(),
    formularios: comFormulario ? [{ respondido_em: null }] : [],
  } as unknown as OrdemServico;
}

describe('escolherOrdemDaLoja', () => {
  it('a OS de hoje ganha da vencida de domingo (caso de produção)', () => {
    const domingo = os('domingo', [10, 11], [10, 11]);
    const hoje = os('hoje', [10, 13], [10, 13]);
    expect(escolherOrdemDaLoja([domingo, hoje], agora)?.id).toBe('hoje');
  });

  it('sem OS de hoje, vale a vencida mais recente (não a mais antiga)', () => {
    const semanaPassada = os('semana-passada', [10, 6], [10, 6]);
    const ontem = os('ontem', [10, 12], [10, 12]);
    expect(escolherOrdemDaLoja([semanaPassada, ontem], agora)?.id).toBe('ontem');
  });

  it('dentro do dia, formulário pendente primeiro (Direcionamento antes da Agenda)', () => {
    const agenda = os('agenda', [10, 13], [10, 13]);
    const direcionamento = os('direcionamento', [10, 10], [10, 20], true);
    expect(escolherOrdemDaLoja([agenda, direcionamento], agora)?.id).toBe('direcionamento');
  });

  it('vencida com formulário não ganha da OS de hoje', () => {
    const vencidaComForm = os('vencida', [10, 1], [10, 12], true);
    const hoje = os('hoje', [10, 13], [10, 13]);
    expect(escolherOrdemDaLoja([vencidaComForm, hoje], agora)?.id).toBe('hoje');
  });

  it('futura só entra quando não há de hoje nem vencida', () => {
    const amanha = os('amanha', [10, 14], [10, 14]);
    const ontem = os('ontem', [10, 12], [10, 12]);
    expect(escolherOrdemDaLoja([amanha, ontem], agora)?.id).toBe('ontem');
    expect(escolherOrdemDaLoja([amanha], agora)?.id).toBe('amanha');
  });

  it('lista vazia → nenhuma', () => {
    expect(escolherOrdemDaLoja([], agora)).toBeUndefined();
  });
});
