import { registerRootComponent } from 'expo';

import App from './App';
import { envolverComSentry, iniciarSentry } from './src/lib/sentry';

// O mais cedo possível: erro que acontece depois daqui já é capturado (docs/72).
iniciarSentry();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(envolverComSentry(App));
