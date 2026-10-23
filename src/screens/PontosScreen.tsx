import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ImagemAutenticada } from '../components/ImagemAutenticada';
import { ClasseTag } from '../components/xp/ClasseTag';
import { buscarPontuacaoHoje, buscarPontuacaoSemana, buscarPontuacaoVisita, buscarRankingEquipe } from '../lib/api/xp';
import { useAuth } from '../lib/auth/AuthContext';
import { useEstaOnline } from '../lib/network';
import { formatarXp, rankingVisivel } from '../lib/xp';
import { amber, cores, espaco, indigo, neutro, raio, verde } from '../theme';
import type { RankingEquipe, VisitaDoDiaXp } from '../types/api';

type Periodo = 'hoje' | 'semana' | 'mes';

const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

const iniciais = (nome: string) =>
  nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

/**
 * Aba "Pontos" (régua de XP, docs/88 §12; protótipo https://claude.ai/artifact/W1KZGrgwi7weFyDUsjdRc4).
 * Tudo numa tela só, pensando em quem usa com pressa: Hoje/Semana/Mês em botões grandes, o pódio
 * da equipe, a própria posição e as visitas — o detalhe de cada visita abre ali mesmo.
 */
export function PontosScreen() {
  const { usuario } = useAuth();
  const online = useEstaOnline();
  const [periodo, setPeriodo] = useState<Periodo>('hoje');
  const comRanking = rankingVisivel(usuario);

  const hojeQuery = useQuery({ queryKey: ['xp', 'hoje'], queryFn: buscarPontuacaoHoje });
  const semanaQuery = useQuery({ queryKey: ['xp', 'semana'], queryFn: buscarPontuacaoSemana, enabled: periodo === 'semana' });
  // Hoje e Semana mostram a liga da semana; Mês, a do mês.
  const periodoRanking = periodo === 'mes' ? 'mes' : 'atual';
  const rankingQuery = useQuery({
    queryKey: ['xp', 'ranking', periodoRanking],
    queryFn: () => buscarRankingEquipe(periodoRanking),
    enabled: comRanking,
  });

  const r = rankingQuery.data;
  const total =
    periodo === 'hoje' ? hojeQuery.data?.total : periodo === 'semana' ? semanaQuery.data?.total : r?.eu?.xp;
  const detalhe =
    periodo === 'hoje'
      ? hojeQuery.data && `de ${formatarXp(hojeQuery.data.possivel)} possíveis hoje`
      : periodo === 'semana'
        ? semanaQuery.data?.aproveitamento !== null && semanaQuery.data?.aproveitamento !== undefined
          ? `${semanaQuery.data.aproveitamento}% do plano da semana`
          : null
        : r?.eu?.aproveitamento !== null && r?.eu?.aproveitamento !== undefined
          ? `${r.eu.aproveitamento}% do plano do mês`
          : null;
  const pct =
    periodo === 'hoje' && hojeQuery.data
      ? (hojeQuery.data.total / Math.max(1, hojeQuery.data.possivel)) * 100
      : periodo === 'semana'
        ? (semanaQuery.data?.aproveitamento ?? 0)
        : (r?.eu?.aproveitamento ?? 0);
  const carregando = periodo === 'hoje' ? hojeQuery.isLoading : periodo === 'semana' ? semanaQuery.isLoading : rankingQuery.isLoading;

  async function atualizar() {
    await Promise.all([hojeQuery.refetch(), periodo === 'semana' ? semanaQuery.refetch() : null, comRanking ? rankingQuery.refetch() : null]);
  }

  return (
    <ScrollView
      style={styles.tela}
      contentContainerStyle={styles.conteudo}
      refreshControl={<RefreshControl refreshing={hojeQuery.isRefetching || rankingQuery.isRefetching} onRefresh={() => void atualizar()} />}
    >
      <View style={styles.periodos} accessibilityRole="tablist">
        {(['hoje', 'semana', 'mes'] as const).map((p) => (
          <Pressable
            key={p}
            style={[styles.periodo, periodo === p && styles.periodoAtivo]}
            onPress={() => setPeriodo(p)}
            accessibilityRole="tab"
            accessibilityState={{ selected: periodo === p }}
          >
            <Text style={[styles.periodoTexto, periodo === p && styles.periodoTextoAtivo]}>
              {{ hoje: 'Hoje', semana: 'Semana', mes: 'Mês' }[p]}
            </Text>
          </Pressable>
        ))}
      </View>

      {!online && <Text style={styles.offline}>Sem sinal: os números aparecem quando a conexão voltar. O que você faz agora conta quando enviar.</Text>}

      {/* Placar: branco sobre índigo escuro (o texto de apoio antigo sumia no fundo). */}
      <View style={styles.placar}>
        {comRanking && r?.eu && (
          <View style={styles.posicao}>
            <Text style={styles.posicaoNumero}>{r.eu.posicao}º</Text>
            <Text style={styles.posicaoDe}>de {r.participantes}</Text>
          </View>
        )}
        <View style={{ flex: 1, gap: 2 }}>
          {carregando ? (
            <ActivityIndicator color={cores.branco} />
          ) : (
            <Text style={styles.placarXp}>{total !== undefined && total !== null ? `${formatarXp(total)} pts` : '—'}</Text>
          )}
          {!!detalhe && <Text style={styles.placarSub}>{detalhe}</Text>}
          <View style={styles.placarBarra}>
            <View style={[styles.placarBarraCheia, { width: `${Math.min(100, Math.max(0, pct))}%` }]} />
          </View>
        </View>
      </View>

      {periodo === 'hoje' && hojeQuery.data?.dica && (
        <View style={styles.dica}>
          <MaterialCommunityIcons name="lightbulb-on-outline" size={20} color={verde[700]} />
          <Text style={styles.dicaTexto}>Ainda dá pra ganhar mais hoje: {hojeQuery.data.dica}</Text>
        </View>
      )}

      {comRanking && r && <Liga r={r} />}

      {periodo === 'hoje' && hojeQuery.data && (
        <>
          <Text style={styles.secao}>Visitas de hoje</Text>
          {hojeQuery.data.visitas.length === 0 && <Text style={styles.vazio}>Nenhuma visita da agenda hoje.</Text>}
          <View style={styles.cartao}>
            {hojeQuery.data.visitas.map((v, i) => (
              <LinhaVisita key={v.ordem_servico_id} v={v} primeira={i === 0} />
            ))}
          </View>

          {hojeQuery.data.iniciativas.length > 0 && (
            <>
              <Text style={styles.secao}>Iniciativa</Text>
              <View style={styles.cartao}>
                {hojeQuery.data.iniciativas.map((it, idx) => (
                  <View key={idx} style={[styles.linha, idx > 0 && styles.linhaBorda]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.linhaTitulo}>{it.descricao}</Text>
                      {it.loja && <Text style={styles.sub}>{it.loja}</Text>}
                    </View>
                    <Text style={[styles.ganho, { color: it.situacao === 'ok' ? verde[700] : amber[700] }]}>
                      +{formatarXp(it.pontos)}
                      {it.situacao === 'pendente' ? ' aguardando' : ''}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </>
      )}

      {periodo === 'semana' && semanaQuery.data && (
        <>
          <Text style={styles.secao}>Dia a dia</Text>
          <View style={[styles.cartao, styles.barras]}>
            {semanaQuery.data.dias.map((d, i) => {
              const maior = Math.max(1, ...semanaQuery.data!.dias.map((x) => Math.max(x.xp, x.possivel)));
              return (
                <View key={d.dia} style={styles.barraCol}>
                  <Text style={styles.barraValor}>{d.xp > 0 ? formatarXp(d.xp) : ''}</Text>
                  <View style={styles.barraFundo}>
                    <View style={[styles.barraPossivel, { height: `${(d.possivel / maior) * 100}%` }]} />
                    <View style={[styles.barraXp, { height: `${(d.xp / maior) * 100}%`, backgroundColor: d.hoje ? amber[500] : indigo[600] }]} />
                  </View>
                  <Text style={[styles.barraDia, d.hoje && styles.barraHoje]}>{DIAS[i]}</Text>
                </View>
              );
            })}
          </View>

          <Text style={styles.secao}>Conquistas</Text>
          <View style={styles.conquistas}>
            {semanaQuery.data.conquistas.map((c) => (
              <View key={c.chave} style={[styles.conquista, c.conquistada && styles.conquistaFeita]}>
                <MaterialCommunityIcons name={c.conquistada ? 'medal' : 'medal-outline'} size={28} color={c.conquistada ? amber[600] : neutro[400]} />
                <Text style={styles.conquistaTitulo}>{c.titulo}</Text>
                <Text style={styles.sub}>{c.conquistada ? 'Conquistada' : `${Math.min(c.progresso, c.meta)} de ${c.meta}`}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

/** Pódio da equipe (como no ranking de antes), a própria posição e quem vem logo depois. */
function Liga({ r }: { r: RankingEquipe }) {
  const podio = r.linhas.filter((l) => l.posicao <= 3);
  const resto = r.linhas.filter((l) => l.posicao > 3);
  // Pódio na ordem 2º, 1º, 3º.
  const ordem = [podio.find((l) => l.posicao === 2), podio.find((l) => l.posicao === 1), podio.find((l) => l.posicao === 3)];

  return (
    <>
      <Text style={styles.secao}>Sua equipe · {r.periodo === 'mes' ? 'liga do mês' : 'liga da semana'}</Text>
      <View style={[styles.cartao, { padding: espaco.md }]}>
        <Text style={styles.sub}>{r.fechada ? 'Período fechado.' : r.periodo === 'mes' ? 'Fecha no dia 1º, 00h.' : 'Fecha segunda, 00h.'}</Text>
        <View style={styles.podio}>
          {ordem.map((l, i) =>
            l ? (
              <View key={l.posicao} style={[styles.degrau, { paddingTop: i === 1 ? 0 : 18 }]}>
                {l.posicao === 1 && <MaterialCommunityIcons name="crown" size={22} color={amber[500]} />}
                <Avatar nome={l.nome} fotoUrl={l.foto_url} eu={l.eu} tamanho={l.posicao === 1 ? 60 : 48} />
                <Text style={styles.podioNome} numberOfLines={1}>
                  {l.eu ? 'Você' : l.nome.split(' ')[0]}
                </Text>
                <Text style={styles.podioXp}>{formatarXp(l.xp)} pts</Text>
                <View style={[styles.base, { height: l.posicao === 1 ? 46 : l.posicao === 2 ? 32 : 22 }]}>
                  <Text style={styles.baseTexto}>{l.posicao}º</Text>
                </View>
              </View>
            ) : (
              <View key={`vazio-${i}`} style={styles.degrau} />
            ),
          )}
        </View>

        {resto.map((l) => (
          <View key={l.posicao} style={[styles.colega, l.eu && styles.colegaEu]}>
            <Text style={styles.colegaPos}>{l.posicao}º</Text>
            <Avatar nome={l.nome} fotoUrl={l.foto_url} eu={l.eu} tamanho={36} />
            <Text style={styles.linhaTitulo}>{l.eu ? 'Você' : l.nome}</Text>
            <Text style={styles.ganho}>{formatarXp(l.xp)}</Text>
          </View>
        ))}
        {r.escondidos > 0 && <Text style={styles.sub}>+ {r.escondidos} colegas da equipe</Text>}

        {!r.eu && <Text style={styles.sub}>Você ainda não entrou na liga (mínimo de {r.minimo_visitas} visitas agendadas).</Text>}
        {r.alvo && !r.fechada && (
          <View style={styles.alvo}>
            <Text style={styles.alvoTexto}>
              Faltam {formatarXp(r.alvo.faltam)} pts pra passar {r.alvo.nome.split(' ')[0]}.
            </Text>
            <View style={styles.trilho}>
              <View style={[styles.trilhoCheio, { width: `${Math.min(100, (r.alvo.de / Math.max(1, r.alvo.ate)) * 100)}%` }]} />
            </View>
          </View>
        )}
      </View>
    </>
  );
}

/** Visita de hoje: toca e abre de onde veio cada ponto, sem trocar de tela. */
function LinhaVisita({ v, primeira }: { v: VisitaDoDiaXp; primeira: boolean }) {
  const [aberta, setAberta] = useState(false);
  const detalheQuery = useQuery({
    queryKey: ['xp', 'visita', v.visita_id],
    queryFn: () => buscarPontuacaoVisita(v.visita_id!),
    enabled: aberta && !!v.visita_id,
  });
  const perfeita = v.feita && v.ganho === v.possivel;

  return (
    <View style={!primeira && styles.linhaBorda}>
      <Pressable
        style={styles.linha}
        onPress={() => v.visita_id && setAberta(!aberta)}
        disabled={!v.visita_id}
        accessibilityRole="button"
        accessibilityState={{ expanded: aberta }}
      >
        <View style={{ flex: 1, gap: 3 }}>
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
        <Text style={[styles.ganho, { color: v.feita ? (perfeita ? verde[700] : cores.texto) : neutro[500] }]}>
          {v.feita ? `+${formatarXp(v.ganho ?? 0)}` : `até ${formatarXp(v.possivel)}`}
        </Text>
        {v.visita_id && <MaterialCommunityIcons name={aberta ? 'chevron-down' : 'chevron-right'} size={24} color={neutro[500]} />}
      </Pressable>
      {aberta && (
        <View style={styles.detalhe}>
          {detalheQuery.isLoading && <ActivityIndicator color={cores.primaria} />}
          {detalheQuery.data?.partes.map((p) => (
            <View key={p.parte} style={[styles.item, p.ganho < p.maximo && styles.itemFaltou]}>
              <Text style={[styles.itemTexto, p.ganho < p.maximo && styles.itemTextoFaltou]}>{p.rotulo}</Text>
              <Text style={[styles.itemValor, p.ganho < p.maximo && styles.itemTextoFaltou]}>
                +{formatarXp(p.ganho)} / {formatarXp(p.maximo)}
              </Text>
            </View>
          ))}
          {detalheQuery.isError && <Text style={styles.sub}>Não foi possível abrir agora.</Text>}
        </View>
      )}
    </View>
  );
}

// Foto do cadastro (rota autenticada); sem foto, as iniciais.
function Avatar({ nome, fotoUrl, eu, tamanho }: { nome: string; fotoUrl?: string | null; eu: boolean; tamanho: number }) {
  const forma = { width: tamanho, height: tamanho, borderRadius: tamanho / 2 };
  if (fotoUrl) return <ImagemAutenticada uri={fotoUrl} style={[forma, eu && styles.fotoEu]} />;
  return (
    <View style={[styles.avatar, forma, eu && styles.avatarEu]}>
      <Text style={[styles.avatarTexto, eu && { color: cores.onPrimaria }]}>{iniciais(nome)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.sm, paddingBottom: espaco.xxl },
  // Botões grandes (alvo de 52 px) pra acertar com pressa.
  periodos: { flexDirection: 'row', gap: 6 },
  periodo: {
    flex: 1,
    minHeight: 52,
    borderRadius: raio.md,
    borderWidth: 2,
    borderColor: cores.borda,
    backgroundColor: cores.fundoCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodoAtivo: { backgroundColor: indigo[600], borderColor: indigo[600] },
  periodoTexto: { fontSize: 16, fontWeight: '700', color: neutro[600] },
  periodoTextoAtivo: { color: cores.branco },
  offline: { fontSize: 13, color: amber[800] },
  placar: { flexDirection: 'row', alignItems: 'center', gap: espaco.lg, backgroundColor: indigo[800], borderRadius: raio.lg, padding: espaco.lg, marginTop: espaco.xs },
  posicao: { width: 76, height: 76, borderRadius: raio.lg, backgroundColor: cores.branco, alignItems: 'center', justifyContent: 'center' },
  posicaoNumero: { fontSize: 30, fontWeight: '900', color: indigo[800], lineHeight: 34 },
  posicaoDe: { fontSize: 12, fontWeight: '700', color: indigo[800] },
  placarXp: { fontSize: 32, fontWeight: '900', color: cores.branco },
  placarSub: { fontSize: 15, fontWeight: '600', color: cores.branco },
  placarBarra: { height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden', marginTop: 8 },
  placarBarraCheia: { height: 10, borderRadius: 5, backgroundColor: amber[400] },
  dica: { flexDirection: 'row', gap: espaco.sm, alignItems: 'flex-start', backgroundColor: verde[50], borderRadius: raio.md, padding: espaco.md, borderWidth: 1, borderColor: verde[600] },
  dicaTexto: { flex: 1, fontSize: 15, fontWeight: '600', color: verde[700] },
  secao: { fontSize: 14, fontWeight: '800', color: neutro[600], marginTop: espaco.md, textTransform: 'uppercase', letterSpacing: 0.4 },
  vazio: { fontSize: 14, color: cores.textoSecundario },
  cartao: { backgroundColor: cores.fundoCard, borderRadius: raio.lg, borderWidth: 1, borderColor: cores.borda, overflow: 'hidden' },
  sub: { fontSize: 13, color: cores.textoSecundario },
  podio: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: espaco.sm, marginTop: espaco.md },
  degrau: { flex: 1, alignItems: 'center', gap: 4 },
  avatar: { backgroundColor: indigo[100], alignItems: 'center', justifyContent: 'center' },
  avatarEu: { backgroundColor: indigo[600] },
  avatarTexto: { fontSize: 15, fontWeight: '800', color: indigo[900] },
  fotoEu: { borderWidth: 3, borderColor: indigo[600] },
  podioNome: { fontSize: 15, fontWeight: '800', color: cores.texto },
  podioXp: { fontSize: 13, fontWeight: '600', color: neutro[600] },
  base: { width: '100%', backgroundColor: indigo[100], borderTopLeftRadius: raio.sm, borderTopRightRadius: raio.sm, alignItems: 'center', justifyContent: 'center' },
  baseTexto: { fontSize: 16, fontWeight: '900', color: indigo[800] },
  colega: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, minHeight: 56, paddingHorizontal: espaco.sm, borderRadius: raio.md, marginTop: espaco.sm },
  colegaEu: { backgroundColor: amber[50] },
  colegaPos: { width: 32, fontSize: 17, fontWeight: '900', color: neutro[600], textAlign: 'center' },
  alvo: { backgroundColor: amber[50], borderRadius: raio.md, padding: espaco.md, gap: 8, borderWidth: 1, borderColor: amber[200], marginTop: espaco.md },
  alvoTexto: { fontSize: 15, fontWeight: '700', color: amber[900] },
  trilho: { height: 8, borderRadius: 4, backgroundColor: amber[100], overflow: 'hidden' },
  trilhoCheio: { height: 8, borderRadius: 4, backgroundColor: amber[500] },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm, minHeight: 64, paddingHorizontal: espaco.md, paddingVertical: espaco.sm },
  linhaBorda: { borderTopWidth: 1, borderTopColor: cores.borda },
  linhaTitulo: { flex: 1, fontSize: 16, fontWeight: '700', color: cores.texto },
  linhaSub: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  ganho: { fontSize: 17, fontWeight: '900', color: cores.texto },
  detalhe: { paddingHorizontal: espaco.md, paddingBottom: espaco.md, gap: 6 },
  item: { flexDirection: 'row', justifyContent: 'space-between', gap: espaco.sm, padding: 10, borderRadius: raio.sm, backgroundColor: cores.fundo },
  itemFaltou: { backgroundColor: amber[50] },
  itemTexto: { flex: 1, fontSize: 14, color: cores.texto },
  itemTextoFaltou: { color: amber[900] },
  itemValor: { fontSize: 14, fontWeight: '800', color: cores.texto },
  barras: { flexDirection: 'row', gap: 6, height: 150, padding: espaco.md },
  barraCol: { flex: 1, alignItems: 'center', gap: 4 },
  barraValor: { fontSize: 11, fontWeight: '700', color: neutro[600] },
  barraFundo: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  barraPossivel: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: neutro[100], borderRadius: 4 },
  barraXp: { width: '100%', borderRadius: 4 },
  barraDia: { fontSize: 12, color: neutro[600] },
  barraHoje: { color: cores.texto, fontWeight: '900' },
  conquistas: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.sm },
  conquista: { width: '31%', alignItems: 'center', gap: 4, backgroundColor: cores.fundoCard, borderRadius: raio.md, padding: espaco.sm, borderWidth: 1, borderColor: cores.borda },
  conquistaFeita: { borderColor: amber[300], backgroundColor: amber[50] },
  conquistaTitulo: { fontSize: 13, fontWeight: '700', color: cores.texto, textAlign: 'center' },
});
