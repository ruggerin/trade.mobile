// Leitura do GPS com prazo (docs/109 §3.4): sem internet o `Accuracy.High` podia esperar sem fim.

jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
}));

import { lerPosicaoComPrazo, LocalizacaoDemorouError, ULTIMA_POSICAO_MAX_IDADE_MS, ULTIMA_POSICAO_PRECISAO_MAX_M } from './useLocalizacaoAtual';

const posicao = (lat: number, accuracy = 8) => ({ coords: { latitude: lat, longitude: -60, accuracy }, timestamp: 1 }) as never;
const depois = <T,>(ms: number, valor: T) => new Promise<T>((resolve) => setTimeout(() => resolve(valor), ms));
const nunca = () => new Promise<never>(() => {});

it('GPS no prazo: leitura nova, não aproximada', async () => {
  const r = await lerPosicaoComPrazo({ lerAtual: () => depois(5, posicao(1)), lerUltima: async () => null }, 50);
  expect(r).toMatchObject({ latitude: 1, precisaoMetros: 8, aproximada: false });
});

it('GPS demorou: usa a última posição recente e precisa, marcada como aproximada', async () => {
  const lerUltima = jest.fn(async () => posicao(2, 40));
  const r = await lerPosicaoComPrazo({ lerAtual: nunca, lerUltima }, 20);
  expect(r).toMatchObject({ latitude: 2, aproximada: true });
  expect(lerUltima).toHaveBeenCalledWith({ maxAge: ULTIMA_POSICAO_MAX_IDADE_MS, requiredAccuracy: ULTIMA_POSICAO_PRECISAO_MAX_M });
});

it('GPS demorou e não há posição recente: erro claro', async () => {
  await expect(lerPosicaoComPrazo({ lerAtual: nunca, lerUltima: async () => null }, 20)).rejects.toBeInstanceOf(LocalizacaoDemorouError);
});

it('erro do GPS (não é prazo) sem posição recente: repassa o erro original', async () => {
  const erro = new Error('provider off');
  await expect(lerPosicaoComPrazo({ lerAtual: () => Promise.reject(erro), lerUltima: async () => null }, 20)).rejects.toBe(erro);
  // Com posição recente, o erro do GPS também cai na última conhecida.
  expect(await lerPosicaoComPrazo({ lerAtual: () => Promise.reject(erro), lerUltima: async () => posicao(3) }, 20)).toMatchObject({ latitude: 3, aproximada: true });
});
