// Régua de XP (docs/88 §2.1, §13): o promotor só vê com o recurso de plano ligado e fora do modo prévia.

import type { Usuario } from '../types/api';
import { rankingVisivel, xpVisivel } from './xp';

const usuario = (empresa: Partial<NonNullable<Usuario['empresa']>> | null) => ({ empresa }) as unknown as Usuario;

describe('xpVisivel', () => {
  it('recurso desligado ou modo prévia escondem tudo', () => {
    expect(xpVisivel(null)).toBe(false);
    expect(xpVisivel(usuario({ controle_xp_habilitado: false, xp: { visivel_promotor: true, pendente_visivel_promotor: true, ranking_habilitado: true } }))).toBe(false);
    expect(xpVisivel(usuario({ controle_xp_habilitado: true, xp: { visivel_promotor: false, pendente_visivel_promotor: true, ranking_habilitado: true } }))).toBe(false);
  });

  it('ligado e liberado: mostra; a liga depende do parâmetro dela', () => {
    const u = usuario({ controle_xp_habilitado: true, xp: { visivel_promotor: true, pendente_visivel_promotor: true, ranking_habilitado: false } });
    expect(xpVisivel(u)).toBe(true);
    expect(rankingVisivel(u)).toBe(false);
  });
});
