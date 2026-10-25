import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pilotConfig } from '../../ops/prepare-config.mjs';
const env = { M3_ACCOUNT_ID: 'a'.repeat(32), M3_SOURCE_DATABASE_ID: '11111111-1111-4111-8111-111111111111', M3_PRODUCTION_DATABASE_ID: '22222222-2222-4222-8222-222222222222', M3_ALERT_TO: 'verified@example.test', M3_ALERT_FROM: 'alerts@example.test' };
test('pilot config refuses missing, shared or invalid audited resource inputs', () => {
  assert.throws(() => pilotConfig('production', env), /Choose/);
  assert.throws(() => pilotConfig('backup', {}), /Missing/);
  assert.throws(() => pilotConfig('backup', { ...env, M3_PRODUCTION_DATABASE_ID: env.M3_SOURCE_DATABASE_ID }), /Distinct/);
  assert.throws(() => pilotConfig('backup', { ...env, M3_ACCOUNT_ID: 'invalid' }), /Invalid/);
  assert.throws(() => pilotConfig('backup', { ...env, M3_ALERT_TO: 'header\ninjection@example.test' }), /email/);
});
test('scheduled pilot profiles bind isolated sources; watchdog has no business database or image binding', () => {
  const backup = pilotConfig('backup', env), watchdog = pilotConfig('watchdog', env);
  assert.equal(backup.name, 'ai-mls-pilot-ops');
  assert.equal(backup.d1_databases[0].database_id, env.M3_SOURCE_DATABASE_ID);
  assert.equal(backup.d1_databases[0].database_name, 'ai-mls-preview-db');
  assert.deepEqual(backup.triggers.crons, ['0 */12 * * *']);
  assert.equal(watchdog.d1_databases, undefined);
  assert.equal(watchdog.r2_buckets.length, 1);
  assert.deepEqual(watchdog.triggers.crons, ['15 * * * *']);
  for (const config of [backup, watchdog]) {
    assert.equal(config.workers_dev, false); assert.equal(config.preview_urls, false);
    assert.equal(config.send_email[0].destination_address, env.M3_ALERT_TO);
    assert.equal(config.r2_buckets[0].bucket_name, 'ai-mls-m3-backups');
  }
});
