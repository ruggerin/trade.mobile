import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { diaMes } from '../lib/acompanhamentos';
import type { AcompanhamentoAberto, RespostaAcompanhamento } from '../types/api';
import { amber, cores, espaco, neutro, raio, verde } from '../theme';
import { ImagemAutenticada } from './ImagemAutenticada';

// "Ainda está lá?" (docs/83 §3.2): o que foi registrado antes nesta loja, pra confirmar com um
// toque. Os textos dos botões vêm do formulário; "Não consegui ver" é fixo e adia pra próxima.
export function CartaoAcompanhamento({
  acompanhamento: a,
  respostaNestaVisita,
  onContinua,
  onAcabou,
  onNaoConseguiVer,
}: {
  acompanhamento: AcompanhamentoAberto;
  respostaNestaVisita: RespostaAcompanhamento | null;
  onContinua: () => void;
  onAcabou: () => void;
  onNaoConseguiVer: () => void;
}) {
  const origem = a.origem;
  const onde = origem.produto?.descricao ?? origem.vinculo_descricao;
  const quem = [origem.criado_em ? `Registrado em ${diaMes(origem.criado_em)}` : null, origem.usuario_nome ? `por ${origem.usuario_nome.split(' ')[0]}` : null]
    .filter(Boolean)
    .join(' ');
  const rotuloResposta =
    respostaNestaVisita === 'CONTINUA' ? a.rotulo_continua : respostaNestaVisita === 'ACABOU' ? a.rotulo_acabou : 'Não consegui ver';

  return (
    <View style={[styles.cartao, respostaNestaVisita && styles.cartaoFeito]}>
      <View style={styles.topo}>
        {origem.miniatura_url ? (
          <ImagemAutenticada uri={origem.miniatura_url} style={styles.miniatura} />
        ) : (
          <View style={[styles.miniatura, styles.semFoto]}>
            <MaterialCommunityIcons name="history" size={22} color={cores.primaria} />
          </View>
        )}
        <View style={styles.textos}>
          <Text style={styles.titulo} numberOfLines={1}>
            {a.tipo_registro.descricao}
            {onde ? <Text style={styles.onde}> · {onde}</Text> : null}
          </Text>
          {!!quem && <Text style={styles.sub}>{quem}</Text>}
          {origem.resumo.slice(0, 3).map((r) => (
            <Text key={r.rotulo} style={styles.resumo} numberOfLines={1}>
              {r.rotulo}: <Text style={styles.resumoValor}>{r.valor}</Text>
            </Text>
          ))}
        </View>
      </View>

      {respostaNestaVisita ? (
        <View style={styles.feito}>
          <MaterialCommunityIcons name="check-circle" size={16} color={cores.sucesso} />
          <Text style={styles.feitoTexto}>Conferido: {rotuloResposta}</Text>
        </View>
      ) : (
        <>
          <View style={styles.botoes}>
            <Pressable style={({ pressed }) => [styles.botao, styles.botaoContinua, pressed && styles.pressionado]} onPress={onContinua}>
              <Text style={styles.botaoContinuaTexto} numberOfLines={1}>
                {a.rotulo_continua}
              </Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.botao, styles.botaoAcabou, pressed && styles.pressionado]} onPress={onAcabou}>
              <Text style={styles.botaoAcabouTexto} numberOfLines={1}>
                {a.rotulo_acabou}
              </Text>
            </Pressable>
          </View>
          <Pressable style={styles.naoVi} onPress={onNaoConseguiVer} hitSlop={6}>
            <Text style={styles.naoViTexto}>Não consegui ver</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  cartao: {
    backgroundColor: cores.fundoCard,
    borderRadius: raio.lg,
    borderWidth: 1,
    borderColor: amber[200],
    padding: espaco.md,
    gap: espaco.sm,
    marginBottom: espaco.sm,
  },
  cartaoFeito: { borderColor: '#bbf7d0', backgroundColor: verde[50] },
  topo: { flexDirection: 'row', gap: espaco.md },
  miniatura: { width: 56, height: 56, borderRadius: raio.md },
  semFoto: { backgroundColor: cores.primariaClara, alignItems: 'center', justifyContent: 'center' },
  textos: { flex: 1, minWidth: 0 },
  titulo: { fontSize: 15, fontWeight: '700', color: cores.texto },
  onde: { fontWeight: '500', color: cores.textoSecundario },
  sub: { fontSize: 12, color: cores.textoTerciario, marginTop: 1 },
  resumo: { fontSize: 12, color: cores.textoSecundario, marginTop: 2 },
  resumoValor: { fontWeight: '700', color: cores.texto },
  botoes: { flexDirection: 'row', gap: espaco.sm },
  botao: { flex: 1, minHeight: 44, borderRadius: raio.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: espaco.sm },
  botaoContinua: { backgroundColor: cores.primaria },
  botaoContinuaTexto: { fontSize: 14, fontWeight: '700', color: cores.branco },
  botaoAcabou: { borderWidth: 1, borderColor: cores.borda, backgroundColor: cores.fundoCard },
  botaoAcabouTexto: { fontSize: 14, fontWeight: '700', color: neutro[700] },
  naoVi: { alignSelf: 'center', minHeight: 32, justifyContent: 'center' },
  naoViTexto: { fontSize: 13, fontWeight: '600', color: cores.textoSecundario },
  feito: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  feitoTexto: { fontSize: 13, fontWeight: '700', color: cores.sucesso },
  pressionado: { opacity: 0.85 },
});
