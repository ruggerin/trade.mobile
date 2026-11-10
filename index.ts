import { registerRootComponent } from 'expo';

import App from './App';
import { instalarTratadorHeadless } from './src/lib/crashHandler';
import { envolverComSentry, iniciarSentry, reportarErro } from './src/lib/sentry';

// O mais cedo possível: erro que acontece depois daqui já é capturado (docs/72).
iniciarSentry();
// Cobre o app acordado só pra tarefa em segundo plano, sem o `App` montado (docs/109).
instalarTratadorHeadless((erro, fatal) => reportarErro(erro, 'erro_global', fatal));

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(envolverComSentry(App));
