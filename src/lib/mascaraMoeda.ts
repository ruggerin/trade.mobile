// Máscara de valor em R$ "de caixa registradora": o promotor digita só números e a vírgula anda
// sozinha — 1 → "0,01", 1250 → "12,50", 123456 → "1.234,56". Nada de procurar vírgula/ponto no
// teclado numérico (que muda de aparelho pra aparelho).

const MAX_DIGITOS = 13; // até 99.999.999.999,99 — sobra pra qualquer preço

/** Aplica a máscara ao que foi digitado (ignora tudo que não é dígito). Vazio/zero → ''. */
export function mascararMoeda(digitado: string): string {
  const digitos = digitado.replace(/\D/g, '').replace(/^0+/, '').slice(0, MAX_DIGITOS);
  if (digitos === '') return '';

  const centavos = digitos.padStart(3, '0');
  const inteiro = centavos.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${inteiro},${centavos.slice(-2)}`;
}

/** Valor mascarado ("1.234,56") → o que a API espera ("1234.56"). '' continua ''. */
export function moedaParaApi(mascarado: string): string {
  return mascarado === '' ? '' : mascarado.replace(/\./g, '').replace(',', '.');
}

/** Número (ex.: 10.5 vindo da API) → valor mascarado ("10,50"). */
export function numeroParaMoeda(valor: number): string {
  return mascararMoeda(Math.round(valor * 100).toString());
}
