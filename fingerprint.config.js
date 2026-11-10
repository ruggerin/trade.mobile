// Fingerprint do runtime (docs/107 §5.1): o `version` do app.json sobe a cada OTA (vira X-App-Version) e
// NÃO pode mudar o fingerprint — se mudasse, o update publicado não chegaria a nenhum aparelho porque o
// runtime deixaria de bater com o do APK instalado. Mudança nativa de verdade (lib nativa, plugin,
// permissão, upgrade de SDK) continua mudando o hash e exigindo APK novo.
/** @type {import('expo/fingerprint').Config} */
const config = {
  sourceSkips: ['ExpoConfigVersions', 'PackageJsonAndroidAndIosScriptsIfNotContainRun'],
};

module.exports = config;
