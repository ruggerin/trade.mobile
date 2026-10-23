import type { SituacaoRastreamento } from './rastreamento';

// Texto de cada motivo de o rastreamento não estar rodando — usado na faixa de aviso, na tela de
// bloqueio e no Perfil (docs/47-RASTREAMENTO-EXIGENCIA.md §5.1).

export interface TextoSituacao {
  titulo: string;
  explicacao: string;
  /** Rótulo do botão que resolve; null = não há o que o app possa fazer pelo promotor. */
  acao: string | null;
}

export function textoSituacao(situacao: SituacaoRastreamento | null): TextoSituacao {
  switch (situacao) {
    case 'PRECISA_PERMISSAO':
    case 'PERMISSAO_RECUSADA':
      return {
        titulo: 'Permita o acesso à sua localização',
        explicacao: 'Sua empresa acompanha a rota durante o expediente. Toque em permitir e escolha “Permitir o tempo todo”.',
        acao: 'Permitir localização',
      };
    case 'SO_DURANTE_USO':
      return {
        titulo: 'Localização só “durante o uso”',
        explicacao:
          'Pra continuar, a localização precisa estar em “Permitir o tempo todo”. Nas configurações, abra Permissões → Localização e troque a opção.',
        acao: 'Abrir configurações',
      };
    case 'GPS_DESLIGADO':
      return {
        titulo: 'A localização do celular está desligada',
        explicacao: 'Ligue a localização (GPS) do aparelho pra continuar.',
        acao: 'Ligar localização',
      };
    case 'DESLIGADO_PELO_PROMOTOR':
      return { titulo: 'Compartilhamento pausado', explicacao: 'Você pausou o compartilhamento no seu Perfil.', acao: null };
    case 'NAO_SUPORTADO':
      return {
        titulo: 'Esta versão do app não rastreia',
        explicacao: 'O rastreamento não funciona no Expo Go. Instale o aplicativo oficial (APK) da empresa.',
        acao: null,
      };
    case 'FALHA_AO_INICIAR':
      return {
        titulo: 'Não foi possível ligar o rastreamento',
        explicacao: 'Tente de novo. Se continuar, reinicie o aplicativo ou fale com seu gestor.',
        acao: 'Tentar de novo',
      };
    case 'ATIVO':
      return { titulo: 'Localização ativa', explicacao: 'Seu gestor vê sua posição durante o expediente.', acao: null };
    case 'FORA_DA_JORNADA':
      return { titulo: 'Fora do expediente', explicacao: 'A localização não é compartilhada fora do horário de trabalho.', acao: null };
    case 'NO_INTERVALO':
      return { titulo: 'Intervalo', explicacao: 'No seu intervalo a localização não é cobrada.', acao: null };
    default:
      return { titulo: 'Localização', explicacao: '', acao: null };
  }
}
