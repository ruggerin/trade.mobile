// Trava do check-out com formulário obrigatório de Direcionamento (DIRECIONAMENTO_BLOQUEIA_CHECKOUT)
// funcionando sem sinal: o parâmetro e os formulários da OS vêm do cache local.

const mockGet = jest.fn();
jest.mock('./client', () => ({ apiClient: { get: (...args: unknown[]) => mockGet(...args) } }));
jest.mock('../db/database', () => ({ ehErroDeRede: (err: { semRede?: boolean }) => Boolean(err?.semRede) }));

const mockLerParametrosCache = jest.fn();
jest.mock('../db/parametrosCache', () => ({
  lerParametrosCache: () => mockLerParametrosCache(),
  salvarParametrosCache: () => Promise.resolve(),
}));

const mockLerDetalhe = jest.fn();
const mockSalvarDetalhe = jest.fn((_os: unknown) => Promise.resolve());
jest.mock('../db/ordensServicoCache', () => ({
  lerOrdemServicoDetalheCache: (id: string) => mockLerDetalhe(id),
  salvarOrdemServicoDetalheCache: (os: unknown) => mockSalvarDetalhe(os),
  lerOrdensServicoCache: () => Promise.resolve([]),
  salvarOrdensServicoCache: () => Promise.resolve(),
}));

import { buscarOrdemServico } from './ordensServico';
import { buscarDirecionamentoBloqueiaCheckout } from './parametros';

const semRede = { semRede: true };

beforeEach(() => jest.clearAllMocks());

describe('buscarDirecionamentoBloqueiaCheckout', () => {
  it('ausente ou inativo não bloqueia (mesma regra do servidor)', async () => {
    mockGet.mockResolvedValueOnce({ data: { parametros: [] } });
    expect(await buscarDirecionamentoBloqueiaCheckout()).toBe(false);

    mockGet.mockResolvedValueOnce({ data: { parametros: [{ chave: 'DIRECIONAMENTO_BLOQUEIA_CHECKOUT', valor: 'true', ativo: false }] } });
    expect(await buscarDirecionamentoBloqueiaCheckout()).toBe(false);
  });

  it('ativo com valor verdadeiro bloqueia', async () => {
    mockGet.mockResolvedValueOnce({ data: { parametros: [{ chave: 'DIRECIONAMENTO_BLOQUEIA_CHECKOUT', valor: 'Sim', ativo: true }] } });
    expect(await buscarDirecionamentoBloqueiaCheckout()).toBe(true);
  });

  it('sem sinal, lê o último valor salvo no aparelho', async () => {
    mockGet.mockRejectedValueOnce(semRede);
    mockLerParametrosCache.mockResolvedValueOnce([{ chave: 'DIRECIONAMENTO_BLOQUEIA_CHECKOUT', valor: 'true', ativo: true }]);
    expect(await buscarDirecionamentoBloqueiaCheckout()).toBe(true);
  });
});

describe('buscarOrdemServico', () => {
  it('com sinal, guarda o detalhe da OS pra visita seguir offline', async () => {
    const os = { id: 'os-1', formularios: [{ obrigatorio: true, respondido_em: null }] };
    mockGet.mockResolvedValueOnce({ data: { ordem_servico: os } });

    expect(await buscarOrdemServico('os-1')).toBe(os);
    expect(mockSalvarDetalhe).toHaveBeenCalledWith(os);
  });

  it('sem sinal, devolve a OS do cache', async () => {
    const os = { id: 'os-1', formularios: [] };
    mockGet.mockRejectedValueOnce(semRede);
    mockLerDetalhe.mockResolvedValueOnce(os);

    expect(await buscarOrdemServico('os-1')).toBe(os);
  });

  it('sem sinal e sem cache, repassa o erro', async () => {
    mockGet.mockRejectedValueOnce(semRede);
    mockLerDetalhe.mockResolvedValueOnce(null);

    await expect(buscarOrdemServico('os-1')).rejects.toBe(semRede);
  });

  it('erro do servidor não cai pro cache', async () => {
    const erro = { response: { status: 404 } };
    mockGet.mockRejectedValueOnce(erro);

    await expect(buscarOrdemServico('os-1')).rejects.toBe(erro);
    expect(mockLerDetalhe).not.toHaveBeenCalled();
  });
});
