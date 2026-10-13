import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { headersAutenticados } from './chaveAparelho';

/**
 * Headers (Authorization + assinatura do aparelho, docs/67 Fase 3) pra um <Image> que busca da
 * API. null até ficarem prontos — a imagem só deve ser montada depois, senão vai sem assinatura.
 * Recalcula a cada montagem: a assinatura tem validade de minutos.
 */
export function useHeadersAutenticados(url: string | null | undefined): Record<string, string> | null {
  const { token } = useAuth();
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    let cancelado = false;
    setHeaders(null);
    if (url && token) {
      void headersAutenticados(url, token).then((h) => {
        if (!cancelado) setHeaders(h);
      });
    }
    return () => {
      cancelado = true;
    };
  }, [url, token]);

  return headers;
}
