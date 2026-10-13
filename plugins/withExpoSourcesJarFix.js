const { withProjectBuildGradle } = require('expo/config-plugins');

// Gradle 9 recusa o build quando uma tarefa usa a saída de outra sem declarar dependência. Vários
// módulos põem código GERADO no código-fonte — o `:expo` (ExpoModulesPackageList.kt, tarefa
// `generatePackagesList`) e as bibliotecas com codegen do React Native (ex.: react-native-safe-
// area-context, tarefa `generateCodegenArtifactsFromSchema`) —, mas o `*SourcesJar` da publicação
// (withSourcesJar()) não depende do gerador: "uses this output of task ... without declaring an
// explicit or implicit dependency".
//
// Correção genérica: em todo módulo, os `*SourcesJar` dependem dos geradores que existirem nele.
// A pasta android/ é gerada pelo `expo prebuild` (está no .gitignore), então a correção mora aqui
// e entra no android/build.gradle a cada prebuild. Tirar quando Expo/React Native corrigirem.
const MARCA = '// pdv-app: *SourcesJar dependem dos geradores de código (plugins/withExpoSourcesJarFix.js)';

const TRECHO = `
${MARCA}
subprojects { subprojeto ->
  def geradores = ['generatePackagesList', 'generateCodegenArtifactsFromSchema']
  subprojeto.tasks.configureEach { tarefa ->
    if (tarefa.name.endsWith('SourcesJar')) {
      // Resolvido na montagem do grafo: só os geradores que esse módulo tem.
      tarefa.dependsOn { geradores.findAll { subprojeto.tasks.names.contains(it) }.collect { subprojeto.tasks.named(it) } }
    }
  }
}
`;

// Trecho antigo (só o :expo) — trocado pelo genérico se já estiver no arquivo.
const MARCA_ANTIGA = '// pdv-app: generatePackagesList antes dos *SourcesJar do :expo (plugins/withExpoSourcesJarFix.js)';

module.exports = function withExpoSourcesJarFix(config) {
  return withProjectBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') return mod;
    let conteudo = mod.modResults.contents;
    const antigo = conteudo.indexOf(MARCA_ANTIGA);
    if (antigo !== -1) conteudo = conteudo.slice(0, antigo).trimEnd() + '\n';
    if (!conteudo.includes(MARCA)) conteudo += TRECHO;
    mod.modResults.contents = conteudo;
    return mod;
  });
};
