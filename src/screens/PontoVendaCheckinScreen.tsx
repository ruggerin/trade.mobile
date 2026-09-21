import { AbasLoja, type AbaLoja } from '../components/AbasLoja';
import { AcoesCompromisso } from '../components/AcoesCompromisso';
import { DadosCadastraisLoja } from '../components/DadosCadastraisLoja';
import { HistoricoLojaPanel } from '../components/HistoricoLojaPanel';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker } from 'react-native-maps';
import { useAuth } from '../lib/auth/AuthContext';
import { escolherOrdemDaLoja, listarOrdensServicoPendentes } from '../lib/api/ordensServico';
import { buscarRaioCheckinMetros } from '../lib/api/parametros';
import { calcularDistanciaMetros } from '../lib/location/distancia';
import { obterLocalizacaoAtual, useLocalizacaoAtual } from '../lib/location/useLocalizacaoAtual';
import type { PontosVendaStackParamList } from '../navigation/PontosVendaStack';
import { iniciarVisitaLocal } from '../lib/visitaLocal';
import { cores, espaco, neutro, raio as raioUI, sombraFlutuante, tipografia, verde } from '../theme';

type Props = NativeStackScreenProps<PontosVendaStackParamList, 'PontoVendaCheckin'>;

// docs/05-APP-MOBILE-UX.md §3.4 — mapa com PDV + posição atual + raio, distância sempre em
// texto (nunca só cor). "Iniciar visita" grava local e navega na hora — não fala com a API
// diretamente (ver lib/visitaLocal.ts, "Fila offline de envio" em docs/04-APP-MOBILE.md): quem
// decide se o check-in é aceito continua sendo sempre o backend (regra de negócio 1), só que
// agora essa decisão acontece em segundo plano, não bloqueia o promotor na hora. Se o
// check-in acabar recusado (ex.: fora do raio de verdade), a visita inteira vira REJEITADA e
// aparece pro promotor descartar no Histórico — o indicador de distância abaixo existe
// justamente pra reduzir a chance disso acontecer.
export function PontoVendaCheckinScreen({ route, navigation }: Props) {
  const { pontoVenda, ordemServico: ordemServicoDaRota } = route.params;
  const { usuario, token } = useAuth();
  const queryClient = useQueryClient();

  // A OS que veio pela rota foi escolhida na lista de lojas com a pendência que estava em cache
  // NAQUELE momento — um Direcionamento criado depois (o gestor gera as OS na hora) não estava
  // nela, e o check-in saía sem vínculo: os formulários do Direcionamento nunca apareciam em
  // Ações. Por isso a tela rebusca as pendências ao abrir e de novo no toque em "Iniciar visita"
  // (docs/25 §6), e vale a da rota só se a busca não trouxer nada pra esta loja.
  const pendenciasQuery = useQuery({
    queryKey: ['ordens-servico', 'pendentes'],
    queryFn: listarOrdensServicoPendentes,
    refetchOnMount: 'always',
  });
  const ordemServico = ordemServicoDaRota ?? escolherOrdemDaLoja((pendenciasQuery.data ?? []).filter((os) => os.ponto_venda.id === pontoVenda.id));
  const [erroCheckin, setErroCheckin] = useState<string | null>(null);
  const [aba, setAba] = useState<'DADOS' | 'HISTORICO'>('DADOS');

  // Contexto de negócio rápido antes de entrar na visita — docs/26-MELHORIAS-PRODUTIVIDADE-PROMOTOR.md
  // §2 itens 2/3, mesmo raciocínio do card da lista (PontosVendaListScreen).
  const contexto = [
    pontoVenda.rede_loja?.descricao,
    pontoVenda.ramo_atividade?.descricao,
    pontoVenda.numero_checkouts ? `${pontoVenda.numero_checkouts} checkouts` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const localizacao = useLocalizacaoAtual();
  // Guarda síncrona contra duplo toque — `checkinMutation.isPending` só vira true depois que o
  // React reprocessa o estado, e `mutationFn` ainda espera o GPS (obterLocalizacaoAtual) antes de
  // gravar a visita, uma janela real onde um segundo toque rápido (ou UI travando por um
  // instante num aparelho mais fraco) conseguia disparar `.mutate()` de novo e criar DUAS visitas
  // pro mesmo check-in físico. Um ref é checado e travado na hora, antes de qualquer re-render.
  const iniciandoRef = useRef(false);

  const raioQuery = useQuery({
    queryKey: ['parametros', 'raio-checkin'],
    queryFn: buscarRaioCheckinMetros,
  });
  const raio = raioQuery.data ?? 200;

  const distancia = useMemo(() => {
    if (!localizacao.coords) return null;
    return calcularDistanciaMetros(
      localizacao.coords.latitude,
      localizacao.coords.longitude,
      pontoVenda.latitude,
      pontoVenda.longitude,
    );
  }, [localizacao.coords, pontoVenda.latitude, pontoVenda.longitude]);

  const dentroDoRaio = distancia !== null && distancia <= raio;

  const checkinMutation = useMutation({
    mutationFn: async () => {
      const coords = await obterLocalizacaoAtual();
      // Rebusca fresca no momento do check-in (rede primeiro, cache como fallback — mesma função
      // do resto do app); qualquer falha cai na OS que a tela já tinha, nunca trava o check-in.
      let ordemServicoId = ordemServico?.id;
      try {
        const pendencias = await queryClient.fetchQuery({
          queryKey: ['ordens-servico', 'pendentes'],
          queryFn: listarOrdensServicoPendentes,
          staleTime: 0,
        });
        // Escolhe entre as pendentes desta loja (a com formulário por responder tem prioridade,
        // ver escolherOrdemDaLoja). Só cai na já escolhida se a busca não trouxe nenhuma.
        ordemServicoId =
          escolherOrdemDaLoja(pendencias.filter((os) => os.ponto_venda.id === pontoVenda.id))?.id ?? ordemServicoId;
      } catch {
        // mantém ordemServicoId atual
      }
      return iniciarVisitaLocal({
        usuarioId: usuario!.id,
        pontoVenda,
        ordemServicoId,
        latitude: coords.latitude,
        longitude: coords.longitude,
      });
    },
    onSuccess: (visitaLocal) => {
      setErroCheckin(null);
      navigation.replace('VisitaAndamento', { visitaLocalId: visitaLocal.id });
    },
    onError: () => {
      // Só chega aqui se a própria localização falhar (permissão negada a caminho, GPS
      // indisponível) — gravar a visita local não depende de rede nem pode falhar por conta
      // dela, ver lib/db/filaVisitas.ts::criarVisitaLocal.
      setErroCheckin('Não foi possível confirmar sua localização. Tente novamente.');
    },
    onSettled: () => {
      iniciandoRef.current = false;
    },
  });

  function iniciarVisita() {
    if (iniciandoRef.current) return;
    iniciandoRef.current = true;
    checkinMutation.mutate();
  }

  if (localizacao.permissaoNegada) {
    return (
      <View style={styles.centro}>
        <View style={styles.permissaoIcone}>
          <MaterialCommunityIcons name="map-marker-off-outline" size={32} color={cores.primaria} />
        </View>
        <Text style={styles.permissaoTitulo}>Precisamos da sua localização</Text>
        <Text style={styles.permissaoTexto}>
          Pra fazer check-in num ponto de venda, o app precisa confirmar que você está no local.
          Ative a permissão de localização nas configurações do sistema.
        </Text>
        <Pressable style={styles.botaoPrimario} onPress={() => void Linking.openSettings()}>
          <Text style={styles.botaoPrimarioTexto}>Abrir configurações</Text>
        </Pressable>
      </View>
    );
  }

  const abas: AbaLoja<'DADOS' | 'HISTORICO'>[] = [
    { chave: 'DADOS', rotulo: 'Dados cadastrais', icone: 'store-outline' },
    { chave: 'HISTORICO', rotulo: 'Histórico da loja', icone: 'history' },
  ];

  // Mapa + distância: ficam logo abaixo da foto da fachada, na aba Dados cadastrais.
  const mapaEDistancia = (
    <View style={styles.blocoMapa}>
      <View style={styles.mapaContainer}>
        {localizacao.coords ? (
          <MapView
            style={styles.mapa}
            initialRegion={{
              latitude: pontoVenda.latitude,
              longitude: pontoVenda.longitude,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            }}
          >
            <Marker
              coordinate={{ latitude: pontoVenda.latitude, longitude: pontoVenda.longitude }}
              title={pontoVenda.fantasia}
              pinColor={cores.primaria}
            />
            <Marker coordinate={localizacao.coords} title="Você" pinColor={verde[600]} />
            {/* raio Infinity (empresa desativou a validação de propósito, ver
                lib/api/parametros.ts) não tem um círculo geométrico válido pra desenhar. */}
            {Number.isFinite(raio) && (
              <Circle
                center={{ latitude: pontoVenda.latitude, longitude: pontoVenda.longitude }}
                radius={raio}
                strokeColor="rgba(79, 70, 229, 0.5)"
                fillColor="rgba(79, 70, 229, 0.12)"
              />
            )}
          </MapView>
        ) : (
          <View style={styles.mapaCarregando}>
            <Text style={styles.mapaCarregandoTexto}>
              {localizacao.erro ?? (localizacao.carregando ? 'Obtendo sua localização...' : '')}
            </Text>
          </View>
        )}
      </View>
      {distancia !== null && (
        <Text style={[styles.distancia, dentroDoRaio ? styles.distanciaDentro : styles.distanciaFora]}>
          {!Number.isFinite(raio)
            ? `Você está a ${Math.round(distancia)}m do PDV — sem limite de distância configurado para este check-in.`
            : dentroDoRaio
              ? `Você está a ${Math.round(distancia)}m do PDV — dentro do raio de check-in (${Math.round(raio)}m).`
              : `Você está a ${Math.round(distancia)}m do PDV — fora do raio de check-in (${Math.round(raio)}m).`}
        </Text>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.cabecalhoLoja}>
        <Text style={styles.fantasia}>{pontoVenda.fantasia}</Text>
        {!!contexto && <Text style={styles.contexto}>{contexto}</Text>}
        {ordemServico && (
          <View style={styles.badgeContrato}>
            <MaterialCommunityIcons name="clipboard-text-outline" size={12} color={cores.primaria} />
            <Text style={styles.badgeContratoTexto}>
              Pendência: {ordemServico.direcionamento?.descricao ?? ordemServico.tipo_visita?.descricao ?? 'ordem de serviço'}
            </Text>
          </View>
        )}
      </View>

      <AbasLoja abas={abas} ativa={aba} onChange={setAba} />

      <ScrollView style={styles.corpoAbas}>
        {aba === 'DADOS' ? (
          <>
            {ordemServico && (
              <View style={[styles.osBox, styles.osBoxNaAba]}>
                <View style={styles.osTopo}>
                  <Text style={styles.osTitulo}>Ordem de serviço</Text>
                  {ordemServico.tipo_visita && (
                    <View style={[styles.osTag, { backgroundColor: ordemServico.tipo_visita.cor }]}>
                      <Text style={styles.osTagTexto}>{ordemServico.tipo_visita.descricao}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.osTexto}>
                  Prazo até {new Date(ordemServico.prazo_fim).toLocaleDateString('pt-BR')}
                  {ordemServico.horario_previsto ? ` às ${ordemServico.horario_previsto}` : ''}
                  {!ordemServico.obrigatoria ? ' — sugestão, não bloqueante' : ''}
                </Text>
                {ordemServico.prioridade === 'ALTA' && <Text style={styles.osPrioridade}>Alta prioridade</Text>}
                {!!ordemServico.objetivo_visita && (
                  <Text style={styles.osTexto}>Objetivo: {ordemServico.objetivo_visita.descricao}</Text>
                )}
                {!!ordemServico.observacao && <Text style={styles.osTexto}>{ordemServico.observacao}</Text>}
              </View>
            )}
            <DadosCadastraisLoja pontoVenda={pontoVenda} depoisDaFachada={mapaEDistancia} />
            {ordemServico && (
              <View style={styles.acoesCompromissoNaAba}>
                <AcoesCompromisso
                  ordemServico={ordemServico}
                  onReagendar={() => navigation.navigate('ReagendarCompromisso', { ordemServico })}
                  onCancelado={() => navigation.goBack()}
                />
              </View>
            )}
          </>
        ) : (
          <HistoricoLojaPanel pontoVendaUuid={pontoVenda.id} />
        )}
      </ScrollView>

      <View style={styles.rodapeCheckin}>
        {erroCheckin && (
          <View style={styles.erroBox}>
            <Text style={styles.erroTexto}>{erroCheckin}</Text>
          </View>
        )}

        <Pressable
          style={({ pressed }) => [styles.botaoPrimario, pressed && styles.botaoPressionado]}
          onPress={iniciarVisita}
          disabled={checkinMutation.isPending}
        >
          {!checkinMutation.isPending && (
            <MaterialCommunityIcons name="play-circle-outline" size={20} color={cores.onPrimaria} />
          )}
          <Text style={styles.botaoPrimarioTexto}>
            {checkinMutation.isPending ? 'Iniciando...' : 'Iniciar visita'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cabecalhoLoja: {
    backgroundColor: cores.fundoCard,
    paddingHorizontal: espaco.xl,
    paddingTop: espaco.md,
    paddingBottom: espaco.md,
    gap: 4,
  },
  corpoAbas: { flex: 1, backgroundColor: cores.fundo },
  blocoMapa: { marginBottom: espaco.md, gap: espaco.sm },
  acoesCompromissoNaAba: { paddingHorizontal: espaco.lg, paddingBottom: espaco.xl },
  osBoxNaAba: { margin: espaco.lg, marginBottom: 0 },
  rodapeCheckin: {
    backgroundColor: cores.fundoCard,
    borderTopWidth: 1,
    borderTopColor: cores.divisor,
    padding: espaco.lg,
    gap: espaco.sm,
  },
  container: {
    flex: 1,
    backgroundColor: cores.fundoCard,
  },
  mapaContainer: {
    height: 200,
    borderRadius: raioUI.lg,
    overflow: 'hidden',
    backgroundColor: neutro[200],
  },
  mapa: {
    flex: 1,
  },
  mapaCarregando: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: espaco.xl,
  },
  mapaCarregandoTexto: {
    fontSize: 14,
    color: cores.textoSecundario,
    textAlign: 'center',
  },
  info: {
    padding: espaco.xl,
  },
  osBox: {
    backgroundColor: cores.primariaClara,
    borderWidth: 1,
    borderColor: cores.primariaBorda,
    borderRadius: raioUI.md,
    padding: espaco.md,
    marginBottom: espaco.lg,
    gap: 2,
  },
  osTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: espaco.sm,
  },
  osTitulo: {
    ...tipografia.rotulo,
    color: cores.primariaEscura,
  },
  osTag: {
    borderRadius: raioUI.sm,
    paddingHorizontal: espaco.sm,
    paddingVertical: 3,
  },
  osTagTexto: {
    color: cores.onPrimaria,
    fontSize: 11,
    fontWeight: '700',
  },
  osTexto: {
    fontSize: 13,
    color: cores.primariaEscura,
  },
  osPrioridade: {
    fontSize: 12,
    fontWeight: '700',
    color: cores.erro,
  },
  identificacaoRow: {
    flexDirection: 'row',
    gap: espaco.md,
  },
  fachadaThumb: {
    width: 72,
    height: 72,
    borderRadius: raioUI.md,
    backgroundColor: neutro[200],
  },
  identificacaoTexto: {
    flex: 1,
  },
  fantasia: {
    ...tipografia.titulo,
    color: cores.texto,
  },
  endereco: {
    fontSize: 14,
    color: cores.textoSecundario,
    marginTop: 4,
  },
  contexto: {
    fontSize: 12,
    color: cores.textoTerciario,
    marginTop: 4,
  },
  badgeContrato: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: cores.primariaClara,
    borderRadius: raioUI.sm,
    paddingHorizontal: espaco.sm,
    paddingVertical: 2,
    marginTop: espaco.sm,
  },
  badgeContratoTexto: {
    color: cores.primariaEscura,
    fontSize: 11,
    fontWeight: '700',
  },
  distancia: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: espaco.lg,
  },
  distanciaDentro: {
    color: cores.sucesso,
  },
  distanciaFora: {
    color: cores.acentoTexto,
  },
  erroBox: {
    backgroundColor: cores.erroFundo,
    borderWidth: 1,
    borderColor: cores.erroBorda,
    borderRadius: raioUI.md,
    padding: espaco.md,
    marginTop: espaco.lg,
  },
  erroTexto: {
    color: cores.erro,
    fontSize: 14,
  },
  botaoPrimario: {
    flexDirection: 'row',
    gap: espaco.sm,
    backgroundColor: cores.primaria,
    borderRadius: raioUI.md,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: espaco.xl,
    ...sombraFlutuante,
    shadowColor: cores.primaria,
    shadowOpacity: 0.3,
  },
  botaoPressionado: {
    opacity: 0.85,
  },
  botaoPrimarioTexto: {
    ...tipografia.botao,
    color: cores.onPrimaria,
    fontSize: 17,
  },
  centro: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: espaco.xxl,
    backgroundColor: cores.fundoCard,
  },
  permissaoIcone: {
    width: 64,
    height: 64,
    borderRadius: raioUI.lg,
    backgroundColor: cores.primariaClara,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: espaco.lg,
  },
  permissaoTitulo: {
    ...tipografia.subtitulo,
    color: cores.texto,
    textAlign: 'center',
  },
  permissaoTexto: {
    fontSize: 14,
    color: cores.textoSecundario,
    textAlign: 'center',
    marginTop: espaco.sm,
    marginBottom: espaco.xl,
  },
});
