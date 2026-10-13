// Regressão do teste no celular de 12/10/2026: no Expo Go real o módulo nativo de atestação não
// existe e importar @expo/app-integrity no topo derrubava o app antes da tela de login.

jest.mock('@expo/app-integrity', () => {
  throw new Error("Cannot find native module 'ExpoAppIntegrity'");
});
jest.mock('expo-constants', () => ({ __esModule: true, default: { executionEnvironment: 'standalone' }, ExecutionEnvironment: { StoreClient: 'storeClient' } }));
jest.mock('../api/client', () => ({
  apiClient: { post: jest.fn().mockResolvedValue({ data: { desafio: 'abc', obrigatoria: false, play_integrity_projeto: '123' } }) },
}));

describe('atestação sem o módulo nativo', () => {
  it('carregar o módulo do app não quebra', () => {
    expect(() => require('./atestacao')).not.toThrow();
  });

  it('obterAtestacao devolve null em vez de lançar', async () => {
    const { obterAtestacao } = require('./atestacao') as typeof import('./atestacao');
    await expect(obterAtestacao('chave', 'login')).resolves.toBeNull();
  });
});
