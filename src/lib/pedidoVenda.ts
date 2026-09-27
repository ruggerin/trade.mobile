import axios from 'axios';
import type { StatusPedidoVenda, Usuario } from '../types/api';
import { cores } from '../theme';

// Utilitários do Pedido de Venda no app — ver docs/38-PEDIDO-VENDEDOR.md.

// "Modo Vendedor" = perfil com pedidos_venda.criar (§4), numa empresa que contratou o módulo
// (§12 — sem ele a permissão não vale no backend). Sem UserType novo.
export function podeTirarPedido(usuario: Usuario | null): boolean {
  if (!usuario?.empresa?.pedidos_venda_habilitado) return false;
  return usuario.perfil?.permissoes?.includes('pedidos_venda.criar') ?? false;
}

// Mesma fórmula do backend (PedidoVendaItem::precoMinimo) — só pra avisar enquanto digita; quem
// decide de verdade se precisa de autorização é o servidor.
export function precoMinimo(precoTabela: number, descontoMaximoPct: number | null | undefined): number {
  return Math.round(precoTabela * (1 - (descontoMaximoPct ?? 0) / 100) * 100) / 100;
}

// Teclado do celular manda vírgula ("10,50"); ponto só é separador de milhar quando há vírgula.
export function numeroDigitado(v: string): number {
  const t = v.trim();
  if (t === '') return Number.NaN;
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
}

// Número → texto de campo em pt-BR, sem zeros à toa ("2", "2,5", "10,50" com casas=2 fixas).
export function paraCampo(valor: number, casasFixas?: number): string {
  const texto = casasFixas !== undefined ? valor.toFixed(casasFixas) : String(valor);
  return texto.replace('.', ',');
}

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatarMoeda(valor: number | null | undefined): string {
  return valor === null || valor === undefined || Number.isNaN(valor) ? '—' : moeda.format(valor);
}

export const STATUS_PEDIDO_VENDA: Record<StatusPedidoVenda, { label: string; cor: string; fundo: string }> = {
  RASCUNHO: { label: 'Rascunho', cor: cores.textoSecundario, fundo: cores.divisor },
  PENDENTE_AUTORIZACAO: { label: 'Aguardando autorização', cor: cores.acentoTexto, fundo: cores.acentoClaro },
  APROVADO: { label: 'Aprovado', cor: cores.primaria, fundo: cores.primariaClara },
  CONCLUIDO: { label: 'Concluído', cor: cores.sucesso, fundo: cores.sucessoFundo },
  CANCELADO: { label: 'Cancelado', cor: cores.textoTerciario, fundo: cores.divisor },
};

// Primeira mensagem de validação (422) ou `message` do servidor.
export function mensagemErroPedido(err: unknown, padrao: string): string {
  if (axios.isAxiosError<{ message?: string; errors?: Record<string, string[]> }>(err)) {
    if (!err.response) return 'Sem conexão — o pedido precisa de internet para ser salvo.';
    const erros = err.response.data?.errors;
    if (erros) return Object.values(erros)[0]?.[0] ?? padrao;
    return err.response.data?.message ?? padrao;
  }
  return padrao;
}
