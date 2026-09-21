import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cores, espaco, neutro } from '../theme';

type IconeMdi = keyof typeof MaterialCommunityIcons.glyphMap;

export interface AbaLoja<K extends string> {
  chave: K;
  rotulo: string;
  icone: IconeMdi;
  /** Número ao lado do nome (ex.: formulários pendentes em Ações). */
  selo?: number;
}

/**
 * Barra de abas da loja/visita. Todas as abas mostram ícone + nome o tempo todo (nada expande nem
 * recolhe ao trocar — a versão anterior mexia na largura de todas as abas a cada toque e errava o
 * toque seguinte) e a barra ROLA de lado quando não cabe. A aba selecionada é trazida pra vista.
 */
export function AbasLoja<K extends string>({
  abas,
  ativa,
  onChange,
}: {
  abas: AbaLoja<K>[];
  ativa: K;
  onChange: (chave: K) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const posicoes = useRef<Record<string, { x: number; largura: number }>>({});
  const larguraBarra = useRef(0);

  useEffect(() => {
    const pos = posicoes.current[ativa];
    if (!pos) return;
    // Centraliza a aba ativa; o scroll é limitado pelo próprio ScrollView nas pontas.
    scrollRef.current?.scrollTo({ x: Math.max(0, pos.x - (larguraBarra.current - pos.largura) / 2), animated: true });
  }, [ativa]);

  return (
    <View style={styles.barra} onLayout={(e) => (larguraBarra.current = e.nativeEvent.layout.width)}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.conteudo}
        accessibilityRole="tablist"
      >
        {abas.map((aba) => {
          const selecionada = aba.chave === ativa;
          return (
            <Pressable
              key={aba.chave}
              accessibilityRole="tab"
              accessibilityLabel={aba.rotulo}
              accessibilityState={{ selected: selecionada }}
              onPress={() => onChange(aba.chave)}
              onLayout={(e) => (posicoes.current[aba.chave] = { x: e.nativeEvent.layout.x, largura: e.nativeEvent.layout.width })}
              hitSlop={{ top: 6, bottom: 6 }}
              style={[styles.aba, selecionada && styles.abaAtiva]}
            >
              <MaterialCommunityIcons name={aba.icone} size={18} color={selecionada ? cores.primaria : neutro[500]} />
              <Text style={[styles.rotulo, selecionada && styles.rotuloAtivo]} numberOfLines={1}>
                {aba.rotulo}
              </Text>
              {!!aba.selo && aba.selo > 0 && (
                <View style={styles.selo}>
                  <Text style={styles.seloTexto}>{aba.selo}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  barra: {
    backgroundColor: cores.fundoCard,
    borderBottomWidth: 1,
    borderBottomColor: cores.divisor,
  },
  conteudo: { paddingHorizontal: espaco.sm },
  aba: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: espaco.md,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  abaAtiva: { borderBottomColor: cores.primaria },
  rotulo: { fontSize: 13, fontWeight: '600', color: neutro[500] },
  rotuloAtivo: { color: cores.primaria, fontWeight: '700' },
  selo: {
    backgroundColor: cores.acento,
    borderRadius: 99,
    paddingHorizontal: 6,
    minWidth: 18,
    alignItems: 'center',
  },
  seloTexto: { fontSize: 10, fontWeight: '800', color: cores.branco },
});
