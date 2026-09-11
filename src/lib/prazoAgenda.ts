export const DIAS_RAPIDOS = [
  { rotulo: 'Hoje', offset: 0 },
  { rotulo: 'Amanhã', offset: 1 },
  { rotulo: '+2 dias', offset: 2 },
  { rotulo: '+3 dias', offset: 3 },
  { rotulo: '+4 dias', offset: 4 },
  { rotulo: '+5 dias', offset: 5 },
  { rotulo: '+6 dias', offset: 6 },
];

/**
 * Prazo de um dia (offset em dias a partir de hoje, no calendário LOCAL do aparelho) como par
 * início/fim, já em UTC — sem passar por `Date.toISOString()` em cima de hora local. Fazer
 * `new Date` com hora local 23:59:59 e depois `.toISOString()` desloca a data em fusos
 * atrás de UTC (todo o Brasil): 23:59:59 local vira madrugada do dia seguinte em UTC, e esse
 * prazo_fim "vaza" pro dia seguinte no filtro `whereDate` da Agenda (OrdemServicoController::index),
 * sumindo da aba "Hoje". Construindo a string UTC direto a partir do dia calendário local, o
 * prazo bate com a mesma data que a Agenda usa pra filtrar (AgendaScreen.paraDataISO).
 */
export function prazoDoDia(offset: number): { prazo_inicio: string; prazo_fim: string } {
  const dia = new Date();
  dia.setDate(dia.getDate() + offset);
  const diaISO = `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, '0')}-${String(dia.getDate()).padStart(2, '0')}`;
  return {
    prazo_inicio: `${diaISO}T00:00:00.000Z`,
    prazo_fim: `${diaISO}T23:59:59.000Z`,
  };
}
