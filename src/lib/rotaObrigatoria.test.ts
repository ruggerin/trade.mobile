import type { OrdemServico, Usuario } from '../types/api';
import { antesDaVez, exigeAgenda, exigeSequencia, filaDoDia, mensagemAntesDaVez } from './rotaObrigatoria';

const HOJE = '2026-10-14';

function usuario(userType: Usuario['user_type'], permissoes: string[]): Usuario {
  return { id: 'u1', user_type: userType, perfil: { id: 'p1', nome: 'Promotor', permissoes } } as Usuario;
}

function os(id: string, loja: string, horario: string | null, extra: Partial<OrdemServico> = {}): OrdemServico {
  return {
    id,
    usuario: { id: 'u1', nome: 'Ana' },
    ponto_venda: { id: `pdv-${id}`, fantasia: loja },
    horario_previsto: horario,
    prazo_fim: new Date(2026, 9, 14, 23, 59, 59).toISOString(),
    status: 'PENDENTE',
    ...extra,
  } as OrdemServico;
}

describe('rotaObrigatoria (docs/74)', () => {
  it('só vale com a marca, e nunca pra ADMIN', () => {
    expect(exigeAgenda(usuario('PROMOTOR', []))).toBe(false);
    expect(exigeAgenda(usuario('PROMOTOR', ['visitas.exigir_agenda']))).toBe(true);
    expect(exigeAgenda(usuario('ADMIN', ['visitas.exigir_agenda']))).toBe(false);
    // Sequência sem agenda não vale (a API do perfil nem deixa salvar).
    expect(exigeSequencia(usuario('PROMOTOR', ['visitas.exigir_sequencia']))).toBe(false);
    expect(exigeSequencia(usuario('GESTOR', ['visitas.exigir_agenda', 'visitas.exigir_sequencia']))).toBe(true);
  });

  it('ordena pelo horário previsto, sem horário por último, e desempata pelo id', () => {
    const fila = filaDoDia(
      [os('c', 'Sem horário', null), os('b', 'Tarde', '15:00'), os('z', 'Manhã 2', '09:00'), os('a', 'Manhã 1', '09:00')],
      'u1',
      HOJE,
    );

    expect(fila.map((o) => o.id)).toEqual(['a', 'z', 'b', 'c']);
  });

  it('fora da fila: concluída, cancelada, de outro dia, de outro promotor ou fila aberta', () => {
    const fila = filaDoDia(
      [
        os('ok', 'Hoje', '10:00'),
        os('feita', 'Concluída', '08:00', { status: 'CONCLUIDA' }),
        os('cancelada', 'Cancelada', '08:00', { status: 'CANCELADA' }),
        os('ontem', 'Ontem', '08:00', { prazo_fim: new Date(2026, 9, 13, 23, 59).toISOString() }),
        os('outro', 'Outro', '08:00', { usuario: { id: 'u2', nome: 'Bia' } }),
        os('aberta', 'Fila aberta', '08:00', { usuario: null }),
      ],
      'u1',
      HOJE,
    );

    expect(fila.map((o) => o.id)).toEqual(['ok']);
  });

  it('diz qual vem antes, com o mesmo texto da API', () => {
    const primeira = os('a', 'Mercado Centro', '09:00');
    const segunda = os('b', 'Mercado Norte', '11:00');
    const fila = filaDoDia([segunda, primeira], 'u1', HOJE);

    expect(antesDaVez(primeira, fila)).toBeNull();
    expect(antesDaVez(segunda, fila)?.id).toBe('a');
    expect(mensagemAntesDaVez(primeira)).toBe('Antes, atenda Mercado Centro (previsto 09:00).');
  });
});
