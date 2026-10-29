import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { contagem, filtrar, marcarRestantesComoTem, responder, situacao, type EstadoConferencia, type FiltroConferencia } from '../lib/conferenciaMix';
import { cores, espaco, indigo, neutro, raio } from '../theme';

// Checklist "conferir item a item" (docs/100): nada vem marcado; em cada produto, Tem ou Não tem,
// sem abrir janela. O card muda de cor e fica no lugar — o promotor não perde o fio do que já viu.
// No topo, quanto falta e o que está em falta; os filtros mostram só os pendentes ou só os em falta.

const FILTROS: { valor: FiltroConferencia; rotulo: string }[] = [
  { valor: 'TODOS', rotulo: 'Todos' },
  { valor: 'PENDENTES', rotulo: 'Pendentes' },
  { valor: 'EM_FALTA', rotulo: 'Em falta' },
];

export function ConferenciaItens({
  produtos,
  estado,
  onChange,
}: {
  produtos: { produto_uuid: string; descricao: string }[];
  estado: EstadoConferencia;
  onChange: (estado: EstadoConferencia) => void;
}) {
  const [filtro, setFiltro] = useState<FiltroConferencia>('TODOS');
  const uuids = produtos.map((p) => p.produto_uuid);
  const { conferidos, pendentes, emFalta } = contagem(uuids, estado);
  const visiveis = filtrar(produtos, estado, filtro);
  const totalDoFiltro: Record<FiltroConferencia, number> = { TODOS: produtos.length, PENDENTES: pendentes, EM_FALTA: emFalta };

  return (
    <View style={styles.caixa}>
      <View style={styles.resumo}>
        <Text style={styles.resumoTexto}>
          <Text style={styles.resumoNumero}>{conferidos}</Text> de {produtos.length} conferidos
        </Text>
        {emFalta > 0 && <Text style={styles.resumoFalta}>{emFalta} em falta</Text>}
      </View>
      <View style={styles.trilho}>
        <View style={[styles.trilhoCheio, { width: `${produtos.length ? (conferidos / produtos.length) * 100 : 0}%` }]} />
      </View>

      <View style={styles.filtros}>
        {FILTROS.map((f) => (
          <Pressable
            key={f.valor}
            style={[styles.filtro, filtro === f.valor && styles.filtroAtivo]}
            onPress={() => setFiltro(f.valor)}
            accessibilityRole="tab"
            accessibilityState={{ selected: filtro === f.valor }}
          >
            <Text style={[styles.filtroTexto, filtro === f.valor && styles.filtroTextoAtivo]}>
              {f.rotulo} · {totalDoFiltro[f.valor]}
            </Text>
          </Pressable>
        ))}
      </View>

      {visiveis.length === 0 && (
        <Text style={styles.vazio}>{filtro === 'PENDENTES' ? 'Tudo conferido.' : filtro === 'EM_FALTA' ? 'Nada em falta.' : 'Nenhum produto.'}</Text>
      )}

      {visiveis.map((p) => {
        const s = situacao(estado, p.produto_uuid);
        return (
          <View key={p.produto_uuid} style={[styles.card, s === 'TEM' && styles.cardTem, s === 'NAO_TEM' && styles.cardFalta]}>
            <Text style={styles.nome} numberOfLines={2}>
              {p.descricao}
            </Text>
            <View style={styles.botoes}>
              <Pressable
                style={[styles.botao, s === 'TEM' && styles.botaoTemAtivo]}
                onPress={() => onChange(responder(estado, p.produto_uuid, true))}
                accessibilityRole="button"
                accessibilityState={{ selected: s === 'TEM' }}
                accessibilityLabel={`${p.descricao}: tem`}
              >
                <MaterialCommunityIcons name="check" size={18} color={s === 'TEM' ? cores.branco : cores.sucesso} />
                <Text style={[styles.botaoTexto, { color: s === 'TEM' ? cores.branco : cores.sucesso }]}>Tem</Text>
              </Pressable>
              <Pressable
                style={[styles.botao, s === 'NAO_TEM' && styles.botaoFaltaAtivo]}
                onPress={() => onChange(responder(estado, p.produto_uuid, false))}
                accessibilityRole="button"
                accessibilityState={{ selected: s === 'NAO_TEM' }}
                accessibilityLabel={`${p.descricao}: não tem`}
              >
                <MaterialCommunityIcons name="close" size={18} color={s === 'NAO_TEM' ? cores.branco : cores.erro} />
                <Text style={[styles.botaoTexto, { color: s === 'NAO_TEM' ? cores.branco : cores.erro }]}>Não tem</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      {pendentes > 0 && (
        <Pressable style={styles.restantes} onPress={() => onChange(marcarRestantesComoTem(uuids, estado))} accessibilityRole="button">
          <Text style={styles.restantesTexto}>
            Marcar {pendentes === 1 ? 'o restante' : `os ${pendentes} restantes`} como Tem
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  caixa: { gap: espaco.sm },
  resumo: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  resumoTexto: { fontSize: 14, color: neutro[700] },
  resumoNumero: { fontWeight: '800', color: cores.texto },
  resumoFalta: { fontSize: 14, fontWeight: '700', color: cores.erro },
  trilho: { height: 6, borderRadius: 3, backgroundColor: cores.borda, overflow: 'hidden' },
  trilhoCheio: { height: '100%', backgroundColor: indigo[600] },
  filtros: { flexDirection: 'row', gap: espaco.xs },
  filtro: { flex: 1, minHeight: 40, borderRadius: raio.md, borderWidth: 1.5, borderColor: cores.borda, alignItems: 'center', justifyContent: 'center' },
  filtroAtivo: { backgroundColor: indigo[600], borderColor: indigo[600] },
  filtroTexto: { fontSize: 13, fontWeight: '700', color: neutro[600] },
  filtroTextoAtivo: { color: cores.branco },
  vazio: { fontSize: 14, color: cores.textoSecundario, textAlign: 'center', paddingVertical: espaco.md },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm,
    padding: espaco.sm,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.borda,
    backgroundColor: cores.fundoCard,
  },
  cardTem: { backgroundColor: cores.sucessoFundo, borderColor: '#bbf7d0' },
  cardFalta: { backgroundColor: cores.erroFundo, borderColor: cores.erroBorda },
  nome: { flex: 1, fontSize: 14, fontWeight: '600', color: cores.texto },
  // Alvo de 48 px: o promotor confere em pé, com uma mão, dezenas de produtos.
  botoes: { flexDirection: 'row', gap: espaco.xs },
  botao: {
    minHeight: 48,
    minWidth: 76,
    paddingHorizontal: espaco.sm,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.borda,
    backgroundColor: cores.fundoCard,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  botaoTemAtivo: { backgroundColor: cores.sucesso, borderColor: cores.sucesso },
  botaoFaltaAtivo: { backgroundColor: cores.erro, borderColor: cores.erro },
  botaoTexto: { fontSize: 13, fontWeight: '700' },
  restantes: {
    minHeight: 48,
    borderRadius: raio.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: indigo[300],
    backgroundColor: cores.primariaClara,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restantesTexto: { fontSize: 14, fontWeight: '700', color: cores.primaria },
});
