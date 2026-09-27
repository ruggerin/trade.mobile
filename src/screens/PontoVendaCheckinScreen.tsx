import { AcoesCompromisso } from '../components/AcoesCompromisso';
import { DadosCadastraisLoja } from '../components/DadosCadastraisLoja';
import { HistoricoLojaPanel } from '../components/HistoricoLojaPanel';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth/AuthContext';
import { escolherOrdemDaLoja, listarOrdensServicoPendentes } from '../lib/api/ordensServico';
import { buscarRaioCheckinMetros } from '../lib/api/parametros';
import { calcularDistanciaMetros } from '../lib/location/distancia';
import { obterLocalizacaoAtual, useLocalizacaoAtual } from '../lib/location/useLocalizacaoAtual';
import type { PontosVendaStackParamList } from '../navigation/PontosVendaStack';
import type { OrdemServico } from '../types/api';
import { buscarVisitaEmAndamento, iniciarVisitaLocal, VisitaEmAndamentoError } from '../lib/visitaLocal';
import { amber, cores, espaco, indigo, neutro, raio as raioUI, sombraCard, tipografia, verde } from '../theme';

type Props = NativeStackScreenProps<PontosVendaStackParamList, 'PontoVendaCheckin'>;
type Aba = 'DADOS' | 'HISTORICO';

