import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { LinhaGuiada } from '../lib/linhasGuiadas';
import { cores, espaco, neutro, raio } from '../theme';

// "Cada seção / linha" como lista guiada (docs/100): o promotor vê todas as linhas, o que já fez e
// o que está em andamento, e cada toque abre as perguntas já amarradas àquela linha.

const ROTULO_NIVEL: Record<'SECAO' | 'DEPARTAMENTO' | 'MARCA', string> = { SECAO: 'seções', DEPARTAMENTO: 'departamentos', MARCA: 'marcas' };

export function ListaLinhas({
  nivel,
  linhas,
  feitas,
  emAndamento,
  carregando,
  paddingInferior,
  onAbrir,
  onConcluir,
}: {
  nivel: 'SECAO' | 'DEPARTAMENTO' | 'MARCA';
  linhas: LinhaGuiada[];
  feitas: ReadonlySet<string>;
  emAndamento: ReadonlySet<string>;
  carregando: boolean;
  paddingInferior: number;
  onAbrir: (linha: LinhaGuiada) => void;
  onConcluir: () => void;
}) {
  const nFeitas = linhas.filter((l) => feitas.has(l.uuid)).length;

  return (
    <View style={styles.tela}>
      <Text style={styles.resumo}>
        <Text style={styles.resumoNumero}>{nFeitas}</Text> de {linhas.length} {ROTULO_NIVEL[nivel]} feitas
      </Text>
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={styles.lista}>
        {carregando && <Text style={styles.vazio}>Carregando…</Text>}
        {!carregando && linhas.length === 0 && (
          <Text style={styles.vazio}>Nenhuma {nivel === 'MARCA' ? 'marca' : nivel === 'DEPARTAMENTO' ? 'departamento' : 'seção'} para esta loja.</Text>
        )}
        {linhas.map((l) => {
          const feita = feitas.has(l.uuid);
          const andamento = !feita && emAndamento.has(l.uuid);
          return (
            <Pressable
              key={l.uuid}
              style={({ pressed }) => [styles.linha, feita && styles.linhaFeita, pressed && { opacity: 0.8 }]}
              onPress={() => onAbrir(l)}
              accessibilityRole="button"
              accessibilityLabel={`${l.descricao}${feita ? ', feita' : andamento ? ', em andamento' : ''}`}
            >
              <MaterialCommunityIcons
                name={feita ? 'check-circle' : andamento ? 'progress-pencil' : 'circle-outline'}
                size={22}
                color={feita ? cores.sucesso : andamento ? cores.acentoEscuro : neutro[400]}
              />
              <Text style={styles.nome} numberOfLines={2}>
                {l.descricao}
              </Text>
              {andamento && <Text style={styles.selo}>em andamento</Text>}
              <MaterialCommunityIcons name="chevron-right" size={20} color={neutro[400]} />
            </Pressable>
          );
        })}
      </ScrollView>
      <Pressable style={[styles.concluir, { marginBottom: paddingInferior }]} onPress={onConcluir} accessibilityRole="button">
        <Text style={styles.concluirTexto}>Concluir</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  tela: { paddingHorizontal: espaco.lg, gap: espaco.sm },
  resumo: { fontSize: 14, color: neutro[700] },
  resumoNumero: { fontWeight: '800', color: cores.texto },
  lista: { gap: espaco.xs, paddingBottom: espaco.sm },
  vazio: { fontSize: 14, color: cores.textoSecundario, textAlign: 'center', paddingVertical: espaco.lg },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm,
    minHeight: 56,
    paddingHorizontal: espaco.md,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.borda,
    backgroundColor: cores.fundoCard,
  },
  linhaFeita: { backgroundColor: cores.sucessoFundo, borderColor: '#bbf7d0' },
  nome: { flex: 1, fontSize: 15, fontWeight: '600', color: cores.texto },
  selo: { fontSize: 11, fontWeight: '700', color: cores.acentoTexto },
  concluir: { minHeight: 52, borderRadius: raio.md, backgroundColor: cores.primaria, alignItems: 'center', justifyContent: 'center' },
  concluirTexto: { fontSize: 15, fontWeight: '700', color: cores.branco },
});
