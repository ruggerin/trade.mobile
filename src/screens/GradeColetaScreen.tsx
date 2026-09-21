import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { buscarCancelamentoRegistroPermitido } from '../lib/api/parametros';
import { useAuth } from '../lib/auth/AuthContext';
import type { RegistroLocal } from '../lib/db/filaRegistros';
import { listarTiposRegistro } from '../lib/api/tiposRegistro';
import { cancelarRegistroVisitaLocal, criarRegistroVisitaLocal, lerVisitaLocal, listarRegistrosLocais } from '../lib/visitaLocal';
import { resolverGranularidade } from '../lib/granularidadeChecklist';
import { chaveGrade as chave, contarProdutosRespondidos, resolverGrade } from '../lib/gradeColeta';
import type { PontosVendaStackParamList } from '../navigation/PontosVendaStack';
import type { TipoRegistro } from '../types/api';
import { cores, espaco, neutro, raio, sombraCard } from '../theme';

type Props = NativeStackScreenProps<PontosVendaStackParamList, 'GradeColeta'>;

// docs/16-GRANULARIDADE-CHECKLIST-AUDITORIA.md §9 (Fase 2) — checklist em grade pra uma
// linha/seção: em vez de repetir o ciclo completo de formulário por SKU, o promotor marca uma
// lista de produtos por pergunta, com "marcar todos" pra ir rápido. Ruptura é sempre a primeira
// coluna (Decisão 2, fixa): marcar um produto em ruptura tira ele das demais colunas da mesma
// linha — não faz sentido perguntar "ponto natural" de um produto que não está na prateleira.
//
// v1 (escopo desta rodada): só entram como coluna os TipoRegistro sem foto obrigatória e sem
// campos customizados — não dá pra "aplicar a todos" uma foto ou um campo de texto, cada um
// precisaria do formulário completo por SKU, o que a grade existe justamente pra evitar. Esses
// tipos continuam disponíveis do jeito de sempre (aba Produtos, Registro geral).
export function GradeColetaScreen({ route, navigation }: Props) {
  const { visitaLocalId, secaoUuid, secaoDescricao, produtos } = route.params;
  const { usuario } = useAuth();
  const queryClient = useQueryClient();
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);

  const visitaQuery = useQuery({ queryKey: ['visita-local', visitaLocalId], queryFn: () => lerVisitaLocal(visitaLocalId) });
  const registrosQuery = useQuery({ queryKey: ['registros-local', visitaLocalId], queryFn: () => listarRegistrosLocais(visitaLocalId) });
  const tiposRegistroQuery = useQuery({ queryKey: ['tipos-registro'], queryFn: listarTiposRegistro });
  const cancelamentoPermitidoQuery = useQuery({
    queryKey: ['cancelamento-registro-permitido'],
    queryFn: buscarCancelamentoRegistroPermitido,
  });
  const cancelamentoPermitido = cancelamentoPermitidoQuery.data ?? false;

  // Colunas aplicáveis a esta seção: granularidade resolvida PRODUTO (padrão do tipo, ou
  // exceção específica desta seção — mesma resolução de App\Support\GranularidadeChecklist no
  // backend), sem foto obrigatória, sem campos customizados. Ruptura sempre primeiro.
  const colunas = useMemo(() => {
    const tipos = (tiposRegistroQuery.data ?? []).filter((t) => {
      if (!t.ativo || (!t.icone && !t.eh_ruptura) || t.exige_foto || t.campos.length > 0) return false;
      return resolverGranularidade(t, secaoUuid) === 'PRODUTO';
    });
    const ruptura = tipos.filter((t) => t.eh_ruptura);
    const demais = tipos.filter((t) => !t.eh_ruptura).sort((a, b) => a.descricao.localeCompare(b.descricao));
    return [...ruptura, ...demais];
  }, [tiposRegistroQuery.data, secaoUuid]);

  const colunaRuptura = colunas.find((c) => c.eh_ruptura) ?? null;

  // Mapa (tipo × produto) -> registro já existente na visita, pra saber o que criar/cancelar no
  // diff do Salvar, e pra pré-marcar a grade com o que já foi feito antes de abrir esta tela.
  const registrosExistentes = useMemo(() => {
    const mapa = new Map<string, RegistroLocal>();
    for (const r of registrosQuery.data ?? []) {
      if (r.status === 'DESCARTADO' || !r.produtoAuditoriaUuid) continue;
      mapa.set(chave(r.tipoRegistroUuid, r.produtoAuditoriaUuid), r);
    }
    return mapa;
  }, [registrosQuery.data]);

  useEffect(() => {
    setMarcados(new Set(registrosExistentes.keys()));
  }, [registrosExistentes]);

  const produtosEmRuptura = useMemo(() => {
    if (!colunaRuptura) return new Set<string>();
    const set = new Set<string>();
    for (const p of produtos) {
      if (marcados.has(chave(colunaRuptura.id, p.uuid))) set.add(p.uuid);
    }
    return set;
  }, [marcados, colunaRuptura, produtos]);

  function alternar(tipo: TipoRegistro, produtoUuid: string) {
    const k = chave(tipo.id, produtoUuid);
    const jaExistia = registrosExistentes.has(k);
    if (jaExistia && !cancelamentoPermitido && marcados.has(k)) {
      Alert.alert('Não permitido', 'Cancelar um registro já feito não está liberado pra sua empresa.');
      return;
    }
    setMarcados((atual) => {
      const novo = new Set(atual);
      if (novo.has(k)) novo.delete(k);
      else novo.add(k);
      return novo;
    });
  }

  function marcarTodos(tipo: TipoRegistro) {
    setMarcados((atual) => {
      const novo = new Set(atual);
      for (const p of produtos) {
        if (tipo.eh_ruptura || !produtosEmRuptura.has(p.uuid)) novo.add(chave(tipo.id, p.uuid));
      }
      return novo;
    });
  }

  // Quantos produtos já têm ao menos uma resposta marcada — indicador de progresso no cabeçalho.
  const produtosRespondidos = useMemo(
    () => contarProdutosRespondidos(marcados, colunas, produtos),
    [marcados, colunas, produtos],
  );

  const salvarMutation = useMutation({
    mutationFn: async (marcadosFinais: Set<string>) => {
      if (!usuario) return;

      for (const tipo of colunas) {
        for (const produto of produtos) {
          const k = chave(tipo.id, produto.uuid);
          const marcadoAgora = marcadosFinais.has(k);
          const existiaAntes = registrosExistentes.has(k);

          if (marcadoAgora && !existiaAntes) {
            await criarRegistroVisitaLocal({
              usuarioId: usuario.id,
              visitaLocalId,
              produtoDescricao: produto.descricao,
              resultado: {
                tipoRegistroUuid: tipo.id,
                produtoAuditoriaUuid: produto.uuid,
                ruptura: tipo.eh_ruptura ? true : undefined,
              },
            });
          } else if (!marcadoAgora && existiaAntes) {
            const registro = registrosExistentes.get(k)!;
            await cancelarRegistroVisitaLocal(visitaQuery.data?.servidorId ?? null, registro);
          }
        }
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['registros-local', visitaLocalId] });
      navigation.goBack();
    },
    onError: () => setErro('Não foi possível salvar o checklist agora. Tente de novo.'),
  });

  function confirmarSalvar() {
    setErro(null);
    const { marcadosFinais, removidosPorRuptura } = resolverGrade(marcados, colunas, produtos, colunaRuptura);

    if (removidosPorRuptura.length === 0) {
      salvarMutation.mutate(marcadosFinais);
      return;
    }

    // Produto marcado em ruptura sempre sai das outras colunas (Decisão 2, fixa) — mas isso
    // pode apagar resposta que o promotor já tinha marcado antes de marcar a ruptura. Avisa em
    // vez de descartar silenciosamente, ver docs/16-GRANULARIDADE-CHECKLIST-AUDITORIA.md §9.
    const lista = removidosPorRuptura.map((r) => `• ${r.produtoDescricao} — ${r.tipoDescricao}`).join('\n');
    Alert.alert(
      'Ruptura vai apagar outras respostas',
      `Produto marcado em ruptura não conta pras outras perguntas. Isto vai ser removido:\n\n${lista}`,
      [
        { text: 'Revisar', style: 'cancel' },
        { text: 'Salvar mesmo assim', style: 'destructive', onPress: () => salvarMutation.mutate(marcadosFinais) },
      ],
    );
  }

  const carregando = visitaQuery.isLoading || registrosQuery.isLoading || tiposRegistroQuery.isLoading;

  if (carregando) {
    return (
      <View style={styles.centro}>
        <ActivityIndicator size="large" color={cores.primaria} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.cabecalho}>
        <Text style={styles.titulo}>{secaoDescricao}</Text>
        <Text style={styles.subtitulo}>
          Marque os produtos por pergunta. "Marcar todos" preenche a coluna inteira — só corrija
          as exceções.
        </Text>
        {colunas.length > 0 && (
          <Text style={styles.progresso}>
            {produtosRespondidos} de {produtos.length} produto(s) respondido(s)
          </Text>
        )}
      </View>

      {erro && (
        <View style={styles.erroBox}>
          <Text style={styles.erroTexto}>{erro}</Text>
        </View>
      )}

      {colunas.length === 0 ? (
        <View style={styles.centro}>
          <Text style={styles.vazioTexto}>
            Nenhuma pergunta configurada pra grade nesta seção ainda. Configure no admin web, em
            Tipos de Registro.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.lista}>
          {colunas.map((tipo) => (
            <View key={tipo.id} style={styles.secao}>
              <View style={styles.secaoTopo}>
                <Text style={styles.secaoTitulo}>{tipo.descricao}</Text>
                <Pressable onPress={() => marcarTodos(tipo)} hitSlop={8}>
                  <Text style={styles.linkMarcarTodos}>Marcar todos</Text>
                </Pressable>
              </View>
              {produtos.map((produto) => {
                const emRupturaNoutraColuna = !tipo.eh_ruptura && produtosEmRuptura.has(produto.uuid);
                const marcado = marcados.has(chave(tipo.id, produto.uuid));
                return (
                  <Pressable
                    key={produto.uuid}
                    style={[styles.linha, emRupturaNoutraColuna && styles.linhaDesabilitada]}
                    onPress={() => !emRupturaNoutraColuna && alternar(tipo, produto.uuid)}
                    disabled={emRupturaNoutraColuna}
                  >
                    <View style={[styles.checkbox, marcado && styles.checkboxMarcado]}>
                      {marcado && <Text style={styles.checkboxMarca}>✓</Text>}
                    </View>
                    <Text style={[styles.linhaTexto, emRupturaNoutraColuna && styles.linhaTextoDesabilitado]}>
                      {produto.descricao}
                      {emRupturaNoutraColuna ? ' (ruptura)' : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}

      <View style={styles.rodape}>
        <Pressable style={({ pressed }) => [styles.botaoSecundario, pressed && styles.botaoPressionado]} onPress={() => navigation.goBack()}>
          <Text style={styles.botaoSecundarioTexto}>Cancelar</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.botaoPrimario, pressed && styles.botaoPressionado]}
          onPress={confirmarSalvar}
          disabled={salvarMutation.isPending || colunas.length === 0}
        >
          {salvarMutation.isPending ? (
            <ActivityIndicator color={cores.onPrimaria} />
          ) : (
            <Text style={styles.botaoPrimarioTexto}>Salvar checklist</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: cores.fundo },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: espaco.xxl },
  cabecalho: {
    backgroundColor: cores.fundoCard,
    padding: espaco.xl,
    borderBottomWidth: 1,
    borderBottomColor: cores.divisor,
    gap: 4,
  },
  titulo: { fontSize: 20, fontWeight: '700', color: cores.texto },
  subtitulo: { fontSize: 13, color: cores.textoSecundario },
  progresso: { fontSize: 13, fontWeight: '600', color: cores.primaria, marginTop: 4 },
  erroBox: {
    backgroundColor: cores.erroFundo,
    borderWidth: 1,
    borderColor: cores.erroBorda,
    borderRadius: raio.md,
    padding: espaco.md,
    margin: espaco.lg,
    marginBottom: 0,
  },
  erroTexto: { color: cores.erro, fontSize: 14 },
  vazioTexto: { fontSize: 14, color: cores.textoSecundario, textAlign: 'center' },
  lista: { padding: espaco.lg, gap: espaco.xl },
  secao: {
    backgroundColor: cores.fundoCard,
    borderRadius: raio.lg,
    borderWidth: 1,
    borderColor: cores.borda,
    overflow: 'hidden',
    ...sombraCard,
  },
  secaoTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
    backgroundColor: neutro[100],
  },
  secaoTitulo: { fontSize: 14, fontWeight: '700', color: cores.texto },
  linkMarcarTodos: { fontSize: 13, fontWeight: '600', color: cores.primaria },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.md,
    borderTopWidth: 1,
    borderTopColor: neutro[100],
    minHeight: 48,
  },
  linhaDesabilitada: { backgroundColor: cores.fundo },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: cores.borda,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxMarcado: { backgroundColor: cores.primaria, borderColor: cores.primaria },
  checkboxMarca: { color: cores.branco, fontSize: 13, fontWeight: '700' },
  linhaTexto: { fontSize: 14, color: cores.texto, flex: 1 },
  linhaTextoDesabilitado: { color: cores.textoTerciario, textDecorationLine: 'line-through' },
  rodape: {
    flexDirection: 'row',
    gap: espaco.md,
    padding: espaco.lg,
    backgroundColor: cores.fundoCard,
    borderTopWidth: 1,
    borderTopColor: cores.divisor,
  },
  botaoSecundario: {
    flex: 1,
    minHeight: 52,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.borda,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoSecundarioTexto: { color: neutro[700], fontSize: 15, fontWeight: '700' },
  botaoPrimario: {
    flex: 2,
    minHeight: 52,
    borderRadius: raio.md,
    backgroundColor: cores.primaria,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoPrimarioTexto: { color: cores.onPrimaria, fontSize: 15, fontWeight: '700' },
  botaoPressionado: { opacity: 0.85 },
});
