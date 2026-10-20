import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ClasseTag } from '../components/xp/ClasseTag';
import { buscarPontuacaoHoje, buscarPontuacaoSemana } from '../lib/api/xp';
import { useAuth } from '../lib/auth/AuthContext';
import { useEstaOnline } from '../lib/network';
import { formatarXp, rankingVisivel } from '../lib/xp';
import type { AgendaStackParamList } from '../navigation/AgendaStack';
import { amber, cores, espaco, indigo, neutro, raio, verde } from '../theme';
import type { PontuacaoHoje, PontuacaoSemana } from '../types/api';

type Navegacao = NativeStackNavigationProp<AgendaStackParamList>;

const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

/**
 * "Minha pontuação" (docs/88 §12.2.1). Hoje: XP do dia, ofensiva, liga, cada visita e a
 * iniciativa. Semana: total, barras por dia, aproveitamento, liga e conquistas. Sempre "o que
 * faltou", nunca "o que perdeu".
 */
export function MinhaPontuacaoScreen() {
  const [aba, setAba] = useState<'hoje' | 'semana'>('hoje');
  const online = useEstaOnline();

  return (
    <View style={styles.tela}>
      <View style={styles.abas}>
        {(['hoje', 'semana'] as const).map((a) => (
          <Pressable key={a} style={[styles.aba, aba === a && styles.abaAtiva]} onPress={() => setAba(a)} accessibilityRole="tab">
            <Text style={[styles.abaTexto, aba === a && styles.abaTextoAtivo]}>{a === 'hoje' ? 'Hoje' : 'Semana'}</Text>
          </Pressable>
        ))}
      </View>
      {!online && (
        <Text style={styles.offline}>Sem sinal: os números aparecem quando a conexão voltar. O que você faz agora conta quando enviar.</Text>
      )}
      {aba === 'hoje' ? <Hoje /> : <Semana />}
    </View>
  );
}

function Hoje() {
  const navigation = useNavigation<Navegacao>();
  const { usuario } = useAuth();
  const query = useQuery({ queryKey: ['xp', 'hoje'], queryFn: buscarPontuacaoHoje });
  if (query.isLoading) return <ActivityIndicator style={{ marginTop: espaco.xl }} color={cores.primaria} />;
  if (!query.data) return <Text style={styles.vazio}>Não foi possível carregar a pontuação agora.</Text>;
  const p: PontuacaoHoje = query.data;

  return (
    <ScrollView contentContainerStyle={styles.conteudo} refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />}>
      <View style={styles.cartaoDestaque}>
        <Text style={styles.total}>{formatarXp(p.total)} XP hoje</Text>
        <Text style={styles.sub}>
          {formatarXp(p.plano)} de {formatarXp(p.possivel)} do plano de hoje
          {p.iniciativa > 0 ? ` · +${formatarXp(p.iniciativa)} de iniciativa` : ''}
          {p.pendente ? ` · ${formatarXp(p.pendente)} aguardando avaliação` : ''}
        </Text>
        <View style={styles.chips}>
          <Chip icone="fire" texto={`${p.ofensiva} ${p.ofensiva === 1 ? 'dia seguido' : 'dias seguidos'}`} cor={amber[600]} />
          {p.liga && rankingVisivel(usuario) && (
            <Pressable onPress={() => navigation.navigate('RankingEquipe')}>
              <Chip icone="trophy-outline" texto={`${p.liga.posicao}º na liga ›`} cor={indigo[600]} />
            </Pressable>
          )}
        </View>
      </View>

      <Text style={styles.secao}>Visitas de hoje</Text>
      {p.visitas.length === 0 && <Text style={styles.vazio}>Nenhuma visita da agenda hoje.</Text>}
      {p.visitas.map((v) => {
        const perfeita = v.feita && v.ganho === v.possivel;
        return (
          <Pressable
            key={v.ordem_servico_id}
            style={styles.linha}
            disabled={!v.visita_id}
            onPress={() => v.visita_id && navigation.navigate('PontuacaoVisita', { visitaId: v.visita_id })}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.linhaTitulo} numberOfLines={1}>
                {v.loja}
              </Text>
              <View style={styles.linhaSub}>
                <Text style={styles.sub}>
                  {v.quando ?? v.horario ?? 'sem horário'}
                  {v.feita ? (perfeita ? ' · perfeita' : ` · faltaram ${formatarXp(v.possivel - (v.ganho ?? 0))}`) : ' · a fazer'}
                </Text>
                <ClasseTag classe={v.classe} />
              </View>
            </View>
            <Text style={[styles.xpLinha, v.feita ? { color: perfeita ? verde[700] : cores.texto } : { color: neutro[400] }]}>
              {v.feita ? `${formatarXp(v.ganho ?? 0)} / ${formatarXp(v.possivel)}` : `${formatarXp(v.possivel)} XP`}
            </Text>
            {v.visita_id && <MaterialCommunityIcons name="chevron-right" size={20} color={neutro[400]} />}
          </Pressable>
        );
      })}

      <Text style={styles.secao}>Iniciativa</Text>
      {p.iniciativas.length === 0 && <Text style={styles.vazio}>Ponto extra, validade próxima, estoque baixo e ruptura viram XP extra.</Text>}
      {p.iniciativas.map((i, idx) => (
        <View key={idx} style={styles.linha}>
          <View style={{ flex: 1 }}>
            <Text style={styles.linhaTitulo}>{i.descricao}</Text>
            {i.loja && <Text style={styles.sub}>{i.loja}</Text>}
          </View>
          <Text style={[styles.xpLinha, { color: i.situacao === 'ok' ? verde[700] : amber[700] }]}>
            +{formatarXp(i.pontos)}
            {i.situacao === 'pendente' ? ' aguardando' : ''}
          </Text>
        </View>
      ))}

      {p.dica && (
        <View style={styles.dica}>
          <MaterialCommunityIcons name="lightbulb-on-outline" size={18} color={indigo[600]} />
          <Text style={styles.dicaTexto}>Ainda dá pra ganhar mais hoje: {p.dica}</Text>
        </View>
      )}
    </ScrollView>
  );
}

