# Horus — App Mobile

App do promotor (Expo SDK 57 / React Native). Pacote Android e bundle iOS: `com.prossigatec.horus`.

## Pré-requisitos

- Node 22 e `npm ci` na raiz deste projeto
- Para compilar Android no PC: JDK 17 e Android SDK (`ANDROID_HOME` definido, ou `android/local.properties` com `sdk.dir=...`)
- Para builds na nuvem: conta Expo com acesso ao projeto (`npx eas-cli login`)

## Endereço da API

O app lê `EXPO_PUBLIC_API_URL`. A URL entra no código **na hora de compilar**: trocou a URL, precisa compilar de novo.

- Desenvolvimento e build local: vem do `.env`
- Builds no EAS: vem do `env` do perfil no `eas.json` (hoje `preview` e `production` apontam pra API de teste)

## Desenvolvimento

```bash
npx expo start          # abre o QR code pro Expo Go
npm test                # testes (Jest)
npx tsc --noEmit        # checagem de tipos
```

No Expo Go algumas partes nativas ficam desligadas (atestação do aparelho, pinning). Para testar o app completo, gere um APK.

## Gerar APK no PC (build local)

1. Recrie a pasta `android` (necessário sempre que mudar `app.json`, plugins em `plugins/` ou dependências nativas):

   ```bash
   npx expo prebuild -p android --clean
   ```

   O `--clean` apaga e recria `android/`. Alterações feitas à mão lá dentro se perdem.

2. Compile:

   ```bash
   cd android
   ./gradlew assembleRelease      # PowerShell: .\gradlew assembleRelease
   ```

3. O APK sai em `android/app/build/outputs/apk/release/app-release.apk`. Para instalar no celular conectado por USB:

   ```bash
   adb install -r android/app/build/outputs/apk/release/app-release.apk
   ```

O build local é assinado com a chave de **debug**, diferente da chave do EAS. Se o celular tiver um APK vindo do EAS, desinstale antes, senão a instalação falha por conflito de assinatura.

A primeira compilação demora; as seguintes usam cache.

## Gerar no Expo (EAS Build, na nuvem)

| Perfil | Saída | Uso |
|---|---|---|
| `preview` | APK | Instalar direto no celular para testar |
| `production` | AAB | Enviar para o Google Play |
| `development` | APK com dev client | Desenvolvimento com módulos nativos |

```bash
# APK para teste
npx eas-cli build -p android --profile preview

# Release para a loja (versionCode sobe sozinho)
npx eas-cli build -p android --profile production
```

Ao terminar, o link do APK/AAB aparece no terminal e em expo.dev → projeto `pdv-app-mobile` → Builds. O APK do `preview` pode ser instalado abrindo o link no próprio celular.

O EAS assina com a chave guardada nos servidores do Expo, a mesma para todos os perfis.

### Enviar para o Google Play

```bash
npx eas-cli submit -p android --profile production --latest
```

Vai para a trilha de **teste interno** (configurado em `eas.json`). Requisitos:

- O primeiro envio de um app novo tem que ser feito à mão no Play Console (Testes → Teste interno → Criar nova versão, subindo o `.aab`).
- Para o `submit` funcionar, cadastre uma vez a chave JSON de uma conta de serviço do Google com acesso ao app no Play Console: expo.dev → Credentials → Android, ou `npx eas-cli credentials`.

## Problemas conhecidos

- **Erro de `sourcesJar` / `generatePackagesList` no Gradle 9:** resolvido pelo plugin `plugins/withExpoSourcesJarFix.js`, que já está no `app.json`. Se aparecer de novo, rode o `prebuild --clean`.
