import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionConfig } from '../../ops/prepare-production-config.mjs';
import { checkApplication } from '../../ops/application-health.mjs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';

const env = { M4_ACCOUNT_ID: 'a'.repeat(32), M4_PREVIEW_DATABASE_ID: '11111111-1111-4111-8111-111111111111', M4_PRODUCTION_DATABASE_ID: '22222222-2222-4222-8222-222222222222', M4_ALERT_TO: 'verified@example.test', M4_ALERT_FROM: 'alerts@example.test' };
test('production proposal is inactive, private and distinct from pilot sources/archive', () => {
  const backup = productionConfig('backup', env), watchdog = productionConfig('watchdog', env);
  assert.equal(backup.d1_databases[0].database_id, env.M4_PRODUCTION_DATABASE_ID);
  assert.deepEqual(backup.r2_buckets.map(x => x.bucket_name), ['ai-mls-production-backups', 'site-creator-r2']);
  for (const config of [backup, watchdog]) {
    assert.equal(config.workers_dev, false); assert.equal(config.preview_urls, false);
    assert.deepEqual(config.triggers.crons, []); assert.equal(config.vars.SOURCE_LABEL, 'production');
  }
  assert.equal(watchdog.d1_databases, undefined); assert.equal(watchdog.r2_buckets.length, 1);
  assert.equal(watchdog.services[0].service, backup.name);
  assert.throws(() => productionConfig('backup', { ...env, M4_PREVIEW_DATABASE_ID: env.M4_PRODUCTION_DATABASE_ID }), /Distinct/);
  assert.throws(() => productionConfig('backup', {}), /Missing/);
});
test('health distinguishes dependency readiness from authentication errors, redirects and malformed replies', async () => {
  for (const status of [302, 401, 403, 500, 503]) assert.equal(await checkApplication({ fetch: async () => new Response('{}', { status }) }, 'https://test.invalid/api/health'), false);
  assert.equal(await checkApplication({ fetch: async () => Response.json({ ready: true }) }, 'https://test.invalid/api/health'), false);
  assert.equal(await checkApplication({ fetch: async () => { throw new Error('dependency'); } }, 'https://test.invalid/api/health'), false);
  assert.equal(await checkApplication({ fetch: async () => Response.json({ ready: true, checks: { database: true, images: true } }) }, 'https://test.invalid/api/health'), true);
});
test('application health request is compatible with the actual Workers runtime', async () => {
  const helper = await readFile('ops/application-health.mjs', 'utf8');
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'health-runtime', modules: true, compatibilityDate: '2026-09-25', script: helper + '\nexport default {async fetch(){return Response.json({healthy:await checkApplication({fetch:async()=>Response.json({ready:true,checks:{database:true,images:true}})},"https://test.invalid/api/health")})}}' }] }));
  try { assert.equal((await (await mf.dispatchFetch('https://local.invalid/')).json()).healthy, true); }
  finally { await mf.dispose(); }
});
