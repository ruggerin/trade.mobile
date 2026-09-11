import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';

export class PermissaoLocalizacaoNegadaError extends Error {}

export interface Coordenadas {
  latitude: number;
  longitude: number;
}

// Usado tanto pra exibição (hook abaixo) quanto pra pegar uma leitura fresca na hora de
// confirmar check-in/checkout — nunca reaproveita a posição já exibida na tela, sempre lê de
// novo antes de mandar pro backend.
export async function obterLocalizacaoAtual(): Promise<Coordenadas> {
  const { status } = await Location.requestForegroundPermissionsAsync();

  if (status !== 'granted') {
    throw new PermissaoLocalizacaoNegadaError('Permissão de localização negada.');
  }

  const posicao = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });

  return { latitude: posicao.coords.latitude, longitude: posicao.coords.longitude };
}

interface EstadoLocalizacao {
  coords: Coordenadas | null;
  carregando: boolean;
  permissaoNegada: boolean;
  erro: string | null;
}

export function useLocalizacaoAtual() {
  const [estado, setEstado] = useState<EstadoLocalizacao>({
    coords: null,
    carregando: true,
    permissaoNegada: false,
    erro: null,
  });

  const atualizar = useCallback(async () => {
    setEstado((s) => ({ ...s, carregando: true, erro: null }));

    try {
      const coords = await obterLocalizacaoAtual();
      setEstado({ coords, carregando: false, permissaoNegada: false, erro: null });
    } catch (err) {
      if (err instanceof PermissaoLocalizacaoNegadaError) {
        setEstado({ coords: null, carregando: false, permissaoNegada: true, erro: null });
      } else {
        setEstado((s) => ({
          ...s,
          coords: null,
          carregando: false,
          erro: 'Não foi possível obter sua localização.',
        }));
      }
    }
  }, []);

  useEffect(() => {
    void atualizar();
  }, [atualizar]);

  return { ...estado, atualizar };
}
