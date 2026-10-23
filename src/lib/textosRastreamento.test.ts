import type { SituacaoRastreamento } from './rastreamento';
import { textoSituacao } from './textosRastreamento';

// docs/47-RASTREAMENTO-EXIGENCIA.md §5.1 — todo motivo de o rastreamento não estar rodando precisa
// de um texto pro promotor, e os que ele consegue resolver precisam de um botão.
describe('textoSituacao', () => {
  const todas: SituacaoRastreamento[] = [
    'INDISPONIVEL',
    'FORA_DA_JORNADA',
    'NO_INTERVALO',
    'DESLIGADO_PELO_PROMOTOR',
    'PRECISA_PERMISSAO',
    'PERMISSAO_RECUSADA',
    'SO_DURANTE_USO',
    'GPS_DESLIGADO',
    'NAO_SUPORTADO',
    'FALHA_AO_INICIAR',
    'ATIVO',
  ];

  it('toda situação tem título', () => {
    for (const s of todas) expect(textoSituacao(s).titulo).not.toBe('');
  });

  it('situações que o promotor resolve pelo app têm botão de ação', () => {
    for (const s of ['PRECISA_PERMISSAO', 'PERMISSAO_RECUSADA', 'SO_DURANTE_USO', 'GPS_DESLIGADO', 'FALHA_AO_INICIAR'] as const) {
      expect(textoSituacao(s).acao).toBeTruthy();
    }
  });

  it('Expo Go não tem ação — só o APK resolve', () => {
    expect(textoSituacao('NAO_SUPORTADO').acao).toBeNull();
  });
});
