import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { UNIDADES_EMBALAGEM, type UnidadeEmbalagem } from '../lib/embalagem';
import { amber, cores, espaco, indigo, neutro, raio } from '../theme';

// Concorrentes por marca e embalagem (docs/85 §3.3): a lista de marcas com o que já foi registrado
// em cada uma, e o campo de embalagem (quantidade + unidade) com o R$ por litro/kg na hora.

export interface MarcaDaColeta {
  uuid: string;
  descricao: string;
  /** Cadastrada pelo promotor (nesta visita ou antes, ainda "a aprovar"). */
  aAprovar: boolean;
  /** Criada agora no celular — o uuid ainda não existe no servidor. */
  nova: boolean;
}

export function ListaMarcasColeta({
  marcas,
  embalagensPorMarca,
  permiteNova,
  paddingInferior,
  onAbrir,
  onNova,
  onConcluir,
}: {
  marcas: MarcaDaColeta[];
  embalagensPorMarca: ReadonlyMap<string, string[]>;
  permiteNova: boolean;
  paddingInferior: number;
  onAbrir: (marca: MarcaDaColeta) => void;
  onNova: (descricao: string) => void;
  onConcluir: () => void;
}) {
  const [novaAberta, setNovaAberta] = useState(false);
  const [nome, setNome] = useState('');
  const total = [...embalagensPorMarca.values()].reduce((n, l) => n + l.length, 0);

  function adicionar() {
    const descricao = nome.trim();
    if (!descricao) return;
    onNova(descricao);
    setNome('');
    setNovaAberta(false);
  }

  return (
    <>
      <ScrollView contentContainerStyle={styles.lista}>
        <Text style={styles.contexto}>Quem ocupa o espaço? Toque na marca e adicione as embalagens que encontrou.</Text>
        {marcas.length === 0 && <Text style={styles.vazio}>Nenhuma marca na lista. Cadastre a que encontrou abaixo.</Text>}
        {marcas.map((m) => {
          const embalagens = embalagensPorMarca.get(m.uuid) ?? [];
          return (
            <Pressable key={m.uuid} style={({ pressed }) => [styles.marca, pressed && styles.pressionado]} onPress={() => onAbrir(m)}>
              <View style={[styles.marcaIcone, embalagens.length > 0 && styles.marcaIconeFeito]}>
                <MaterialCommunityIcons
                  name={embalagens.length > 0 ? 'check' : 'tag-outline'}
                  size={16}
                  color={embalagens.length > 0 ? cores.branco : cores.primaria}
                />
              </View>
              <View style={styles.marcaTextos}>
                <Text style={styles.marcaNome} numberOfLines={1}>
                  {m.descricao}
                  {m.aAprovar ? <Text style={styles.aAprovar}>  a aprovar</Text> : null}
                </Text>
                <Text style={styles.marcaSub} numberOfLines={1}>
                  {embalagens.length > 0 ? embalagens.join(' · ') : 'Toque pra adicionar embalagem'}
                </Text>
              </View>
              {embalagens.length > 0 && <Text style={styles.contador}>{embalagens.length}</Text>}
              <MaterialCommunityIcons name="chevron-right" size={20} color={neutro[400]} />
            </Pressable>
          );
        })}

        {permiteNova &&
          (novaAberta ? (
            <View style={styles.novaBox}>
              <TextInput
                style={styles.input}
                placeholder="Nome da marca"
                value={nome}
                onChangeText={setNome}
                autoFocus
                onSubmitEditing={adicionar}
                returnKeyType="done"
              />
              <Pressable style={[styles.botaoMenor, !nome.trim() && styles.fraco]} onPress={adicionar} disabled={!nome.trim()}>
                <Text style={styles.botaoMenorTexto}>Adicionar</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={styles.outraMarca} onPress={() => setNovaAberta(true)}>
              <MaterialCommunityIcons name="plus" size={18} color={cores.primaria} />
              <Text style={styles.outraMarcaTexto}>Outra marca</Text>
            </Pressable>
          ))}
      </ScrollView>
      <View style={[styles.rodape, { paddingBottom: paddingInferior }]}>
        <Pressable style={({ pressed }) => [styles.botao, pressed && styles.pressionado]} onPress={onConcluir}>
          <Text style={styles.botaoTexto}>{total > 0 ? `Concluir (${total} embalage${total === 1 ? 'm' : 'ns'})` : 'Fechar'}</Text>
        </Pressable>
      </View>
    </>
  );
}

