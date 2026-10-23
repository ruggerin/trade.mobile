import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth/AuthContext';
import {
  adiarItens,
  ativarItem,
  avaliarPreparo,
  preparoCompleto,
  type ItemPreparo,
  type ItemPreparoId,
} from '../lib/preparoAparelho';
import { cores, espaco, raio, verde, vermelho } from '../theme';

type IconeMdi = keyof typeof MaterialCommunityIcons.glyphMap;

const TEXTOS: Record<ItemPreparoId, { titulo: string; texto: string; icone: IconeMdi }> = {
  gps: { titulo: 'GPS ligado', texto: 'O localizador do celular precisa estar ativo.', icone: 'crosshairs-gps' },
  localizacao: { titulo: 'Localização', texto: 'Confirma que você está na loja no check-in.', icone: 'map-marker-outline' },
  sempre: {
    titulo: 'Localização o tempo todo',
    texto: 'Seu gestor acompanha a rota no expediente, mesmo com o app fechado.',
    icone: 'map-marker-path',
  },
  camera: { titulo: 'Câmera', texto: 'Fotos de gôndola, preço e evidências da visita.', icone: 'camera-outline' },
  notificacoes: { titulo: 'Notificações', texto: 'Avisos do seu gestor e de pedidos das suas lojas.', icone: 'bell-ring-outline' },
  bateria: {
    titulo: 'Bateria sem restrição',
    texto: 'Na lista que abrir, deixe o Horus "sem restrição" pra o Android não pausar o rastreamento.',
    icone: 'battery-heart-variant',
  },
  biometria: { titulo: 'Entrar com biometria', texto: 'Abra o app sem digitar e-mail e senha.', icone: 'fingerprint' },
};

