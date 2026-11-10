#!/usr/bin/env node
/* eslint-disable no-console */
// Publica um update OTA (docs/107 §4.8): `eas update` no canal/ambiente certo e, em seguida, os source
// maps da pasta `dist` pro Sentry. Script Node em vez de `&&` no package.json porque o `--message`
// passado com `npm run ota:preview -- --message "..."` iria pro ÚLTIMO comando da cadeia, não pro eas.
//
// Uso:
//   npm run ota:preview -- --message "Corrige filtro da agenda"
//   npm run ota:production -- --message "..."            (rollout de 10%, docs/107 §7)
//   npm run ota:production -- --message "..." --tudo     (sem rollout: correção urgente já validada no preview)
//
// Qualquer outro argumento (ex.: --platform android, --force-end-active-rollout) é repassado ao eas.

const { spawnSync } = require('node:child_process');

const ambiente = process.argv[2];
if (ambiente !== 'preview' && ambiente !== 'production') {
  console.error('Uso: node scripts/ota.js <preview|production> [--message "..."] [--tudo] [args do eas]');
  process.exit(1);
}

const extras = process.argv.slice(3);
const semRollout = extras.includes('--tudo');
const argsEas = extras.filter((a) => a !== '--tudo');

if (!argsEas.includes('--message') && !argsEas.some((a) => a.startsWith('--message='))) {
  console.error('Informe --message "o que mudou" — é o que aparece no eas update:list e no suporte.');
  process.exit(1);
}

const args = ['eas-cli', 'update', '--branch', ambiente, '--environment', ambiente, ...argsEas];
if (ambiente === 'production' && !semRollout) args.push('--rollout-percentage=10');

function rodar(comando, parametros) {
  console.log(`\n> ${comando} ${parametros.join(' ')}\n`);
  const r = spawnSync(comando, parametros, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

rodar('npx', args);

// Sem o token o upload falha e o update já foi: avisa em vez de esconder (os erros do update chegariam
// ilegíveis no Sentry, docs/107 §4.7).
if (!process.env.SENTRY_AUTH_TOKEN) {
  console.warn('\nSENTRY_AUTH_TOKEN não definido: source maps NÃO enviados. Defina e rode `npx sentry-expo-upload-sourcemaps dist`.');
  process.exit(0);
}
rodar('npx', ['sentry-expo-upload-sourcemaps', 'dist']);
