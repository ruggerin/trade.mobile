import { useEffect, useState } from 'react';

// Atrasa a propagação de um valor que muda rápido (ex.: texto de busca digitado) — evita
// disparar uma requisição por tecla. Reaproveitável em qualquer busca-enquanto-digita do app.
export function useDebounce<T>(valor: T, atrasoMs = 300): T {
  const [valorAtrasado, setValorAtrasado] = useState(valor);

  useEffect(() => {
    const timer = setTimeout(() => setValorAtrasado(valor), atrasoMs);
    return () => clearTimeout(timer);
  }, [valor, atrasoMs]);

  return valorAtrasado;
}
