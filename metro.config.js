// Metro com o suporte do Sentry (debug ids nos bundles pra os sourcemaps casarem com o erro).
// Equivale ao `getDefaultConfig` do Expo, mais a parte do Sentry.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);

module.exports = config;