// Primeiro acesso (lib/preparoAparelho.ts): checklist das permissões pra ativar de uma vez.
// "Permitir tudo" passa item por item, esperando o sistema devolver o controle a cada pedido.
export function PrepararAparelhoScreen({ onConcluir }: { onConcluir: () => void }) {
  const { usuario, biometria, definirBiometria } = useAuth();
  const insets = useSafeAreaInsets();
  const [itens, setItens] = useState<ItemPreparo[] | null>(null);
  const [ocupado, setOcupado] = useState<ItemPreparoId | null>(null);
  const emSequencia = useRef(false);
  const barra = useRef(new Animated.Value(0)).current;

  const reavaliar = useCallback(async () => {
    const novos = await avaliarPreparo({
      promotor: usuario?.user_type === 'PROMOTOR',
      biometria: biometria?.disponivel ? { ativa: biometria.ativa, perguntar: biometria.perguntar } : null,
    });
    setItens(novos);
    return novos;
  }, [usuario?.user_type, biometria?.disponivel, biometria?.ativa, biometria?.perguntar]);

  useEffect(() => {
    void reavaliar();
    // Voltou dos ajustes do Android (permissão liberada lá, bateria, GPS): relê.
    const assinatura = AppState.addEventListener('change', (estado) => {
      if (estado === 'active' && !emSequencia.current) void reavaliar();
    });
    return () => assinatura.remove();
  }, [reavaliar]);

  const resolvidos = itens?.filter((i) => i.estado === 'ok' || i.estado === 'adiado').length ?? 0;
  const total = itens?.length ?? 1;
  useEffect(() => {
    Animated.timing(barra, { toValue: resolvidos / total, duration: 350, useNativeDriver: false }).start();
  }, [barra, resolvidos, total]);

  async function ativar(item: ItemPreparo): Promise<ItemPreparo[]> {
    setOcupado(item.id);
    try {
      if (item.id === 'biometria') await definirBiometria(true);
      else await ativarItem(item);
    } finally {
      setOcupado(null);
    }
    return reavaliar();
  }

  /** "Localização o tempo todo" só depois da localização comum (o Android exige essa ordem). */
  const esperaDependencia = (item: ItemPreparo, lista: ItemPreparo[]) =>
    item.id === 'sempre' && lista.find((i) => i.id === 'localizacao')?.estado !== 'ok';

  async function permitirTudo() {
    if (!itens) return;
    emSequencia.current = true;
    try {
      const obrigatoriosOk = preparoCompleto(itens);
      let atual = itens;
      // Um de cada vez, na ordem da lista; o que o sistema não pergunta mais fica pro botão "Abrir ajustes".
      for (const { id } of itens) {
        const item = atual.find((i) => i.id === id);
        if (!item || item.estado === 'ok' || item.estado === 'adiado' || item.estado === 'bloqueado') continue;
        if (!obrigatoriosOk && !item.obrigatorio) continue;
        if (esperaDependencia(item, atual)) continue;
        atual = await ativar(item);
      }
    } finally {
      emSequencia.current = false;
    }
  }

  async function deixarParaDepois() {
    if (!itens) return;
    const pendentes = itens.filter((i) => !i.obrigatorio && i.estado !== 'ok' && i.estado !== 'adiado');
    await adiarItens(pendentes.filter((i) => i.id !== 'biometria').map((i) => i.id));
    // Biometria: a mesma resposta "agora não" da oferta pós-login — some dela também.
    if (pendentes.some((i) => i.id === 'biometria')) await definirBiometria(false);
    onConcluir();
  }

  if (!itens) {
    return (
      <View style={styles.carregando}>
        <ActivityIndicator color={cores.primaria} size="large" />
      </View>
    );
  }

  const obrigatoriosOk = preparoCompleto(itens);
  const recomendadosPendentes = itens.some((i) => !i.obrigatorio && i.estado !== 'ok' && i.estado !== 'adiado');
  const rotuloPrincipal = !obrigatoriosOk ? 'Permitir tudo' : recomendadosPendentes ? 'Ativar recomendados' : 'Continuar';
  const obrigatorios = itens.filter((i) => i.obrigatorio);
  const recomendados = itens.filter((i) => !i.obrigatorio);

  return (
    <View style={[styles.tela, { paddingTop: insets.top }]}>
      <View style={styles.topo}>
        <Text style={styles.eyebrow}>Primeiro acesso</Text>
        <Text style={styles.titulo} accessibilityRole="header">
          Vamos preparar seu celular
        </Text>
        <Text style={styles.subtitulo}>
          O Horus precisa destas permissões pra funcionar em campo. Ative agora e o app não vai te interromper durante as
          visitas.
        </Text>
        <View style={styles.progresso}>
          <View style={styles.barraFundo}>
            <Animated.View
              style={[styles.barraCheia, { width: barra.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}
            />
          </View>
          <Text style={styles.contagem}>
            {resolvidos} de {total}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.lista}>
        <Text style={styles.secao}>Obrigatório</Text>
        {obrigatorios.map((item) => (
          <Linha key={item.id} item={item} ocupado={ocupado === item.id} esperando={esperaDependencia(item, itens)} onAtivar={() => void ativar(item)} />
        ))}
        {recomendados.length > 0 && <Text style={styles.secao}>Recomendado</Text>}
        {recomendados.map((item) => (
          <Linha key={item.id} item={item} ocupado={ocupado === item.id} esperando={esperaDependencia(item, itens)} onAtivar={() => void ativar(item)} />
        ))}
      </ScrollView>

      <View style={[styles.rodape, { paddingBottom: espaco.lg + insets.bottom }]}>
        <Pressable
          style={({ pressed }) => [styles.botao, obrigatoriosOk && styles.botaoPronto, (pressed || ocupado !== null) && { opacity: 0.85 }]}
          disabled={ocupado !== null}
          onPress={() => (rotuloPrincipal === 'Continuar' ? onConcluir() : void permitirTudo())}
        >
          {ocupado !== null ? <ActivityIndicator color={cores.branco} /> : <Text style={styles.botaoTexto}>{rotuloPrincipal}</Text>}
        </Pressable>
        {obrigatoriosOk && recomendadosPendentes && (
          <Pressable style={styles.botaoSecundario} onPress={() => void deixarParaDepois()} disabled={ocupado !== null}>
            <Text style={styles.botaoSecundarioTexto}>Deixar os recomendados pra depois</Text>
          </Pressable>
        )}
        <Text style={styles.aviso}>
          {obrigatoriosOk
            ? 'Obrigatórios prontos. Os recomendados podem ficar pra depois.'
            : 'Localização e câmera são obrigatórias pra fazer visitas.'}
        </Text>
      </View>
    </View>
  );
}

function Linha({ item, ocupado, esperando, onAtivar }: { item: ItemPreparo; ocupado: boolean; esperando: boolean; onAtivar: () => void }) {
  const t = TEXTOS[item.id];
  const ok = item.estado === 'ok';
  const negado = item.estado === 'negado' || item.estado === 'bloqueado';
  const texto =
    item.estado === 'bloqueado'
      ? 'O Android não pergunta mais. Libere nos ajustes do Horus.'
      : item.estado === 'negado'
        ? item.obrigatorio
          ? 'Negado. Sem isso você não consegue fazer visitas.'
          : 'Negado. Dá pra tentar de novo quando quiser.'
        : esperando
          ? 'Ative a localização primeiro.'
          : t.texto;

  return (
    <View style={[styles.item, ok && styles.itemOk, negado && styles.itemNegado]}>
      <View style={[styles.icone, ok && styles.iconeOk, negado && styles.iconeNegado]}>
        <MaterialCommunityIcons name={t.icone} size={20} color={ok ? cores.sucesso : negado ? cores.erro : cores.primaria} />
      </View>
      <View style={styles.itemTextos}>
        <Text style={styles.itemTitulo}>{t.titulo}</Text>
        <Text style={[styles.itemTexto, negado && { color: cores.erro }]}>{texto}</Text>
      </View>
      {ok ? (
        <View style={styles.pronto}>
          <MaterialCommunityIcons name="check-bold" size={14} color={cores.sucesso} />
          <Text style={styles.prontoTexto}>Pronto</Text>
        </View>
      ) : item.estado === 'adiado' ? (
        <Pressable onPress={onAtivar} hitSlop={8} disabled={ocupado}>
          <Text style={styles.depoisTexto}>Ativar</Text>
        </Pressable>
      ) : (
        <Pressable
          style={({ pressed }) => [
            styles.acao,
            !item.obrigatorio && styles.acaoOpcional,
            item.estado === 'bloqueado' && styles.acaoAjustes,
            (pressed || esperando) && { opacity: 0.5 },
          ]}
          onPress={onAtivar}
          disabled={ocupado || esperando}
          accessibilityRole="button"
          accessibilityLabel={`${t.titulo}: ${item.estado === 'bloqueado' ? 'abrir ajustes' : 'ativar'}`}
        >
          {ocupado ? (
            <ActivityIndicator size="small" color={item.obrigatorio ? cores.branco : cores.primaria} />
          ) : (
            <Text style={[styles.acaoTexto, !item.obrigatorio && styles.acaoTextoOpcional, item.estado === 'bloqueado' && { color: cores.erro }]}>
              {item.estado === 'bloqueado' ? 'Abrir ajustes' : item.estado === 'negado' ? 'Tentar de novo' : 'Ativar'}
            </Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  carregando: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: cores.fundo },
  tela: { flex: 1, backgroundColor: cores.fundo },
  topo: { paddingHorizontal: espaco.xl, paddingTop: espaco.lg, paddingBottom: espaco.md },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: cores.primaria },
  titulo: { fontSize: 24, fontWeight: '800', color: cores.texto, marginTop: 4, letterSpacing: -0.2 },
  subtitulo: { fontSize: 14, color: cores.textoSecundario, lineHeight: 20, marginTop: 6 },
  progresso: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginTop: espaco.md },
  barraFundo: { flex: 1, height: 8, borderRadius: raio.pill, backgroundColor: cores.borda, overflow: 'hidden' },
  barraCheia: { height: '100%', borderRadius: raio.pill, backgroundColor: verde[600] },
  contagem: { fontSize: 12, fontWeight: '700', color: cores.textoSecundario, fontVariant: ['tabular-nums'] },
  lista: { paddingHorizontal: espaco.lg, paddingBottom: espaco.lg, gap: espaco.sm },
  secao: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: cores.textoTerciario,
    marginTop: espaco.sm,
    marginLeft: 4,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    backgroundColor: cores.fundoCard,
    borderRadius: raio.lg,
    borderWidth: 1,
    borderColor: cores.borda,
    padding: espaco.md,
  },
  itemOk: { borderColor: '#bbf7d0' },
  itemNegado: { borderColor: vermelho[200], backgroundColor: vermelho[50] },
  icone: { width: 40, height: 40, borderRadius: raio.md, backgroundColor: cores.primariaClara, alignItems: 'center', justifyContent: 'center' },
  iconeOk: { backgroundColor: cores.sucessoFundo },
  iconeNegado: { backgroundColor: cores.fundoCard },
  itemTextos: { flex: 1, minWidth: 0 },
  itemTitulo: { fontSize: 15, fontWeight: '700', color: cores.texto },
  itemTexto: { fontSize: 12, color: cores.textoSecundario, lineHeight: 17, marginTop: 1 },
  pronto: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  prontoTexto: { fontSize: 13, fontWeight: '700', color: cores.sucesso },
  depoisTexto: { fontSize: 13, fontWeight: '700', color: cores.primaria },
  acao: {
    minWidth: 72,
    minHeight: 34,
    paddingHorizontal: espaco.md,
    borderRadius: raio.pill,
    backgroundColor: cores.primaria,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acaoOpcional: { backgroundColor: cores.primariaClara },
  acaoAjustes: { backgroundColor: cores.fundoCard, borderWidth: 1, borderColor: vermelho[200] },
  acaoTexto: { fontSize: 13, fontWeight: '700', color: cores.branco },
  acaoTextoOpcional: { color: cores.primaria },
  rodape: {
    paddingHorizontal: espaco.lg,
    paddingTop: espaco.md,
    backgroundColor: cores.fundoCard,
    borderTopWidth: 1,
    borderTopColor: cores.borda,
    gap: espaco.xs,
  },
  botao: { minHeight: 54, borderRadius: raio.lg, backgroundColor: cores.primaria, alignItems: 'center', justifyContent: 'center' },
  botaoPronto: { backgroundColor: verde[600] },
  botaoTexto: { fontSize: 16, fontWeight: '700', color: cores.branco },
  botaoSecundario: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  botaoSecundarioTexto: { fontSize: 14, fontWeight: '600', color: cores.textoSecundario },
  aviso: { fontSize: 12, color: cores.textoTerciario, textAlign: 'center', marginTop: 2 },
});