// docs/05-APP-MOBILE-UX.md §3.4 — mapa com PDV + posição atual + raio, distância sempre em
// texto (nunca só cor). "Iniciar visita" grava local e navega na hora — não fala com a API
// diretamente (ver lib/visitaLocal.ts, "Fila offline de envio" em docs/04-APP-MOBILE.md): quem
// decide se o check-in é aceito continua sendo sempre o backend (regra de negócio 1), só que
// agora essa decisão acontece em segundo plano, não bloqueia o promotor na hora. Se o
// check-in acabar recusado (ex.: fora do raio de verdade), a visita inteira vira REJEITADA e
// aparece pro promotor descartar no Histórico — o indicador de distância abaixo existe
// justamente pra reduzir a chance disso acontecer.
//
// Layout: protótipo Claude Design (Checkin.dc.html) — mapa em destaque, cartão de distância
// sobrepondo a borda de baixo do mapa, identificação (ícone genérico + nome + endereço),
// atalhos Rota/Ligar/Histórico, cartão da OS, abas em pill (Dados cadastrais/Histórico da
// loja). O ícone de "Fachada" aqui é só decorativo (igual ao protótipo, que também não mostra a
// foto de verdade nesta posição) — a foto real, com upload, mora na aba Dados cadastrais
// (DadosCadastraisLoja), que já tem toda a lógica de download autenticado/upload e não devia
// ser duplicada aqui só por uma miniatura. Ver docs/Trade.mobile app review-handoff.
export function PontoVendaCheckinScreen({ route, navigation }: Props) {
  const { pontoVenda, ordemServico: ordemServicoDaRota } = route.params;
  const { usuario } = useAuth();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();

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
  const [aba, setAba] = useState<Aba>('DADOS');
  const [mapaExpandido, setMapaExpandido] = useState(false);

  // Premissa: uma visita em andamento por vez. Nesta loja → o botão vira "Continuar visita" e vai
  // direto pra ela; em outra loja → o botão leva pra ela em vez de iniciar uma nova.
  const emAndamentoQuery = useQuery({
    queryKey: ['visita-em-andamento', usuario?.id],
    queryFn: () => buscarVisitaEmAndamento(usuario!.id),
    enabled: Boolean(usuario),
    refetchOnMount: 'always',
  });
  const visitaEmAndamento = emAndamentoQuery.data ?? null;
  const emAndamentoNestaLoja = visitaEmAndamento?.pontoVenda.id === pontoVenda.id;
  const emAndamentoEmOutraLoja = visitaEmAndamento !== null && !emAndamentoNestaLoja;

  // Contexto de negócio rápido antes de entrar na visita — docs/26-MELHORIAS-PRODUTIVIDADE-PROMOTOR.md
  // §2 itens 2/3, mesmo raciocínio do card da lista (PontosVendaListScreen).
  const contexto = [
    pontoVenda.rede_loja?.descricao,
    pontoVenda.ramo_atividade?.descricao,
    pontoVenda.numero_checkouts ? `${pontoVenda.numero_checkouts} checkouts` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const endereco = [pontoVenda.endereco, pontoVenda.bairro].filter(Boolean).join(' — ');

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

  const semLimite = !Number.isFinite(raio);
  const dentroDoRaio = semLimite || (distancia !== null && distancia <= raio);

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
    onError: (err) => {
      if (err instanceof VisitaEmAndamentoError) {
        void emAndamentoQuery.refetch();
        setErroCheckin(err.message);
        return;
      }
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
    if (visitaEmAndamento) {
      navigation.replace('VisitaAndamento', { visitaLocalId: visitaEmAndamento.id });
      return;
    }
    if (iniciandoRef.current) return;
    iniciandoRef.current = true;
    checkinMutation.mutate();
  }

  function abrirRota() {
    void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${pontoVenda.latitude},${pontoVenda.longitude}`);
  }

  function ligar() {
    if (!pontoVenda.telefone) {
      Alert.alert('Sem telefone', 'Esta loja não tem telefone cadastrado.');
      return;
    }
    void Linking.openURL(`tel:${pontoVenda.telefone}`);
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

  const marcadoresMapa = localizacao.coords && (
    <>
      <Marker
        coordinate={{ latitude: pontoVenda.latitude, longitude: pontoVenda.longitude }}
        title={pontoVenda.fantasia}
        anchor={{ x: 0.5, y: 1 }}
      >
        <View style={styles.pinLoja}>
          <MaterialCommunityIcons name="storefront" size={17} color={cores.branco} style={styles.pinLojaIcone} />
        </View>
      </Marker>
      <Marker coordinate={localizacao.coords} title="Você" anchor={{ x: 0.5, y: 0.5 }}>
        <View style={styles.pontoUsuario} />
      </Marker>
      {/* raio Infinity (empresa desativou a validação de propósito, ver lib/api/parametros.ts)
          não tem um círculo geométrico válido pra desenhar. */}
      {!semLimite && (
        <Circle
          center={{ latitude: pontoVenda.latitude, longitude: pontoVenda.longitude }}
          radius={raio}
          strokeColor="rgba(79, 70, 229, 0.5)"
          fillColor="rgba(79, 70, 229, 0.12)"
        />
      )}
    </>
  );

  return (
    <View style={styles.container}>
      <ScrollView style={styles.corpo}>
        <Pressable
          style={styles.mapaHero}
          onPress={() => localizacao.coords && setMapaExpandido(true)}
          disabled={!localizacao.coords}
        >
          {localizacao.coords ? (
            <MapView
              style={styles.mapa}
              initialRegion={{
                latitude: pontoVenda.latitude,
                longitude: pontoVenda.longitude,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              }}
              // Só uma prévia — sem gesto nenhum aqui dentro de uma ScrollView (arrastar/beliscar
              // brigava com a rolagem da tela inteira). Pra mexer de verdade (zoom, arrastar, ver
              // mais contexto da região) é só tocar: abre em tela cheia (ver mapaExpandido abaixo).
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              toolbarEnabled={false}
              showsCompass={false}
              showsMyLocationButton={false}
              showsUserLocation={false}
              showsPointsOfInterests={false}
              showsBuildings={false}
            >
              {marcadoresMapa}
            </MapView>
          ) : (
            <View style={styles.mapaCarregando}>
              <Text style={styles.mapaCarregandoTexto}>
                {localizacao.erro ?? (localizacao.carregando ? 'Obtendo sua localização...' : '')}
              </Text>
            </View>
          )}
          <View style={styles.chipsOverlay}>
            <View style={styles.chip}>
              <View style={[styles.chipPonto, { backgroundColor: verde[600] }]} />
              <Text style={styles.chipTexto}>Você</Text>
            </View>
            {!semLimite && (
              <View style={styles.chip}>
                <View style={[styles.chipQuadrado, { backgroundColor: cores.primaria }]} />
                <Text style={styles.chipTexto}>Raio {Math.round(raio)}m</Text>
              </View>
            )}
          </View>
          {localizacao.coords && (
            <View style={styles.botaoExpandir}>
              <MaterialCommunityIcons name="arrow-expand-all" size={14} color={cores.texto} />
              <Text style={styles.botaoExpandirTexto}>Ampliar mapa</Text>
            </View>
          )}
        </Pressable>

        <View style={styles.distanciaCardWrap}>
          <View style={[styles.distanciaCard, { borderColor: dentroDoRaio ? '#bbf7d0' : amber[200] }]}>
            <View style={[styles.distanciaIconeCirculo, { backgroundColor: dentroDoRaio ? cores.sucessoFundo : amber[50] }]}>
              <MaterialCommunityIcons
                name={dentroDoRaio ? 'check-circle-outline' : 'map-marker-alert-outline'}
                size={22}
                color={dentroDoRaio ? cores.sucesso : amber[700]}
              />
            </View>
            <View style={styles.distanciaTextos}>
              <Text style={[styles.distanciaTitulo, { color: dentroDoRaio ? cores.sucesso : amber[700] }]}>
                {dentroDoRaio ? 'Dentro do raio' : 'Fora do raio'}
              </Text>
              <Text style={styles.distanciaSubtitulo}>
                {semLimite
                  ? 'Sem limite configurado'
                  : dentroDoRaio
                    ? 'Check-in liberado'
                    : distancia !== null
                      ? `Aproxime-se mais ${Math.round(distancia - raio)}m da loja`
                      : 'Obtendo sua localização...'}
              </Text>
            </View>
            {distancia !== null && (
              <Text style={styles.distanciaNumero}>
                {distancia >= 1000 ? `${(distancia / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(distancia)} m`}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.identificacaoRow}>
         
          <View style={styles.identificacaoTextos}>
            <Text style={styles.fantasia} numberOfLines={2}>
              {pontoVenda.fantasia}
            </Text>
            {!!endereco && (
              <Text style={styles.endereco} numberOfLines={1}>
                {endereco}
              </Text>
            )}
            {!!contexto && (
              <Text style={styles.contexto} numberOfLines={1}>
                {contexto}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.atalhosRow}>
          <Pressable style={({ pressed }) => [styles.atalhoBotao, pressed && styles.itemPressionado]} onPress={abrirRota}>
            <MaterialCommunityIcons name="navigation-variant-outline" size={16} color={cores.primaria} />
            <Text style={styles.atalhoTexto}>Rota</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.atalhoBotao, pressed && styles.itemPressionado]} onPress={ligar}>
            <MaterialCommunityIcons name="phone-outline" size={16} color={cores.primaria} />
            <Text style={styles.atalhoTexto}>Ligar</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.atalhoBotao, pressed && styles.itemPressionado]}
            onPress={() => setAba('HISTORICO')}
          >
            <MaterialCommunityIcons name="history" size={16} color={cores.primaria} />
            <Text style={styles.atalhoTexto}>Histórico</Text>
          </Pressable>
        </View>

        {ordemServico && <OrdemServicoCard ordemServico={ordemServico} />}

        <View style={styles.segmentadoWrap}>
          <View style={styles.segmentado}>
            <Pressable
              style={[styles.segmento, aba === 'DADOS' && styles.segmentoAtivo]}
              onPress={() => setAba('DADOS')}
            >
              <Text style={[styles.segmentoTexto, aba === 'DADOS' && styles.segmentoTextoAtivo]}>Dados cadastrais</Text>
            </Pressable>
            <Pressable
              style={[styles.segmento, aba === 'HISTORICO' && styles.segmentoAtivo]}
              onPress={() => setAba('HISTORICO')}
            >
              <Text style={[styles.segmentoTexto, aba === 'HISTORICO' && styles.segmentoTextoAtivo]}>
                Histórico da loja
              </Text>
            </Pressable>
          </View>
        </View>

        {aba === 'DADOS' ? <DadosCadastraisLoja pontoVenda={pontoVenda} /> : <HistoricoLojaPanel pontoVendaUuid={pontoVenda.id} />}

        {/* Reagendar/Cancelar só faz sentido pra um compromisso que nasceu na agenda do
            promotor — uma OS de Direcionamento/campanha "encontrada" ao abrir a loja pela aba
            Lojas não é um compromisso da agenda dele pra reagendar/cancelar. */}
        {ordemServico?.origem === 'AGENDA' && (
          <View style={styles.acoesCompromissoWrap}>
            <AcoesCompromisso
              ordemServico={ordemServico}
              onReagendar={() => navigation.navigate('ReagendarCompromisso', { ordemServico })}
              onCancelado={() => navigation.goBack()}
            />
          </View>
        )}
      </ScrollView>

      <View style={[styles.rodapeCheckin, { paddingBottom: espaco.lg + insets.bottom }]}>
        {erroCheckin && (
          <View style={styles.erroBox}>
            <Text style={styles.erroTexto}>{erroCheckin}</Text>
          </View>
        )}
        {emAndamentoEmOutraLoja && !erroCheckin && (
          <View style={styles.avisoForaRaio}>
            <MaterialCommunityIcons name="alert-outline" size={16} color={amber[700]} />
            <Text style={styles.avisoForaRaioTexto}>
              Você já está em uma visita em {visitaEmAndamento.pontoVenda.fantasia}. Finalize-a antes de iniciar outra.
            </Text>
          </View>
        )}
        {!visitaEmAndamento && !dentroDoRaio && !erroCheckin && (
          <View style={styles.avisoForaRaio}>
            <MaterialCommunityIcons name="alert-outline" size={16} color={amber[700]} />
            <Text style={styles.avisoForaRaioTexto}>
              Você ainda está fora do raio. Dá pra iniciar, mas o servidor pode recusar o check-in.
            </Text>
          </View>
        )}

        <Pressable
          style={({ pressed }) => [
            styles.botaoPrimario,
            !visitaEmAndamento && !dentroDoRaio && !checkinMutation.isPending && styles.botaoPrimarioFora,
            pressed && styles.botaoPressionado,
          ]}
          onPress={iniciarVisita}
          disabled={checkinMutation.isPending || emAndamentoQuery.isPending}
        >
          {!checkinMutation.isPending && (
            <MaterialCommunityIcons
              name={visitaEmAndamento ? 'arrow-right-circle-outline' : 'play-circle-outline'}
              size={20}
              color={!visitaEmAndamento && !dentroDoRaio ? cores.primariaEscura : cores.onPrimaria}
            />
          )}
          <Text
            style={[
              styles.botaoPrimarioTexto,
              !visitaEmAndamento && !dentroDoRaio && !checkinMutation.isPending && { color: cores.primariaEscura },
            ]}
          >
            {checkinMutation.isPending
              ? 'Confirmando localização...'
              : emAndamentoNestaLoja
                ? 'Continuar visita'
                : emAndamentoEmOutraLoja
                  ? 'Ir para a visita em andamento'
                  : 'Iniciar visita'}
          </Text>
        </Pressable>
      </View>

      {/* Mapa de verdade, em tela cheia — aqui sim com zoom/arrastar/bússola/localização, sem
          nenhuma ScrollView por perto brigando pelo gesto. */}
      <Modal visible={mapaExpandido} animationType="slide" onRequestClose={() => setMapaExpandido(false)}>
        <View style={styles.mapaExpandidoContainer}>
          {localizacao.coords && (
            <MapView
              style={styles.mapa}
              initialRegion={{
                latitude: pontoVenda.latitude,
                longitude: pontoVenda.longitude,
                latitudeDelta: 0.006,
                longitudeDelta: 0.006,
              }}
              showsCompass
              showsMyLocationButton
              showsUserLocation
            >
              {marcadoresMapa}
            </MapView>
          )}
          <Pressable
            style={[styles.mapaExpandidoFechar, { top: insets.top + espaco.sm }]}
            onPress={() => setMapaExpandido(false)}
            hitSlop={12}
          >
            <MaterialCommunityIcons name="close" size={20} color={cores.texto} />
          </Pressable>
          <View style={[styles.mapaExpandidoRodape, { paddingBottom: espaco.lg + insets.bottom }]}>
            <Text style={styles.mapaExpandidoNome} numberOfLines={1}>
              {pontoVenda.fantasia}
            </Text>
            {distancia !== null && (
              <Text style={styles.mapaExpandidoDistancia}>
                {dentroDoRaio ? 'Dentro do raio' : 'Fora do raio'} ·{' '}
                {distancia >= 1000 ? `${(distancia / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(distancia)} m`}
              </Text>
            )}
            <Pressable
              style={({ pressed }) => [styles.mapaExpandidoBotaoRota, pressed && styles.itemPressionado]}
              onPress={abrirRota}
            >
              <MaterialCommunityIcons name="navigation-variant-outline" size={16} color={cores.onPrimaria} />
              <Text style={styles.mapaExpandidoBotaoRotaTexto}>Traçar rota</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function OrdemServicoCard({ ordemServico }: { ordemServico: OrdemServico }) {
  return (
    <View style={styles.osCardWrap}>
      <View style={styles.osCard}>
        <View style={styles.osTopo}>
          <Text style={styles.osRotulo}>Ordem de serviço</Text>
          <View style={styles.osTagsLinha}>
            {ordemServico.prioridade === 'ALTA' && (
              <View style={styles.osTagAlta}>
                <Text style={styles.osTagAltaTexto}>Alta prioridade</Text>
              </View>
            )}
            {!!ordemServico.tipo_visita && (
              <View style={[styles.osTag, { backgroundColor: ordemServico.tipo_visita.cor }]}>
                <Text style={styles.osTagTexto}>{ordemServico.tipo_visita.descricao}</Text>
              </View>
            )}
          </View>
        </View>
        <Text style={styles.osTitulo}>
          {ordemServico.direcionamento?.descricao ?? ordemServico.objetivo_visita?.descricao ?? 'Visita agendada'}
        </Text>
        <View style={styles.osGrade}>
          <View style={styles.osGradeCelula}>
            <Text style={styles.osGradeRotulo}>Prazo</Text>
            <Text style={styles.osGradeValor}>
              {new Date(ordemServico.prazo_fim).toLocaleDateString('pt-BR')}
              {ordemServico.horario_previsto ? ` às ${ordemServico.horario_previsto}` : ''}
            </Text>
          </View>
          {!!ordemServico.objetivo_visita && (
            <View style={styles.osGradeCelula}>
              <Text style={styles.osGradeRotulo}>Objetivo</Text>
              <Text style={styles.osGradeValor}>{ordemServico.objetivo_visita.descricao}</Text>
            </View>
          )}
        </View>
        {!ordemServico.obrigatoria && <Text style={styles.osTexto}>Sugestão — não bloqueante.</Text>}
        {!!ordemServico.observacao && <Text style={styles.osTexto}>{ordemServico.observacao}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: cores.fundo,
  },
  corpo: {
    flex: 1,
  },
  mapaHero: {
    height: 220,
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
  pinLoja: {
    width: 34,
    height: 34,
    borderRadius: raioUI.md,
    backgroundColor: cores.primaria,
    borderWidth: 3,
    borderColor: cores.branco,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinLojaIcone: {
    marginTop: -1,
  },
  pontoUsuario: {
    width: 16,
    height: 16,
    borderRadius: raioUI.pill,
    backgroundColor: verde[600],
    borderWidth: 3,
    borderColor: cores.branco,
  },
  chipsOverlay: {
    position: 'absolute',
    left: espaco.md,
    top: espaco.md,
    flexDirection: 'row',
    gap: espaco.sm,
  },
  botaoExpandir: {
    position: 'absolute',
    right: espaco.md,
    top: espaco.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 30,
    paddingHorizontal: espaco.sm + 2,
    borderRadius: raioUI.pill,
    backgroundColor: cores.fundoCard,
    ...sombraCard,
  },
  botaoExpandirTexto: {
    fontSize: 12,
    fontWeight: '700',
    color: cores.texto,
  },
  mapaExpandidoContainer: {
    flex: 1,
    backgroundColor: neutro[200],
  },
  mapaExpandidoFechar: {
    position: 'absolute',
    right: espaco.lg,
    width: 40,
    height: 40,
    borderRadius: raioUI.pill,
    backgroundColor: cores.fundoCard,
    alignItems: 'center',
    justifyContent: 'center',
    ...sombraCard,
  },
  mapaExpandidoRodape: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: cores.fundoCard,
    borderTopLeftRadius: raioUI.xl,
    borderTopRightRadius: raioUI.xl,
    padding: espaco.lg,
    gap: 2,
    ...sombraCard,
  },
  mapaExpandidoNome: {
    ...tipografia.destaque,
    fontSize: 17,
    color: cores.texto,
  },
  mapaExpandidoDistancia: {
    fontSize: 13,
    color: cores.textoSecundario,
    marginBottom: espaco.sm,
  },
  mapaExpandidoBotaoRota: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: espaco.sm,
    minHeight: 48,
    borderRadius: raioUI.md,
    backgroundColor: cores.primaria,
  },
  mapaExpandidoBotaoRotaTexto: {
    color: cores.onPrimaria,
    fontSize: 15,
    fontWeight: '700',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 26,
    paddingHorizontal: espaco.sm + 2,
    borderRadius: raioUI.pill,
    backgroundColor: cores.fundoCard,
    ...sombraCard,
  },
  chipPonto: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  chipQuadrado: {
    width: 7,
    height: 7,
    borderRadius: 2,
  },
  chipTexto: {
    fontSize: 12,
    fontWeight: '700',
    color: neutro[700],
  },
  distanciaCardWrap: {
    paddingHorizontal: espaco.lg,
    marginTop: -26,
  },
  distanciaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    backgroundColor: cores.fundoCard,
    borderWidth: 1,
    borderRadius: raioUI.lg,
    padding: espaco.md,
    ...sombraCard,
    shadowOpacity: 0.12,
    shadowRadius: 16,
  },
  distanciaIconeCirculo: {
    width: 44,
    height: 44,
    borderRadius: raioUI.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  distanciaTextos: {
    flex: 1,
    minWidth: 0,
  },
  distanciaTitulo: {
    fontSize: 15,
    fontWeight: '700',
  },
  distanciaSubtitulo: {
    fontSize: 12,
    color: cores.textoSecundario,
    marginTop: 1,
  },
  distanciaNumero: {
    fontSize: 22,
    fontWeight: '800',
    color: cores.texto,
    fontVariant: ['tabular-nums'],
  },
  identificacaoRow: {
    flexDirection: 'row',
    gap: espaco.md,
    padding: espaco.lg,
    alignItems: 'flex-start',
  },
  fachadaPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: raioUI.md,
    backgroundColor: neutro[200],
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  fachadaPlaceholderTexto: {
    fontSize: 9,
    fontWeight: '600',
    color: cores.textoTerciario,
  },
  identificacaoTextos: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  fantasia: {
    ...tipografia.tituloGrande,
    color: cores.texto,
  },
  endereco: {
    fontSize: 13,
    color: cores.textoSecundario,
  },
  contexto: {
    fontSize: 12,
    color: cores.textoTerciario,
  },
  atalhosRow: {
    flexDirection: 'row',
    gap: espaco.sm,
    paddingHorizontal: espaco.lg,
  },
  atalhoBotao: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raioUI.md,
    backgroundColor: cores.fundoCard,
  },
  itemPressionado: {
    backgroundColor: neutro[100],
  },
  atalhoTexto: {
    fontSize: 13,
    fontWeight: '700',
    color: neutro[700],
  },
  osCardWrap: {
    paddingHorizontal: espaco.lg,
    paddingTop: espaco.lg,
  },
  osCard: {
    borderRadius: raioUI.lg,
    backgroundColor: cores.primariaClara,
    borderWidth: 1,
    borderColor: cores.primariaBorda,
    padding: espaco.md,
    gap: espaco.sm,
  },
  osTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: espaco.sm,
  },
  osRotulo: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: cores.primariaEscura,
  },
  osTagsLinha: {
    flexDirection: 'row',
    gap: 6,
  },
  osTagAlta: {
    backgroundColor: cores.erroFundo,
    borderRadius: raioUI.sm,
    paddingHorizontal: espaco.sm,
    paddingVertical: 2,
  },
  osTagAltaTexto: {
    fontSize: 11,
    fontWeight: '700',
    color: cores.erro,
  },
  osTag: {
    borderRadius: raioUI.sm,
    paddingHorizontal: espaco.sm,
    paddingVertical: 2,
  },
  osTagTexto: {
    color: cores.onPrimaria,
    fontSize: 11,
    fontWeight: '700',
  },
  osTitulo: {
    fontSize: 16,
    fontWeight: '700',
    color: indigo[900],
  },
  osGrade: {
    flexDirection: 'row',
    gap: espaco.sm,
  },
  osGradeCelula: {
    flex: 1,
    backgroundColor: cores.fundoCard,
    borderRadius: raioUI.sm,
    padding: espaco.sm,
    gap: 1,
  },
  osGradeRotulo: {
    fontSize: 11,
    fontWeight: '600',
    color: cores.textoSecundario,
  },
  osGradeValor: {
    fontSize: 13,
    fontWeight: '700',
    color: cores.texto,
  },
  osTexto: {
    fontSize: 13,
    color: indigo[700],
  },
  segmentadoWrap: {
    padding: espaco.lg,
    paddingBottom: espaco.md,
  },
  segmentado: {
    flexDirection: 'row',
    backgroundColor: neutro[100],
    borderRadius: raioUI.md,
    padding: 3,
  },
  segmento: {
    flex: 1,
    height: 38,
    borderRadius: raioUI.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentoAtivo: {
    backgroundColor: cores.fundoCard,
    ...sombraCard,
  },
  segmentoTexto: {
    fontSize: 14,
    fontWeight: '700',
    color: cores.textoSecundario,
  },
  segmentoTextoAtivo: {
    color: cores.texto,
  },
  acoesCompromissoWrap: {
    paddingHorizontal: espaco.lg,
    paddingBottom: espaco.xl,
  },
  rodapeCheckin: {
    backgroundColor: cores.fundoCard,
    borderTopWidth: 1,
    borderTopColor: cores.divisor,
    padding: espaco.lg,
    gap: espaco.sm,
  },
  avisoForaRaio: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: espaco.sm,
  },
  avisoForaRaioTexto: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    color: amber[700],
  },
  erroBox: {
    backgroundColor: cores.erroFundo,
    borderWidth: 1,
    borderColor: cores.erroBorda,
    borderRadius: raioUI.md,
    padding: espaco.md,
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
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    ...sombraCard,
    shadowColor: cores.primaria,
    shadowOpacity: 0.3,
  },
  botaoPrimarioFora: {
    backgroundColor: cores.fundoCard,
    borderWidth: 1.5,
    borderColor: cores.primariaBorda,
    shadowOpacity: 0,
    elevation: 0,
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