export function CampoEmbalagem({
  quantidade,
  unidade,
  onQuantidade,
  onUnidade,
  precoPorLitro,
  jaRegistradas,
}: {
  quantidade: string;
  unidade: UnidadeEmbalagem | null;
  onQuantidade: (v: string) => void;
  onUnidade: (u: UnidadeEmbalagem) => void;
  precoPorLitro: string | null;
  jaRegistradas: string[];
}) {
  return (
    <View style={styles.embalagemBox}>
      {jaRegistradas.length > 0 && <Text style={styles.jaRegistradas}>Já registradas: {jaRegistradas.join(' · ')}</Text>}
      <Text style={styles.rotulo}>Embalagem *</Text>
      <View style={styles.embalagemLinha}>
        <TextInput
          style={[styles.input, styles.inputQuantidade]}
          placeholder="500"
          keyboardType="decimal-pad"
          value={quantidade}
          onChangeText={onQuantidade}
          accessibilityLabel="Quantidade da embalagem"
        />
        {UNIDADES_EMBALAGEM.map((u) => (
          <Pressable
            key={u.valor}
            style={[styles.unidade, unidade === u.valor && styles.unidadeMarcada]}
            onPress={() => onUnidade(u.valor)}
            accessibilityLabel={`Unidade ${u.rotulo}`}
          >
            <Text style={[styles.unidadeTexto, unidade === u.valor && styles.unidadeTextoMarcada]}>{u.rotulo}</Text>
          </Pressable>
        ))}
      </View>
      {precoPorLitro && <Text style={styles.precoRef}>{precoPorLitro}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  lista: { padding: espaco.lg, gap: espaco.sm },
  contexto: { fontSize: 14, color: cores.textoSecundario, marginBottom: espaco.xs },
  vazio: { fontSize: 14, color: cores.textoTerciario, textAlign: 'center', paddingVertical: espaco.md },
  marca: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    padding: espaco.md,
    borderRadius: raio.lg,
    borderWidth: 1,
    borderColor: cores.borda,
    backgroundColor: cores.fundoCard,
  },
  marcaIcone: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: indigo[50] },
  marcaIconeFeito: { backgroundColor: cores.sucesso },
  marcaTextos: { flex: 1, minWidth: 0 },
  marcaNome: { fontSize: 15, fontWeight: '700', color: cores.texto },
  aAprovar: { fontSize: 11, fontWeight: '700', color: amber[700] },
  marcaSub: { fontSize: 12, color: cores.textoSecundario, marginTop: 2 },
  contador: { fontSize: 13, fontWeight: '700', color: cores.primaria },
  outraMarca: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    borderRadius: raio.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: indigo[200],
  },
  outraMarcaTexto: { fontSize: 14, fontWeight: '700', color: cores.primaria },
  novaBox: { flexDirection: 'row', gap: espaco.sm, alignItems: 'center' },
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.md,
    paddingHorizontal: espaco.md,
    fontSize: 15,
    color: cores.texto,
    backgroundColor: cores.fundoCard,
  },
  botaoMenor: { minHeight: 44, paddingHorizontal: espaco.md, borderRadius: raio.md, backgroundColor: cores.primaria, justifyContent: 'center' },
  botaoMenorTexto: { color: cores.branco, fontWeight: '700' },
  fraco: { opacity: 0.5 },
  rodape: { paddingHorizontal: espaco.lg, paddingTop: espaco.md, borderTopWidth: 1, borderTopColor: cores.borda },
  botao: { minHeight: 48, borderRadius: raio.md, backgroundColor: cores.primaria, alignItems: 'center', justifyContent: 'center' },
  botaoTexto: { color: cores.branco, fontSize: 16, fontWeight: '700' },
  pressionado: { opacity: 0.85 },
  embalagemBox: { gap: 6, marginBottom: espaco.md },
  jaRegistradas: { fontSize: 12, color: cores.textoSecundario },
  rotulo: { fontSize: 14, fontWeight: '700', color: cores.texto },
  embalagemLinha: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  inputQuantidade: { flex: 0, width: 90 },
  unidade: {
    minWidth: 40,
    minHeight: 44,
    paddingHorizontal: 8,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.borda,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unidadeMarcada: { borderColor: cores.primaria, backgroundColor: indigo[50] },
  unidadeTexto: { fontSize: 14, fontWeight: '700', color: cores.texto },
  unidadeTextoMarcada: { color: cores.primaria },
  precoRef: { fontSize: 13, fontWeight: '700', color: cores.primaria },
});
