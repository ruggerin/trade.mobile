/**
 * Paleta única do app — índigo como cor primária (ações, links, seleção), âmbar como cor de
 * destaque/acento (pendências, chaves, indicadores que precisam chamar atenção sem ser erro).
 * Escalas seguem a mesma numeração do Tailwind (50 claro → 900 escuro) pra facilitar referência
 * cruzada com o admin web, que já usa índigo/âmbar via MUI.
 */
export const indigo = {
  50: '#eef2ff',
  100: '#e0e7ff',
  200: '#c7d2fe',
  300: '#a5b4fc',
  400: '#818cf8',
  500: '#6366f1',
  600: '#4f46e5',
  700: '#4338ca',
  800: '#3730a3',
  900: '#312e81',
} as const;

export const amber = {
  50: '#fffbeb',
  100: '#fef3c7',
  200: '#fde68a',
  300: '#fcd34d',
  400: '#fbbf24',
  500: '#f59e0b',
  600: '#d97706',
  700: '#b45309',
  800: '#92400e',
  900: '#78350f',
} as const;

export const neutro = {
  0: '#ffffff',
  50: '#f9fafb',
  100: '#f3f4f6',
  200: '#e5e7eb',
  300: '#d1d5db',
  400: '#9ca3af',
  500: '#6b7280',
  600: '#4b5563',
  700: '#374151',
  800: '#1f2937',
  900: '#111827',
} as const;

export const vermelho = {
  50: '#fef2f2',
  100: '#fee2e2',
  200: '#fecaca',
  600: '#dc2626',
  700: '#b91c1c',
  800: '#991b1b',
} as const;

export const verde = {
  50: '#f0fdf4',
  600: '#16a34a',
  700: '#15803d',
} as const;

/** Tokens semânticos — o que cada tela deveria importar, em vez da escala numérica direto. */
export const cores = {
  primaria: indigo[600],
  primariaEscura: indigo[700],
  primariaClara: indigo[50],
  primariaMedia: indigo[100],
  primariaBorda: indigo[300],
  onPrimaria: neutro[0],

  acento: amber[500],
  acentoEscuro: amber[700],
  acentoTexto: amber[800],
  acentoClaro: amber[50],
  acentoMedio: amber[100],
  acentoBorda: amber[200],

  texto: neutro[900],
  textoSecundario: neutro[500],
  textoTerciario: neutro[400],

  fundo: neutro[50],
  fundoCard: neutro[0],
  divisor: neutro[100],
  borda: neutro[200],
  bordaForte: neutro[300],

  sucesso: verde[700],
  sucessoTexto: verde[700],
  sucessoFundo: verde[50],

  erro: vermelho[700],
  erroTexto: vermelho[700],
  erroFundo: vermelho[50],
  erroBorda: vermelho[200],
  erroForte: vermelho[800],

  branco: neutro[0],
  preto: '#000000',
} as const;
