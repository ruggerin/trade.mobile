import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useState, type ReactElement } from 'react';
import { Alert } from 'react-native';
import { AutorizacaoGestorModal } from '../components/AutorizacaoGestorModal';
import { cancelarVisita, cancelarVisitaAutorizado } from './api/visitas';
import { excluirVisitaLocalCompleta, type VisitaLocal } from './db/filaVisitas';
import { ehErroDeRede } from './db/database';

/**
 * Descarte SEGURO de uma visita — usado na aba Registros e nos cards do Histórico. O servidor é quem
 * manda: se ele já conhece a visita, ela precisa ser cancelada LÁ (senão fica uma visita aberta órfã
 * segurando a ordem de serviço). Ordem de tentativas:
 *
 *  1. visita nunca chegou no servidor → só apaga daqui;
 *  2. cancelamento pelo próprio promotor (se a empresa permite);
 *  3. recusado (parâmetro desligado etc.) → pede a AUTORIZAÇÃO de um gestor (e-mail + senha);
 *  4. sem conexão → oferece "descartar só neste aparelho" (a visita continua aberta no servidor, mas
 *     o próximo check-in na mesma loja a retoma, então nada se perde nem duplica).
 */
type ResultadoTentativa = 'DESCARTADA' | 'PRECISA_AUTORIZACAO' | 'SEM_REDE';

async function tentarDescartar(visita: VisitaLocal): Promise<ResultadoTentativa> {
  if (!visita.servidorId) {
    await excluirVisitaLocalCompleta(visita.id, 'descarte-forcado');
    return 'DESCARTADA';
  }
  try {
    await cancelarVisita(visita.servidorId);
  } catch (err) {
    if (ehErroDeRede(err) || (axios.isAxiosError(err) && (err.response?.status ?? 0) >= 500)) return 'SEM_REDE';
    // 422 = o servidor diz que a visita já não está aberta (fechada/cancelada por outro caminho) —
    // não há mais nada a cancelar lá, pode apagar daqui.
    if (!(axios.isAxiosError(err) && err.response?.status === 422)) return 'PRECISA_AUTORIZACAO';
  }
  await excluirVisitaLocalCompleta(visita.id, 'descarte-forcado');
  return 'DESCARTADA';
}

export function useDescarteVisita(aoDescartar?: () => void): {
  descartar: (visita: VisitaLocal) => void;
  ocupado: boolean;
  elemento: ReactElement;
} {
  const queryClient = useQueryClient();
  const [ocupado, setOcupado] = useState(false);
  const [autorizando, setAutorizando] = useState<VisitaLocal | null>(null);
  const [erroAutorizacao, setErroAutorizacao] = useState<string | null>(null);

  function concluir() {
    setAutorizando(null);
    void queryClient.invalidateQueries({ queryKey: ['visitas-locais-abertas'] });
    void queryClient.invalidateQueries({ queryKey: ['visitas-locais-pendentes'] });
    aoDescartar?.();
  }

  async function soNesteAparelho(visita: VisitaLocal) {
    await excluirVisitaLocalCompleta(visita.id, 'descarte-forcado');
    concluir();
  }

  async function executar(visita: VisitaLocal) {
    setOcupado(true);
    try {
      const resultado = await tentarDescartar(visita);
      if (resultado === 'DESCARTADA') return concluir();
      if (resultado === 'PRECISA_AUTORIZACAO') {
        setErroAutorizacao(null);
        return setAutorizando(visita);
      }
      Alert.alert(
        'Sem conexão com o servidor',
        'Não deu para cancelar a visita lá. Se descartar só neste aparelho, a visita pode continuar aberta no servidor — mas ao abrir a mesma loja de novo o app retoma essa visita, sem duplicar. Descartar só neste aparelho?',
        [
          { text: 'Voltar', style: 'cancel' },
          { text: 'Descartar aqui', style: 'destructive', onPress: () => void soNesteAparelho(visita) },
        ],
      );
    } catch {
      Alert.alert('Erro', 'Não foi possível descartar esta visita. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  }

  function descartar(visita: VisitaLocal) {
    const aviso =
      visita.status === 'REJEITADA'
        ? `O check-in em ${visita.pontoVenda.fantasia} foi recusado${visita.erro ? `: ${visita.erro}` : ''}.`
        : `A visita em ${visita.pontoVenda.fantasia} será apagada${visita.erro ? ` (${visita.erro})` : ''}.`;
    Alert.alert(
      'Descartar visita',
      `${aviso} Tudo o que foi registrado nela (inclusive fotos) será perdido. Descartar mesmo assim?`,
      [
        { text: 'Voltar', style: 'cancel' },
        { text: 'Descartar', style: 'destructive', onPress: () => void executar(visita) },
      ],
    );
  }

  async function enviarAutorizacao(credencial: { codigo: string } | { email: string; senha: string }) {
    if (!autorizando) return;
    setOcupado(true);
    setErroAutorizacao(null);
    try {
      await cancelarVisitaAutorizado(autorizando.servidorId!, credencial);
      await excluirVisitaLocalCompleta(autorizando.id, 'descarte-forcado');
      concluir();
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      setErroAutorizacao(
        ehErroDeRede(err)
          ? 'Sem conexão com o servidor. Tente de novo ou descarte só neste aparelho.'
          : status === 429
            ? 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'
            : status === 403
              ? 'codigo' in credencial
                ? 'Autorização negada. Confira o código.'
                : 'Autorização negada. Confira o e-mail e a senha do gestor.'
              : 'Não foi possível autorizar agora. Tente de novo.',
      );
    } finally {
      setOcupado(false);
    }
  }

  const elemento = (
    <AutorizacaoGestorModal
      visible={autorizando !== null}
      enviando={ocupado}
      erro={erroAutorizacao}
      onEnviarCodigo={(codigo) => void enviarAutorizacao({ codigo })}
      onEnviarSenha={(email, senha) => void enviarAutorizacao({ email, senha })}
      onSoNesteAparelho={() => autorizando && void soNesteAparelho(autorizando)}
      onClose={() => setAutorizando(null)}
    />
  );

  return { descartar, ocupado, elemento };
}
