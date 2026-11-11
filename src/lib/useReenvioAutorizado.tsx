import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useState, type ReactElement } from 'react';
import { AutorizacaoGestorModal } from '../components/AutorizacaoGestorModal';
import { iniciarVisita } from './api/visitas';
import { ehErroDeRede } from './db/database';
import { restaurarRegistrosDescartados } from './db/filaRegistros';
import { restaurarVisitaRejeitada, type VisitaLocal } from './db/filaVisitas';
import { registrarEvento } from './diario';
import { montarCheckinPayload } from './filaEnvio';
import { tentarEnviarAgora } from './visitaLocal';

/**
 * Reenvio de check-in recusado com a autorização de um gestor (docs/114). O trabalho de uma visita
 * REJEITADA continua no aparelho (registros ficam DESCARTADO, fotos no disco até alguém descartar):
 * com o código ou a senha do gestor, o servidor aceita o check-in passando por cima de "outra visita
 * aberta", agenda e OS não-pendente (o raio continua valendo). Aceito, a visita volta pra fila no
 * passo em que estava e a fila manda registros, fotos e checkout como de costume.
 *
 * Online de propósito: o código é de uso único, não dá pra deixá-lo esperando numa fila offline.
 */
export function useReenvioAutorizado(usuarioId: string | undefined): {
  reenviar: (visita: VisitaLocal) => void;
  ocupado: boolean;
  elemento: ReactElement;
} {
  const queryClient = useQueryClient();
  const [visita, setVisita] = useState<VisitaLocal | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function reenviar(v: VisitaLocal) {
    setErro(null);
    setVisita(v);
  }

  async function enviar(credencial: { codigo: string } | { email: string; senha: string }) {
    if (!visita) return;
    setEnviando(true);
    setErro(null);
    try {
      const servidor = await iniciarVisita({
        ...montarCheckinPayload(visita),
        ...credencial,
        reenvio_autorizado: true,
        motivo: visita.erro ?? undefined,
      });
      await restaurarRegistrosDescartados(visita.id);
      await restaurarVisitaRejeitada(visita.id, servidor.id);
      registrarEvento('visita_reenviada', { servidorId: servidor.id }, visita.id);
      setVisita(null);
      void queryClient.invalidateQueries({ queryKey: ['visitas-locais-pendentes'] });
      void queryClient.invalidateQueries({ queryKey: ['visitas-locais-abertas'] });
      if (usuarioId) {
        void tentarEnviarAgora(usuarioId).finally(
          () => void queryClient.invalidateQueries({ queryKey: ['visitas-locais-pendentes'] }),
        );
      }
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      const mensagemServidor = axios.isAxiosError(err) ? (err.response?.data as { message?: string } | undefined)?.message : undefined;
      setErro(
        ehErroDeRede(err)
          ? 'Sem conexão com o servidor. Conecte-se e tente de novo.'
          : status === 429
            ? 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'
            : status === 403
              ? 'codigo' in credencial
                ? 'Autorização negada. Confira o código.'
                : 'Autorização negada. Confira o e-mail e a senha do gestor.'
              : (mensagemServidor ?? 'Não foi possível reenviar agora. Tente de novo.'),
      );
    } finally {
      setEnviando(false);
    }
  }

  const elemento = (
    <AutorizacaoGestorModal
      visible={visita !== null}
      enviando={enviando}
      erro={erro}
      motivo="O check-in desta visita foi recusado. Com a autorização de um gestor, ela é reenviada com tudo o que foi registrado."
      acao="Autorizar e reenviar"
      onEnviarCodigo={(codigo) => void enviar({ codigo })}
      onEnviarSenha={(email, senha) => void enviar({ email, senha })}
      onClose={() => setVisita(null)}
    />
  );

  return { reenviar, ocupado: enviando, elemento };
}
