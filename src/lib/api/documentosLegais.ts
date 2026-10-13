import * as WebBrowser from 'expo-web-browser';
import type { DocumentoPendente, TipoDocumentoLegal, Usuario } from '../../types/api';
import { obterDeviceId } from '../auth/deviceId';
import { apiClient } from './client';

// Termos de Uso e Política de Privacidade — docs/58-ACEITE-TERMOS-E-PRIVACIDADE.md. Os textos são
// as páginas públicas da API (§5.2, as mesmas da Play Store), abertas no navegador embutido.

const SLUG: Record<TipoDocumentoLegal, string> = {
  TERMOS_USO: 'termos-de-uso',
  POLITICA_PRIVACIDADE: 'politica-de-privacidade',
};

export const TITULO_DOCUMENTO: Record<TipoDocumentoLegal, string> = {
  TERMOS_USO: 'Termos de Uso',
  POLITICA_PRIVACIDADE: 'Política de Privacidade',
};

/** Página pública do texto (raiz da API, sem /api); com `versao`, aquela versão exata. */
export function urlDocumento(tipo: TipoDocumentoLegal, versao?: string): string {
  const site = String(apiClient.defaults.baseURL ?? '').replace(/\/api\/?$/, '');
  return `${site}/${SLUG[tipo]}${versao ? `?versao=${encodeURIComponent(versao)}` : ''}`;
}

export async function abrirDocumento(tipo: TipoDocumentoLegal, versao?: string): Promise<void> {
  await WebBrowser.openBrowserAsync(urlDocumento(tipo, versao));
}

/** Registra o aceite das versões mostradas. 409 = publicaram versão nova com a tela aberta. */
export async function aceitarDocumentos(documentos: DocumentoPendente[]): Promise<{ usuario: Usuario }> {
  const { data } = await apiClient.post<{ usuario: Usuario }>('/auth/me/aceites', {
    documentos,
    dispositivo_identificador: await obterDeviceId(),
  });
  return data;
}

/** "2026-10-06" → "06/10/2026" (a versão é a data de última atualização do texto). */
export function versaoLegivel(versao: string): string {
  const [ano, mes, dia] = versao.split('-');
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : versao;
}
