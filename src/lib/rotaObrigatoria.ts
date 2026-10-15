import type { OrdemServico, Usuario } from '../types/api';

// Iniciar visita só pela agenda e seguir a sequência do dia (docs/74). As marcas moram no Perfil e
// RESTRINGEM: sem perfil, ou perfil sem a marca, nada muda. O servidor é quem decide de verdade
// (App\Support\RotaObrigatoria); aqui o app impede antes, pra não enfileirar um check-in que vai
// ser recusado.

function temMarca(usuario: Usuario | null, marca: string): boolean {
  if (!usuario || usuario.user_type === 'ADMIN') return false;
  return usuario.perfil?.permissoes?.includes(marca) ?? false;
}

export function exigeAgenda(usuario: Usuario | null): boolean {
  return temMarca(usuario, 'visitas.exigir_agenda');
}

export function exigeSequencia(usuario: Usuario | null): boolean {
  return exigeAgenda(usuario) && temMarca(usuario, 'visitas.exigir_sequencia');
}

/** Horário de atendimento: o previsto, no dia da fila; sem ele, o fim do prazo. */
function alvo(os: OrdemServico, hoje: string): number {
  if (os.horario_previsto) {
    const [h, m] = os.horario_previsto.split(':').map(Number);
    const [ano, mes, dia] = hoje.split('-').map(Number);
    return new Date(ano, mes - 1, dia, h, m).getTime();
  }
  return new Date(os.prazo_fim).getTime();
}

/**
 * Compromissos de hoje do usuário que ainda contam pra sequência, na ordem de atendimento — mesma
 * regra da API: pendente ou em andamento, prazo terminando hoje, ordenados pelo horário previsto
 * (senão o fim do prazo) e pelo id como desempate. Fila aberta (sem dono) não entra.
 */
export function filaDoDia(ordens: OrdemServico[], usuarioId: string, hoje: string): OrdemServico[] {
  return ordens
    .filter(
      (os) =>
        os.usuario?.id === usuarioId &&
        (os.status === 'PENDENTE' || os.status === 'EM_ANDAMENTO') &&
        paraDataLocal(os.prazo_fim) === hoje,
    )
    .sort((a, b) => alvo(a, hoje) - alvo(b, hoje) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** A OS que vem antes desta na fila de hoje, se houver — null quando é a da vez ou está fora da fila. */
export function antesDaVez(escolhida: OrdemServico, fila: OrdemServico[]): OrdemServico | null {
  const posicao = fila.findIndex((os) => os.id === escolhida.id);
  return posicao > 0 ? fila[0] : null;
}

/** "Antes, atenda Mercado Centro (previsto 09:00)." — mesmo texto da recusa da API. */
export function mensagemAntesDaVez(antes: OrdemServico): string {
  const previsto = antes.horario_previsto ? ` (previsto ${antes.horario_previsto.slice(0, 5)})` : '';
  return `Antes, atenda ${antes.ponto_venda.fantasia}${previsto}.`;
}

function paraDataLocal(iso: string): string {
  const d = new Date(iso);
  const dois = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}
