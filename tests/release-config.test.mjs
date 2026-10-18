import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createReleaseConfig } from '../scripts/prepare-worker-config.mjs';

const settings = JSON.parse(readFileSync('deployments/cloudflare.json', 'utf8'));
const environment = {
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  AI_MLS_PRODUCTION_D1_ID: '11111111-1111-4111-8111-111111111111',
  AI_MLS_PREVIEW_D1_ID: '22222222-2222-4222-8222-222222222222',
  AI_MLS_PRODUCTION_R2_BUCKET: 'production-images',
  AI_MLS_PREVIEW_R2_BUCKET: 'preview-images',
  CLOUDFLARE_ACCESS_ISSUER: 'https://access.example.test',
  CLOUDFLARE_ACCESS_AUD: 'test-audience',
};
const generated = { main: 'index.js', assets: { directory: '../client' }, compatibility_date: '2026-05-15' };

test('release config preserves generated entry/assets and separates real storage bindings', () => {
  const config = createReleaseConfig(generated, settings, environment);
  assert.deepEqual(config.assets, generated.assets);
  assert.equal(config.main, 'index.js');
  assert.equal(config.d1_databases[0].database_id, environment.AI_MLS_PRODUCTION_D1_ID);
  assert.equal(config.previews.d1_databases[0].database_id, environment.AI_MLS_PREVIEW_D1_ID);
  assert.equal(config.keep_vars, true);
  assert.equal(generated.previews, undefined);
});

for (const [name, mutate] of [
  ['missing Preview database', s => { delete s.previews.d1_databases; }],
  ['placeholder database', s => { s.previews.d1_databases[0].database_id = '00000000-0000-4000-8000-000000000000'; }],
  ['production database reused', s => { s.previews.d1_databases = s.production.d1_databases; }],
  ['production bucket reused', s => { s.previews.r2_buckets = s.production.r2_buckets; }],
  ['missing Preview Access audience', s => { delete s.previews.vars.CLOUDFLARE_ACCESS_AUD; }],
  ['secret added to source configuration', s => { s.previews.vars.MODEL_API_KEY = 'test-only'; }],
]) {
  test(`rejects ${name}`, () => {
    const changed = structuredClone(settings);
    mutate(changed);
    assert.throws(() => createReleaseConfig(generated, changed, environment));
  });
}

test('missing build metadata fails instead of inheriting production settings', () => {
  const missing = { ...environment };
  delete missing.AI_MLS_PREVIEW_D1_ID;
  assert.throws(() => createReleaseConfig(generated, settings, missing), /Missing release variable/);
});
