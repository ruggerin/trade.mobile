import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ClasseTag } from '../components/xp/ClasseTag';
import { buscarPontuacaoVisita } from '../lib/api/xp';
import { formatarXp } from '../lib/xp';
import type { AgendaStackParamList } from '../navigation/AgendaStack';
import { amber, cores, espaco, neutro, raio, verde } from '../theme';

export type PontuacaoVisitaParams = { visitaId: string };

type Props = NativeStackScreenProps<AgendaStackParamList, 'PontuacaoVisita'>;

const SITUACAO: Record<string, string> = {
  ok: 'contou',
  pendente: 'aguardando avaliação',
  reprovado: 'não aprovado pelo gestor',
  teto: 'passou do máximo da visita',
  repetido: 'já contou nesta loja há pouco',
};

/**
 * Pontuação da visita (docs/88 §12.2.1): o total, cada parte da composição com o que contou e o
 * motivo do que faltou, a iniciativa e os ajustes do gestor. Linguagem de "o que faltou".
 */
export function PontuacaoVisitaScreen({ route }: Props) {
  const query = useQuery({ queryKey: ['xp', 'visita', route.params.visitaId], queryFn: () => buscarPontuacaoVisita(route.params.visitaId) });

  if (query.isLoading) return <ActivityIndicator style={{ marginTop: espaco.xl }} color={cores.primaria} />;
  const p = query.data;
  if (!p) return <Text style={styles.vazio}>Não foi possível carregar a pontuação desta visita. Ela aparece quando a visita chegar ao servidor.</Text>;
  if (p.fora_da_agenda) return <Text style={styles.vazio}>Visita fora da agenda não gera XP. Só conta o que está numa OS.</Text>;

  return (
    <ScrollView style={styles.tela} contentContainerStyle={styles.conteudo}>
      <View style={styles.cartao}>
        <Text style={styles.loja}>{p.loja}</Text>
        {p.quando && <Text style={styles.sub}>{p.quando}</Text>}
        <View style={styles.totalLinha}>
          <Text style={styles.total}>
            {formatarXp(p.total)} de {formatarXp(p.possivel)} XP
          </Text>
          <ClasseTag classe={p.classe} />
        </View>
        <Text style={[styles.sub, p.faltou === 0 && { color: verde[700], fontWeight: '700' }]}>
          {p.faltou > 0 ? `Faltaram ${formatarXp(p.faltou)} XP pra visita perfeita.` : 'Visita perfeita.'}
        </Text>
      </View>

      <Text style={styles.secao}>Como você pontuou</Text>
      {p.partes.map((parte) => {
        const cheia = parte.ganho === parte.maximo;
        return (
          <View key={parte.parte} style={styles.parte}>
            <View style={styles.parteTopo}>
              <MaterialCommunityIcons name={cheia ? 'check-circle' : 'circle-half-full'} size={18} color={cheia ? verde[600] : amber[600]} />
              <Text style={styles.parteRotulo}>{parte.rotulo}</Text>
              <Text style={styles.parteXp}>
                {formatarXp(parte.ganho)} / {formatarXp(parte.maximo)}
              </Text>
            </View>
            <View style={styles.trilho}>
              <View style={[styles.trilhoCheio, { width: `${parte.maximo ? (parte.ganho / parte.maximo) * 100 : 0}%`, backgroundColor: cheia ? verde[600] : amber[500] }]} />
            </View>
            <Text style={styles.sub}>
              {parte.explicacao}
              {parte.pendente > 0 ? ` (+${formatarXp(parte.pendente)} quando o gestor avaliar)` : ''}
            </Text>
          </View>
        );
      })}

      {p.iniciativas.length > 0 && (
        <>
          <Text style={styles.secao}>Iniciativa nesta visita</Text>
          {p.iniciativas.map((i, idx) => (
            <View key={idx} style={styles.linha}>
              <Text style={styles.linhaTexto}>{i.descricao}</Text>
              <Text style={[styles.parteXp, { color: i.situacao === 'ok' ? verde[700] : neutro[500] }]}>
                {i.pontos > 0 ? `+${formatarXp(i.pontos)} · ` : ''}
                {SITUACAO[i.situacao] ?? i.situacao}
              </Text>
            </View>
          ))}
        </>
      )}

      {p.ajustes.length > 0 && (
        <>
          <Text style={styles.secao}>Ajustes do gestor</Text>
          {p.ajustes.map((a, idx) => (
            <View key={idx} style={styles.linha}>
              <Text style={styles.linhaTexto}>{a.motivo}</Text>
              <Text style={styles.parteXp}>
                {a.pontos > 0 ? '+' : ''}
                {formatarXp(a.pontos)} XP
              </Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.sm, paddingBottom: espaco.xxl },
  vazio: { padding: espaco.xl, fontSize: 14, color: cores.textoSecundario, textAlign: 'center' },
  cartao: { backgroundColor: cores.fundoCard, borderRadius: raio.lg, padding: espaco.lg, gap: 4, borderWidth: 1, borderColor: cores.borda },
  loja: { fontSize: 16, fontWeight: '800', color: cores.texto },
  sub: { fontSize: 13, color: cores.textoSecundario },
  totalLinha: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm, flexWrap: 'wrap', marginTop: 6 },
  total: { fontSize: 24, fontWeight: '800', color: cores.texto },
  secao: { fontSize: 15, fontWeight: '800', color: cores.texto, marginTop: espaco.md },
  parte: { backgroundColor: cores.fundoCard, borderRadius: raio.md, padding: espaco.md, gap: 6, borderWidth: 1, borderColor: cores.borda },
  parteTopo: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm },
  parteRotulo: { flex: 1, fontSize: 14, fontWeight: '700', color: cores.texto },
  parteXp: { fontSize: 13, fontWeight: '800', color: cores.texto },
  trilho: { height: 6, borderRadius: 3, backgroundColor: neutro[100], overflow: 'hidden' },
  trilhoCheio: { height: 6, borderRadius: 3 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm, backgroundColor: cores.fundoCard, borderRadius: raio.md, padding: espaco.md, borderWidth: 1, borderColor: cores.borda },
  linhaTexto: { flex: 1, fontSize: 14, color: cores.texto },
});
