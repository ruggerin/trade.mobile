import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ImagemAutenticada } from '../components/ImagemAutenticada';
import { buscarRankingEquipe, type PeriodoRanking } from '../lib/api/xp';
import { formatarXp } from '../lib/xp';
import { amber, cores, espaco, indigo, neutro, raio } from '../theme';

const iniciais = (nome: string) =>
  nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

/**
 * Ranking da equipe (docs/88 §12.4, protótipo v3). O promotor vê o pódio, a própria posição e
 * quem está logo acima; os demais só como contagem. Semana fechada não muda mais.
 */
export function RankingEquipeScreen() {
  const [escala, setEscala] = useState<'semana' | 'mes'>('semana');
  const [anterior, setAnterior] = useState(false);
  const periodo: PeriodoRanking = escala === 'semana' ? (anterior ? 'passada' : 'atual') : anterior ? 'mes_passado' : 'mes';
  const query = useQuery({ queryKey: ['xp', 'ranking', periodo], queryFn: () => buscarRankingEquipe(periodo) });
  const r = query.data;
  const podio = (r?.linhas ?? []).filter((l) => l.posicao <= 3);
  const resto = (r?.linhas ?? []).filter((l) => l.posicao > 3);
  // Pódio na ordem 2º, 1º, 3º.
  const ordemPodio = [podio.find((l) => l.posicao === 2), podio.find((l) => l.posicao === 1), podio.find((l) => l.posicao === 3)];

  return (
    <ScrollView style={styles.tela} contentContainerStyle={styles.conteudo}>
      <View style={styles.abas}>
        {(['semana', 'mes'] as const).map((e) => (
          <Pressable key={e} style={[styles.aba, escala === e && styles.abaAtiva]} onPress={() => setEscala(e)}>
            <Text style={[styles.abaTexto, escala === e && styles.abaTextoAtivo]}>{e === 'semana' ? 'Semana' : 'Mês'}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.abas}>
        {[false, true].map((a) => (
          <Pressable key={String(a)} style={[styles.aba, anterior === a && styles.abaAtiva]} onPress={() => setAnterior(a)}>
            <Text style={[styles.abaTexto, anterior === a && styles.abaTextoAtivo]}>
              {escala === 'semana' ? (a ? 'Semana passada' : 'Esta semana') : a ? 'Mês passado' : 'Este mês'}
            </Text>
          </Pressable>
        ))}
      </View>
      {query.isLoading && <ActivityIndicator style={{ marginTop: espaco.xl }} color={cores.primaria} />}
      {!query.isLoading && !r && <Text style={styles.sub}>Não foi possível carregar o ranking agora.</Text>}
      {r && (
        <>
          <Text style={styles.grupo}>{r.grupo}</Text>
          <Text style={styles.sub}>
            {r.fechada
              ? r.periodo === 'mes'
                ? 'Mês fechado.'
                : 'Semana fechada: não muda mais, mesmo que um XP seja aprovado depois.'
              : r.periodo === 'mes'
                ? 'Fecha no dia 1º, 00h.'
                : 'Fecha segunda, 00h.'}
          </Text>

          <View style={styles.podio}>
            {ordemPodio.map((l, i) =>
              l ? (
                <View key={l.posicao} style={[styles.degrau, { paddingTop: i === 1 ? 0 : 18 }]}>
                  {l.posicao === 1 && <MaterialCommunityIcons name="crown" size={20} color={amber[500]} />}
                  <Avatar nome={l.nome} fotoUrl={l.foto_url} eu={l.eu} tamanho={l.posicao === 1 ? 58 : 46} />
                  <Text style={styles.podioNome} numberOfLines={1}>
                    {l.eu ? 'Você' : l.nome.split(' ')[0]}
                  </Text>
                  <Text style={styles.podioXp}>{formatarXp(l.xp)} XP</Text>
                  <View style={[styles.base, { height: l.posicao === 1 ? 46 : l.posicao === 2 ? 32 : 22 }]}>
                    <Text style={styles.baseTexto}>{l.posicao}º</Text>
                  </View>
                </View>
              ) : (
                <View key={`vazio-${i}`} style={styles.degrau} />
              ),
            )}
          </View>

          {r.eu ? (
            <View style={styles.eu}>
              <Text style={styles.euPosicao}>{r.eu.posicao}º</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.linhaTitulo}>Sua posição</Text>
                <Text style={styles.sub}>
                  {r.eu.aproveitamento !== null ? `${r.eu.aproveitamento}% do plano · ` : ''}
                  {formatarXp(r.eu.iniciativa)} de iniciativa
                </Text>
              </View>
              <Text style={styles.euXp}>{formatarXp(r.eu.xp)} XP</Text>
            </View>
          ) : (
            <Text style={styles.sub}>Você não entrou na liga desta semana (mínimo de {r.minimo_visitas} visitas agendadas).</Text>
          )}

          {resto.length > 0 && (
            <>
              <Text style={styles.secao}>Perto de você</Text>
              {resto.map((l) => (
                <View key={l.posicao} style={[styles.linha, l.eu && styles.linhaEu]}>
                  <Text style={styles.posicao}>{l.posicao}º</Text>
                  <Avatar nome={l.nome} fotoUrl={l.foto_url} eu={l.eu} tamanho={32} />
                  <Text style={styles.linhaTitulo}>{l.eu ? 'Você' : l.nome}</Text>
                  <Text style={styles.linhaXp}>{formatarXp(l.xp)} XP</Text>
                </View>
              ))}
            </>
          )}
          {r.escondidos > 0 && <Text style={styles.sub}>+ {r.escondidos} colegas da equipe</Text>}

          {r.alvo && !r.fechada && (
            <View style={styles.alvo}>
              <Text style={styles.linhaTitulo}>
                Faltam {formatarXp(r.alvo.faltam)} XP pra passar {r.alvo.nome.split(' ')[0]}.
              </Text>
              <View style={styles.trilho}>
                <View style={[styles.trilhoCheio, { width: `${Math.min(100, (r.alvo.de / Math.max(1, r.alvo.ate)) * 100)}%` }]} />
              </View>
            </View>
          )}

          <Text style={styles.secao}>Como a liga funciona</Text>
          <Text style={styles.regra}>• Conta o XP da semana: visitas da agenda mais iniciativa aprovada.</Text>
          <Text style={styles.regra}>
            • Compete só com a sua equipe e zera {r.periodo === 'mes' ? 'todo dia 1º' : 'toda segunda'}, 00h.
          </Text>
          <Text style={styles.regra}>
            • Precisa de pelo menos {r.minimo_visitas} visitas agendadas {r.periodo === 'mes' ? 'no mês' : 'na semana'} pra entrar.
          </Text>
          <Text style={styles.regra}>• Empate: ganha quem teve mais visitas completas.</Text>
        </>
      )}
    </ScrollView>
  );
}

// Foto do cadastro (rota autenticada); sem foto, as iniciais.
function Avatar({ nome, fotoUrl, eu, tamanho }: { nome: string; fotoUrl?: string | null; eu: boolean; tamanho: number }) {
  const forma = { width: tamanho, height: tamanho, borderRadius: tamanho / 2 };
  if (fotoUrl) {
    return <ImagemAutenticada uri={fotoUrl} style={[forma, eu && styles.fotoEu]} />;
  }
  return (
    <View style={[styles.avatar, forma, eu && styles.avatarEu]}>
      <Text style={[styles.avatarTexto, eu && { color: cores.onPrimaria }]}>{iniciais(nome)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fotoEu: { borderWidth: 2, borderColor: indigo[600] },
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.sm, paddingBottom: espaco.xxl },
  abas: { flexDirection: 'row', backgroundColor: neutro[100], borderRadius: raio.md, padding: 3 },
  aba: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: raio.sm },
  abaAtiva: { backgroundColor: cores.fundoCard },
  abaTexto: { fontSize: 14, fontWeight: '600', color: cores.textoSecundario },
  abaTextoAtivo: { color: cores.texto },
  grupo: { fontSize: 16, fontWeight: '800', color: cores.texto, marginTop: espaco.sm },
  sub: { fontSize: 13, color: cores.textoSecundario },
  podio: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: espaco.sm, marginTop: espaco.md },
  degrau: { flex: 1, alignItems: 'center', gap: 4 },
  avatar: { width: 46, height: 46, borderRadius: 999, backgroundColor: indigo[100], alignItems: 'center', justifyContent: 'center' },
  avatarEu: { backgroundColor: indigo[600] },
  avatarTexto: { fontSize: 15, fontWeight: '800', color: indigo[900] },
  podioNome: { fontSize: 13, fontWeight: '700', color: cores.texto },
  podioXp: { fontSize: 12, color: cores.textoSecundario },
  base: { width: '100%', backgroundColor: indigo[50], borderTopLeftRadius: raio.sm, borderTopRightRadius: raio.sm, alignItems: 'center', justifyContent: 'center' },
  baseTexto: { fontSize: 14, fontWeight: '800', color: indigo[700] },
  eu: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, backgroundColor: indigo[600], borderRadius: raio.lg, padding: espaco.lg, marginTop: espaco.md },
  euPosicao: { fontSize: 26, fontWeight: '800', color: cores.onPrimaria },
  euXp: { fontSize: 16, fontWeight: '800', color: cores.onPrimaria },
  linhaTitulo: { flex: 1, fontSize: 14, fontWeight: '700', color: cores.texto },
  secao: { fontSize: 15, fontWeight: '800', color: cores.texto, marginTop: espaco.md },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, backgroundColor: cores.fundoCard, borderRadius: raio.md, padding: espaco.md, borderWidth: 1, borderColor: cores.borda },
  linhaEu: { borderColor: indigo[300], backgroundColor: indigo[50] },
  posicao: { width: 32, fontSize: 14, fontWeight: '800', color: cores.textoSecundario },
  linhaXp: { fontSize: 14, fontWeight: '800', color: cores.texto },
  alvo: { backgroundColor: amber[50], borderRadius: raio.md, padding: espaco.md, gap: 8, borderWidth: 1, borderColor: amber[200] },
  trilho: { height: 6, borderRadius: 3, backgroundColor: amber[100], overflow: 'hidden' },
  trilhoCheio: { height: 6, borderRadius: 3, backgroundColor: amber[500] },
  regra: { fontSize: 13, color: cores.textoSecundario },
});