function Semana() {
  const navigation = useNavigation<Navegacao>();
  const { usuario } = useAuth();
  const query = useQuery({ queryKey: ['xp', 'semana'], queryFn: buscarPontuacaoSemana });
  if (query.isLoading) return <ActivityIndicator style={{ marginTop: espaco.xl }} color={cores.primaria} />;
  if (!query.data) return <Text style={styles.vazio}>Não foi possível carregar a semana agora.</Text>;
  const s: PontuacaoSemana = query.data;
  const maior = Math.max(1, ...s.dias.map((d) => Math.max(d.xp, d.possivel)));

  return (
    <ScrollView contentContainerStyle={styles.conteudo} refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />}>
      <View style={styles.cartaoDestaque}>
        <Text style={styles.total}>{formatarXp(s.total)} XP na semana</Text>
        <Text style={styles.sub}>
          Aproveitamento do plano: {s.aproveitamento ?? '—'}%{s.aproveitamento_semana_passada !== null ? ` · semana passada: ${s.aproveitamento_semana_passada}%` : ''}
        </Text>
        <View style={styles.barras}>
          {s.dias.map((d, i) => (
            <View key={d.dia} style={styles.barraCol}>
              <View style={styles.barraFundo}>
                <View style={[styles.barraPossivel, { height: `${(d.possivel / maior) * 100}%` }]} />
                <View style={[styles.barraXp, { height: `${(d.xp / maior) * 100}%`, backgroundColor: d.hoje ? amber[500] : indigo[500] }]} />
              </View>
              <Text style={[styles.barraDia, d.hoje && { color: cores.texto, fontWeight: '800' }]}>{DIAS[i]}</Text>
            </View>
          ))}
        </View>
      </View>

      {s.liga && rankingVisivel(usuario) && (
        <Pressable style={styles.liga} onPress={() => navigation.navigate('RankingEquipe')}>
          <MaterialCommunityIcons name="trophy-outline" size={22} color={indigo[600]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.linhaTitulo}>
              {s.liga.posicao}º de {s.liga.participantes} na liga da equipe
            </Text>
            {s.liga.faltam_para_subir !== null && s.liga.nome_acima && (
              <Text style={styles.sub}>
                Faltam {formatarXp(s.liga.faltam_para_subir)} XP pra passar {s.liga.nome_acima}.
              </Text>
            )}
          </View>
          <Text style={styles.link}>Abrir ranking ›</Text>
        </Pressable>
      )}

      <Text style={styles.secao}>Conquistas</Text>
      <View style={styles.conquistas}>
        {s.conquistas.map((c) => (
          <View key={c.chave} style={[styles.conquista, c.conquistada && styles.conquistaFeita]}>
            <MaterialCommunityIcons name={c.conquistada ? 'medal' : 'medal-outline'} size={26} color={c.conquistada ? amber[600] : neutro[300]} />
            <Text style={styles.conquistaTitulo}>{c.titulo}</Text>
            <Text style={styles.conquistaSub}>{c.conquistada ? 'Conquistada' : `${Math.min(c.progresso, c.meta)} de ${c.meta}`}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Chip({ icone, texto, cor }: { icone: keyof typeof MaterialCommunityIcons.glyphMap; texto: string; cor: string }) {
  return (
    <View style={[styles.chip, { borderColor: cor }]}>
      <MaterialCommunityIcons name={icone} size={15} color={cor} />
      <Text style={[styles.chipTexto, { color: cor }]}>{texto}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },
  abas: { flexDirection: 'row', margin: espaco.lg, marginBottom: 0, backgroundColor: neutro[100], borderRadius: raio.md, padding: 3 },
  aba: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: raio.sm },
  abaAtiva: { backgroundColor: cores.fundoCard },
  abaTexto: { fontSize: 14, fontWeight: '600', color: cores.textoSecundario },
  abaTextoAtivo: { color: cores.texto },
  offline: { marginHorizontal: espaco.lg, marginTop: espaco.sm, fontSize: 12, color: amber[800] },
  conteudo: { padding: espaco.lg, gap: espaco.sm, paddingBottom: espaco.xxl },
  cartaoDestaque: { backgroundColor: cores.fundoCard, borderRadius: raio.lg, padding: espaco.lg, gap: 6, borderWidth: 1, borderColor: cores.borda },
  total: { fontSize: 26, fontWeight: '800', color: cores.texto },
  sub: { fontSize: 13, color: cores.textoSecundario },
  chips: { flexDirection: 'row', gap: espaco.sm, flexWrap: 'wrap', marginTop: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: raio.pill, paddingHorizontal: 10, paddingVertical: 4 },
  chipTexto: { fontSize: 12, fontWeight: '700' },
  secao: { fontSize: 15, fontWeight: '800', color: cores.texto, marginTop: espaco.md },
  vazio: { fontSize: 13, color: cores.textoSecundario, padding: espaco.lg },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm, backgroundColor: cores.fundoCard, borderRadius: raio.md, padding: espaco.md, borderWidth: 1, borderColor: cores.borda },
  linhaTitulo: { fontSize: 14, fontWeight: '700', color: cores.texto },
  linhaSub: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  xpLinha: { fontSize: 14, fontWeight: '800' },
  dica: { flexDirection: 'row', gap: espaco.sm, alignItems: 'flex-start', backgroundColor: indigo[50], borderRadius: raio.md, padding: espaco.md, marginTop: espaco.md },
  dicaTexto: { flex: 1, fontSize: 13, color: indigo[900] },
  barras: { flexDirection: 'row', gap: 6, height: 110, marginTop: espaco.md },
  barraCol: { flex: 1, alignItems: 'center', gap: 4 },
  barraFundo: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  barraPossivel: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: neutro[100], borderRadius: 4 },
  barraXp: { width: '100%', borderRadius: 4 },
  barraDia: { fontSize: 11, color: cores.textoSecundario },
  liga: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, backgroundColor: cores.fundoCard, borderRadius: raio.md, padding: espaco.md, borderWidth: 1, borderColor: cores.borda },
  link: { fontSize: 13, fontWeight: '700', color: indigo[600] },
  conquistas: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.sm },
  conquista: { width: '31%', alignItems: 'center', gap: 4, backgroundColor: cores.fundoCard, borderRadius: raio.md, padding: espaco.sm, borderWidth: 1, borderColor: cores.borda },
  conquistaFeita: { borderColor: amber[300], backgroundColor: amber[50] },
  conquistaTitulo: { fontSize: 12, fontWeight: '700', color: cores.texto, textAlign: 'center' },
  conquistaSub: { fontSize: 11, color: cores.textoSecundario },
});
