import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const state = await mkdtemp(path.join(tmpdir(), 'ai-mls-browser-'));
const output = path.join(root, '.sites-runtime/browser');
await mkdir(output, { recursive: true });
const config = path.join(output, 'wrangler.json');
const entry = path.join(root, 'dist/server/m2-test-worker.mjs');
await writeFile(entry, (await readFile('tests/browser/worker.mjs', 'utf8')).replace('../../dist/server/index.js', './index.js').replace('./model.mjs', './m2-model.mjs'));
const model = path.join(root, 'dist/server/m2-model.mjs');
await writeFile(model, await readFile('tests/browser/model.mjs'));
const generated = JSON.parse(await readFile('dist/server/wrangler.json', 'utf8'));
// Deliberately construct a local-only config: never inherit production bindings,
// secrets, remote resources, routes or Access variables from release configuration.
await writeFile(config, JSON.stringify({
  name: 'ai-mls-browser-test', main: entry,
  compatibility_date: generated.compatibility_date, compatibility_flags: ['nodejs_compat'],
  no_bundle: true, rules: [{ type: 'ESModule', globs: ['**/*.js', '**/*.mjs'] }],
  assets: { directory: path.join(root, 'dist/client') },
  d1_databases: [{ binding: 'DB', database_name: 'browser-test-db', database_id: '11111111-1111-4111-8111-111111111111' }],
  r2_buckets: [{ binding: 'BUCKET', bucket_name: 'browser-test-images' }],
  vars: { MODEL_API_KEY: 'fixture-not-a-secret', MODEL_BASE_URL: 'https://model.example.test/v1', MODEL_NAME: 'fixture' },
}, null, 2));
const environment = { ...process.env, CLOUDFLARE_CF_FETCH_ENABLED: 'false', WRANGLER_SEND_METRICS: 'false',
  M2_TEST_CONFIG: config, M2_TEST_STATE: state };
// Local tests must not consume a caller's real model credentials.
for (const key of Object.keys(environment)) if (key.startsWith('MODEL_')) delete environment[key];
function run(binary, args) {
  const result = spawnSync(process.execPath, [path.join(root, binary), ...args], { stdio: 'inherit', env: environment });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${binary} exited ${result.status}`);
}
try {
  for (const migration of ['drizzle/0000_empty_lockheed.sql', 'drizzle/0001_upload_budget.sql']) {
    run('node_modules/wrangler/bin/wrangler.js', ['d1', 'execute', 'DB', '--local', '--config', config,
      '--persist-to', state, '--file', migration]);
  }
  run('node_modules/@playwright/test/cli.js', ['test', '--config', 'tests/browser/playwright.config.mjs']);
} finally {
  await rm(entry, { force: true });
  await rm(model, { force: true });
  await rm(state, { recursive: true, force: true });
}
