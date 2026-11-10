// Selo de envio da visita no card (docs/110).

jest.mock('./db/filaRegistros', () => ({ listarRegistrosLocais: jest.fn() }));
jest.mock('./db/filaVisitas', () => ({ listarVisitasLocaisPendentesOuRejeitadas: jest.fn(), visitasConfirmadasNestaSessao: () => [] }));
jest.mock('./filaEnvio', () => ({ filaEnviandoAgora: () => false, filaEnvioEvents: new EventTarget(), FILA_ENVIO_INICIOU_EVENT: 'x' }));
jest.mock('./network', () => ({ useEstaOnline: () => true }));
jest.mock('./useFilaEnvioAtualizada', () => ({ useAoAtualizarFilaEnvio: () => {} }));

import type { VisitaLocal } from './db/filaVisitas';
import { seloDaConfirmada, seloDaVisitaLocal } from './statusEnvioVisita';

const visita = (parcial: Partial<VisitaLocal>) => ({ status: 'FINALIZADA_LOCAL', servidorId: 's1', erro: null, ...parcial }) as VisitaLocal;
const reg = (...status: ('PENDENTE' | 'ENVIADO' | 'ERRO' | 'DESCARTADO')[]) => status.map((s) => ({ status: s }));

it('finalizada sem internet: salva no celular', () => {
  const s = seloDaVisitaLocal({ visita: visita({}), registros: reg('PENDENTE'), online: false, enviando: false });
  expect(s).toMatchObject({ tipo: 'SALVA', rotulo: 'Salva no celular' });
  expect(s.detalhe).toMatch(/Sem internet/);
});

it('enviando: mostra o progresso dos registros (descartados não contam)', () => {
  const s = seloDaVisitaLocal({ visita: visita({}), registros: reg('ENVIADO', 'PENDENTE', 'DESCARTADO'), online: true, enviando: true });
  expect(s).toEqual({ tipo: 'ENVIANDO', rotulo: 'Enviando ao servidor', detalhe: '1 de 2 registros enviados' });
});

it('recusada ou com erro: não enviada', () => {
  expect(seloDaVisitaLocal({ visita: visita({ status: 'REJEITADA', erro: 'Fora do raio.' }), registros: [], online: true, enviando: false })).toMatchObject({
    tipo: 'NAO_ENVIADA',
    detalhe: 'Fora do raio. Toque para ver.',
  });
  expect(seloDaVisitaLocal({ visita: visita({}), registros: reg('ERRO'), online: true, enviando: false }).tipo).toBe('NAO_ENVIADA');
});

it('aberta: check-in na fila vs já no servidor', () => {
  expect(seloDaVisitaLocal({ visita: visita({ status: 'RASCUNHO', servidorId: null }), registros: [], online: false, enviando: false })).toMatchObject({
    tipo: 'EM_ANDAMENTO',
    rotulo: 'Em andamento · salva no celular',
  });
  expect(seloDaVisitaLocal({ visita: visita({ status: 'CHECKIN_ENVIADO' }), registros: [], online: true, enviando: false }).detalhe).toBeNull();
});

it('confirmada nesta sessão: enviada com a hora', () => {
  expect(seloDaConfirmada({ ordemServicoId: 'os1', pontoVendaId: 'p1', confirmadaEm: new Date(2026, 10, 10, 10, 31).toISOString() })).toEqual({
    tipo: 'ENVIADA',
    rotulo: '✓ Enviada',
    detalhe: 'Confirmada às 10:31.',
  });
});
