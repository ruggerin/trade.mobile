import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker } from 'react-native-maps';
import { useAuth } from '../lib/auth/AuthContext';
import { buscarRaioCheckinMetros } from '../lib/api/parametros';
import { calcularDistanciaMetros } from '../lib/location/distancia';
import { obterLocalizacaoAtual, useLocalizacaoAtual } from '../lib/location/useLocalizacaoAtual';
import type { PontosVendaStackParamList } from '../navigation/PontosVendaStack';
import { iniciarVisitaLocal } from '../lib/visitaLocal';

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
  const { pontoVenda, ordemServico } = route.params;
  const { usuario } = useAuth();
  const [erroCheckin, setErroCheckin] = useState<string | null>(null);

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
      return iniciarVisitaLocal({
        usuarioId: usuario!.id,
        pontoVenda,
        ordemServicoId: ordemServico?.id,
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

  return (
    <View style={styles.container}>
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
              pinColor="#2563eb"
            />
            <Marker coordinate={localizacao.coords} title="Você" pinColor="#16a34a" />
            {/* raio Infinity (empresa desativou a validação de propósito, ver
                lib/api/parametros.ts) não tem um círculo geométrico válido pra desenhar. */}
            {Number.isFinite(raio) && (
              <Circle
                center={{ latitude: pontoVenda.latitude, longitude: pontoVenda.longitude }}
                radius={raio}
                strokeColor="rgba(37, 99, 235, 0.5)"
                fillColor="rgba(37, 99, 235, 0.12)"
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

      <View style={styles.info}>
        {ordemServico && (
          <View style={styles.osBox}>
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
        <Text style={styles.fantasia}>{pontoVenda.fantasia}</Text>
        <Text style={styles.endereco}>
          {[pontoVenda.endereco, pontoVenda.numero].filter(Boolean).join(', ')}
        </Text>
        {!!(pontoVenda.bairro || pontoVenda.cidade) && (
          <Text style={styles.endereco}>
            {[pontoVenda.bairro, pontoVenda.cidade].filter(Boolean).join(' · ')}
          </Text>
        )}

        {distancia !== null && (
          <Text style={[styles.distancia, dentroDoRaio ? styles.distanciaDentro : styles.distanciaFora]}>
            {!Number.isFinite(raio)
              ? `Você está a ${Math.round(distancia)}m do PDV — sem limite de distância configurado para este check-in.`
              : dentroDoRaio
                ? `Você está a ${Math.round(distancia)}m do PDV — dentro do raio de check-in (${Math.round(raio)}m).`
                : `Você está a ${Math.round(distancia)}m do PDV — fora do raio de check-in (${Math.round(raio)}m).`}
          </Text>
        )}

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
          <Text style={styles.botaoPrimarioTexto}>
            {checkinMutation.isPending ? 'Iniciando...' : 'Iniciar visita'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  mapaContainer: {
    height: 260,
    backgroundColor: '#e5e7eb',
  },
  mapa: {
    flex: 1,
  },
  mapaCarregando: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  mapaCarregandoTexto: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  info: {
    padding: 20,
  },
  osBox: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    gap: 2,
  },
  osTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  osTitulo: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1d4ed8',
    textTransform: 'uppercase',
  },
  osTag: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  osTagTexto: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  osTexto: {
    fontSize: 13,
    color: '#1e40af',
  },
  osPrioridade: {
    fontSize: 12,
    fontWeight: '700',
    color: '#dc2626',
  },
  fantasia: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  endereco: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  distancia: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 16,
  },
  distanciaDentro: {
    color: '#15803d',
  },
  distanciaFora: {
    color: '#c2410c',
  },
  erroBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    padding: 12,
    marginTop: 16,
  },
  erroTexto: {
    color: '#b91c1c',
    fontSize: 14,
  },
  botaoPrimario: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  botaoPressionado: {
    opacity: 0.8,
  },
  botaoPrimarioTexto: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  centro: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: '#ffffff',
  },
  permissaoTitulo: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  permissaoTexto: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
});
