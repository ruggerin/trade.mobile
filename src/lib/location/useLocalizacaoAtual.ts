import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import { comPrazo, PrazoEstouradoError } from '../prazo';

export class PermissaoLocalizacaoNegadaError extends Error {}
/** O GPS não deu uma leitura no prazo e não havia posição recente pra usar no lugar. */
export class LocalizacaoDemorouError extends Error {}

export interface Coordenadas {
  latitude: number;
  longitude: number;
  /** Raio de incerteza em metros, quando o aparelho informa. */
  precisaoMetros?: number | null;
  /** Veio da última posição conhecida (o GPS não respondeu no prazo), não de uma leitura nova. */
  aproximada?: boolean;
}

/**
 * Quanto esperar uma leitura nova do GPS (docs/109 §3.4). `Accuracy.High` no Android usa o provedor
 * "fused", que sem internet (ou com internet lenta) perde a ajuda de Wi-Fi/rede e fica esperando
 * o GPS puro fixar — dentro de loja isso leva dezenas de segundos ou nunca termina, e o toque em
 * "Iniciar visita" ficava travado sem nenhum aviso. Estourou o prazo: usa a última posição conhecida
 * se for recente e precisa o bastante pro raio de check-in; senão, erro claro pro promotor.
 */
export const PRAZO_LEITURA_GPS_MS = 10_000;
export const ULTIMA_POSICAO_MAX_IDADE_MS = 60_000;
export const ULTIMA_POSICAO_PRECISAO_MAX_M = 150;

interface Deps {
  lerAtual: (opcoes: Location.LocationOptions) => Promise<Location.LocationObject>;
  lerUltima: (opcoes: Location.LocationLastKnownOptions) => Promise<Location.LocationObject | null>;
}

const depsReais: Deps = {
  lerAtual: (o) => Location.getCurrentPositionAsync(o),
  lerUltima: (o) => Location.getLastKnownPositionAsync(o),
};

function paraCoordenadas(p: Location.LocationObject, aproximada = false): Coordenadas {
  return { latitude: p.coords.latitude, longitude: p.coords.longitude, precisaoMetros: p.coords.accuracy ?? null, aproximada };
}

/** Leitura nova com prazo; estourou → última posição recente ou `LocalizacaoDemorouError`. Sem React, testável. */
export async function lerPosicaoComPrazo(deps: Deps = depsReais, prazoMs = PRAZO_LEITURA_GPS_MS): Promise<Coordenadas> {
  try {
    return paraCoordenadas(await comPrazo(deps.lerAtual({ accuracy: Location.Accuracy.High }), prazoMs));
  } catch (err) {
    const estourou = err instanceof PrazoEstouradoError;
    const ultima = await deps
      .lerUltima({ maxAge: ULTIMA_POSICAO_MAX_IDADE_MS, requiredAccuracy: ULTIMA_POSICAO_PRECISAO_MAX_M })
      .catch(() => null);
    if (ultima) return paraCoordenadas(ultima, true);
    if (estourou) throw new LocalizacaoDemorouError('O GPS demorou demais para responder.');
    throw err;
  }
}

// Usado tanto pra exibição (hook abaixo) quanto pra pegar uma leitura fresca na hora de
// confirmar check-in/checkout — nunca reaproveita a posição já exibida na tela, sempre lê de
// novo antes de mandar pro backend (com o prazo acima).
export async function obterLocalizacaoAtual(): Promise<Coordenadas> {
  const { status } = await Location.requestForegroundPermissionsAsync();

  if (status !== 'granted') {
    throw new PermissaoLocalizacaoNegadaError('Permissão de localização negada.');
  }

  return lerPosicaoComPrazo();
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

    // Mostra já a última posição conhecida (até 2 min) enquanto a leitura nova não chega — a tela
    // não fica em branco esperando o GPS fixar.
    void Location.getLastKnownPositionAsync({ maxAge: 2 * 60_000 })
      .then((ultima) => {
        if (ultima) setEstado((s) => (s.carregando && !s.coords ? { ...s, coords: paraCoordenadas(ultima, true) } : s));
      })
      .catch(() => {});

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
          erro:
            err instanceof LocalizacaoDemorouError
              ? 'O GPS demorou demais. Vá para um lugar mais aberto e toque em atualizar.'
              : 'Não foi possível obter sua localização.',
        }));
      }
    }
  }, []);

  useEffect(() => {
    void atualizar();
  }, [atualizar]);

  return { ...estado, atualizar };
}
