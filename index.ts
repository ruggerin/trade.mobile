import { registerRootComponent } from 'expo';

import App from './App';
import { identificacaoDoUpdate } from './src/lib/atualizacao';
import { instalarTratadorHeadless } from './src/lib/crashHandler';
import { podarDiario, registrarEvento } from './src/lib/diario';
import { VERSAO_APP } from './src/lib/versao';
import { envolverComSentry, iniciarSentry, reportarErro } from './src/lib/sentry';

// O mais cedo possível: erro que acontece depois daqui já é capturado (docs/72).
iniciarSentry();
// Cobre o app acordado só pra tarefa em segundo plano, sem o `App` montado (docs/109).
instalarTratadorHeadless((erro, fatal) => reportarErro(erro, 'erro_global', fatal));
// Diário (docs/112): cada processo novo fica registrado — é o "reabriu do zero" que separa
// "minimizou" de "o Android matou o app".
registrarEvento('app_aberto', { versao: VERSAO_APP, update: identificacaoDoUpdate() });
void podarDiario().catch(() => {});

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(envolverComSentry(App));
