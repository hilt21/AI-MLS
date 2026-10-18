import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createBackup, validateBackup, restoreBackup, manifests, pruneExpired, RETENTION_MS, rollbackDecision, recoveryObjectives } from '../../ops/backup.mjs';
import { notifyState } from '../../ops/monitor.mjs';
const schema = (await readFile('drizzle/0000_empty_lockheed.sql', 'utf8')).replaceAll('--> statement-breakpoint', '') + await readFile('drizzle/0001_upload_budget.sql', 'utf8');
async function setup(fn) {
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'recovery', modules: true, script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: '2026-05-15', d1Databases: ['SOURCE', 'TARGET'], r2Buckets: ['IMAGES', 'ARCHIVE', 'RESTORED'] }] }));
  try {
    const db = await mf.getD1Database('SOURCE'), target = await mf.getD1Database('TARGET');
    for (const database of [db, target]) for (const sql of schema.split(';').map(x => x.trim()).filter(Boolean)) await database.prepare(sql).run();
    const images = await mf.getR2Bucket('IMAGES'), archive = await mf.getR2Bucket('ARCHIVE'), restored = await mf.getR2Bucket('RESTORED');
    await db.prepare('INSERT INTO questions(id,owner,data,status,image,created,version) VALUES(?,?,?,?,?,?,?)')
      .bind('question-a', 'synthetic-owner', '{"title":"synthetic"}', 'confirmed', 'synthetic-owner/question-a', new Date().toISOString(), 0).run();
    await db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?)').bind('attempt-a', 'synthetic-owner', 'question-a', '{"algorithm":"fixture"}', new Date().toISOString()).run();
    await db.prepare('INSERT INTO upload_budget VALUES(?,?)').bind('2026-10', 3).run();
    await images.put('synthetic-owner/question-a', new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: 'image/png' } });
    await fn({ mf, db, target, images, archive, restored, source: 'independent-local-pilot' });
  } finally { await mf.dispose(); }
}
const pointKey = m => `manifests/${m.batch}.json`;

test('paired independent copies restore owners, reviews, upload budget and image bytes', async () => setup(async env => {
  const detected = Date.now();
  const backup = await createBackup(env, detected - 60_000);
  await env.images.delete('synthetic-owner/question-a');
  await env.db.batch([env.db.prepare('DELETE FROM attempts'), env.db.prepare('DELETE FROM questions')]);
  const approved = Date.now();
  const result = await restoreBackup({ archive: env.archive, db: env.target, images: env.restored,
    target: 'independent-empty-test-target', approved: true, manifestKey: pointKey(backup) });
  assert.equal(result.questionCount, 1); assert.equal(result.reviewCount, 1); assert.equal(result.imageCount, 1);
  assert.equal((await env.target.prepare('SELECT owner FROM questions').first()).owner, 'synthetic-owner');
  assert.equal((await env.target.prepare('SELECT used FROM upload_budget').first()).used, 3);
  assert.deepEqual([...new Uint8Array(await (await env.restored.get('synthetic-owner/question-a')).arrayBuffer())], [1, 2, 3]);
  const time = recoveryObjectives({ snapshotAt: backup.startedAt, detectedAt: new Date(detected).toISOString(), respondedAt: new Date(detected).toISOString(), approvalRequestedAt: new Date(detected).toISOString(), approvedAt: new Date(approved).toISOString(), restoredAt: new Date().toISOString() });
  assert.equal(time.rpoMet, true); assert.equal(time.rtoMet, true);
  await mkdir('outputs/recovery', { recursive: true });
  await writeFile('outputs/recovery/local-drill.json', JSON.stringify({ environment: 'local Miniflare, synthetic only', result, time, note: 'Immediate in-test response/approval; not an operational cloud SLA' }, null, 2));
}));

test('delete between DB snapshot and image copy fails without committing a point', async () => setup(async env => {
  const images = { get: async key => { await env.images.delete(key); return null; } };
  await assert.rejects(createBackup({ ...env, images }), /missing/);
  assert.equal((await manifests(env.archive)).length, 0);
}));

test('concurrent new upload is outside the earlier paired point', async () => setup(async env => {
  let added = false;
  const images = { get: async key => {
    if (!added) {
      added = true;
      await env.db.prepare('INSERT INTO questions(id,owner,data,status,image,created) VALUES(?,?,?,?,?,?)').bind('later', 'synthetic-owner', '{}', 'draft', 'synthetic-owner/later', new Date().toISOString()).run();
      await env.images.put('synthetic-owner/later', 'later');
    }
    return env.images.get(key);
  } };
  const m = await createBackup({ ...env, images });
  const { snapshot } = await validateBackup(env.archive, pointKey(m));
  assert.equal(snapshot.tables.questions.length, 1);
  assert.equal(m.objects.length, 1);
}));

test('tampered independent image prevents any database restore', async () => setup(async env => {
  const m = await createBackup(env);
  await env.archive.put(m.objects[0].key, 'corruption');
  await assert.rejects(restoreBackup({ archive: env.archive, db: env.target, images: env.restored, approved: true, target: 'independent-empty-test-target', manifestKey: pointKey(m) }), /checksum/);
  assert.equal((await env.target.prepare('SELECT COUNT(*) AS n FROM questions').first()).n, 0);
}));

test('approval and empty-target guards refuse destructive restore', async () => setup(async env => {
  const m = await createBackup(env);
  await assert.rejects(restoreBackup({ archive: env.archive, db: env.target, images: env.restored, approved: false, target: 'independent-empty-test-target', manifestKey: pointKey(m) }), /approval/);
  await assert.rejects(restoreBackup({ archive: env.archive, db: env.db, images: env.restored, approved: true, target: 'independent-empty-test-target', manifestKey: pointKey(m) }), /not empty/);
}));

test('seven-day retention removes expired committed and partial batches, preserves fresh data', async () => setup(async env => {
  const now = Date.now();
  const old = await createBackup(env, now - RETENTION_MS - 1);
  const fresh = await createBackup(env, now);
  await env.archive.put(`batches/${new Date(now - RETENTION_MS - 1000).toISOString()}/orphan/incomplete`, 'partial');
  assert.ok(await pruneExpired(env.archive, now) >= 4);
  assert.equal(await env.archive.get(pointKey(old)), null);
  assert.ok(await validateBackup(env.archive, pointKey(fresh), now));
}));

test('alert failure is retryable; repeated alert suppressed; recovery is mailed', async () => setup(async env => {
  let sends = 0;
  const mail = { send: async () => { sends++; if (sends === 1) throw new Error('mail unavailable'); } };
  const options = { archive: env.archive, email: mail, to: 'verified@example.test', from: 'ops@example.test', failed: true, reason: 'backup stale' };
  await assert.rejects(notifyState(options, 1000), /mail unavailable/);
  assert.equal(await env.archive.get('monitor.json'), null);
  assert.equal((await notifyState(options, 2000)).sent, true);
  assert.equal((await notifyState(options, 3000)).sent, false);
  assert.equal((await notifyState({ ...options, failed: false, reason: 'backup current' }, 4000)).sent, true);
  assert.equal(sends, 3);
}));

test('finite rollback requires two failures, attribution, data/config compatibility and unchanged current version', () => {
  const good = { beforeHealthy: true, consecutiveFailures: 2, newVersionCause: true, compatible: true, configUnchanged: true, expectedCurrent: 'bad-v2', current: 'bad-v2' };
  assert.equal(rollbackDecision(good), 'eligible-for-operator-rollback');
  for (const change of [{ beforeHealthy: false }, { consecutiveFailures: 1 }, { newVersionCause: false }, { compatible: false }, { configUnchanged: false }, { current: 'newer-v3' }]) assert.equal(rollbackDecision({ ...good, ...change }), 'alert-and-stop');
});

test('RPO uses snapshot start and RTO includes response and approval waits', () => {
  const detectedAt = '2026-10-18T00:00:00Z';
  const r = recoveryObjectives({ snapshotAt: '2026-10-16T23:00:00Z', detectedAt, respondedAt: '2026-10-18T01:00:00Z', approvalRequestedAt: '2026-10-18T02:00:00Z', approvedAt: '2026-10-18T04:00:00Z', restoredAt: '2026-10-18T04:01:00Z' });
  assert.equal(r.rpoMet, false); assert.equal(r.rtoMet, false);
});

test('unsupported new business table prevents a false successful backup', async () => setup(async env => {
  await env.db.prepare('CREATE TABLE new_learning_data (id TEXT)').run();
  await assert.rejects(createBackup(env), /inventory/);
  assert.equal((await manifests(env.archive)).length, 0);
}));

test('catalogue corruption and unreadable monitor storage still attempt the only email channel', async () => {
  const { tick } = await import('../../ops/monitor.mjs');
  let sent = 0;
  const archive = { list: async () => { throw new Error('archive unavailable'); }, get: async () => { throw new Error('archive unavailable'); }, put: async () => { throw new Error('archive unavailable'); } };
  await assert.rejects(tick({ ARCHIVE: archive, EMAIL: { send: async () => { sent++; } }, ALERT_TO: 'verified@example.test', ALERT_FROM: 'ops@example.test' }), /archive unavailable/);
  assert.equal(sent, 1);
});

test('recent manifest with corrupt image alerts rather than reporting healthy', async () => setup(async env => {
  const { tick } = await import('../../ops/monitor.mjs');
  const m = await createBackup(env);
  await env.archive.put(m.objects[0].key, 'broken');
  let sent;
  await tick({ ARCHIVE: env.archive, EMAIL: { send: async mail => { sent = mail; } }, ALERT_TO: 'verified@example.test', ALERT_FROM: 'ops@example.test' });
  assert.match(sent.subject, /needs attention/);
}));

test('null and invalid monitor state cannot suppress failure mail', async () => setup(async env => {
  for (const data of ['null', '{}', '{"failed":true,"sentAt":999999999999999}']) {
    await env.archive.put('monitor.json', data);
    let sent = 0;
    await notifyState({ archive: env.archive, email: { send: async () => { sent++; } }, to: 'verified@example.test', from: 'ops@example.test', failed: false, reason: 'current' });
    assert.equal(sent, 1);
  }
}));

test('limited runtime rollback restores a known-good version without changing bound data', async () => setup(async env => {
  const bindingConfig = { name: 'recovery', compatibilityDate: '2026-05-15', d1Databases: ['SOURCE', 'TARGET'], r2Buckets: ['IMAGES', 'ARCHIVE', 'RESTORED'] };
  const config = bad => convertV4MiniflareOptions({ workers: [{ ...bindingConfig, modules: true,
    script: `export default {fetch(){return new Response("${bad ? 'bad-v2' : 'good-v1'}",{status:${bad ? 500 : 200}})}}` }] });
  assert.equal((await env.mf.dispatchFetch('http://localhost/')).status, 200);
  await env.mf.setOptions(config(true));
  assert.equal((await env.mf.dispatchFetch('http://localhost/')).status, 500);
  assert.equal((await env.mf.dispatchFetch('http://localhost/')).status, 500);
  const decision = rollbackDecision({ beforeHealthy: true, consecutiveFailures: 2, newVersionCause: true,
    compatible: true, configUnchanged: true, expectedCurrent: 'bad-v2', current: 'bad-v2' });
  assert.equal(decision, 'eligible-for-operator-rollback');
  // Explicit test operator action, not an unattended production rollback.
  await env.mf.setOptions(config(false));
  assert.equal((await env.mf.dispatchFetch('http://localhost/')).status, 200);
  const currentDb = await env.mf.getD1Database('SOURCE');
  assert.equal((await currentDb.prepare('SELECT COUNT(*) AS n FROM questions').first()).n, 1);
  const currentImages = await env.mf.getR2Bucket('IMAGES');
  assert.ok(await currentImages.get('synthetic-owner/question-a'));
}));

test('independent watchdog detects backup staleness and mails recovery without running backups', async () => setup(async env => {
  const { checkBackup } = await import('../../ops/watchdog.mjs');
  const sent = [];
  const bindings = { ARCHIVE: env.archive, EMAIL: { send: async m => { sent.push(m.subject); } }, ALERT_TO: 'verified@example.test', ALERT_FROM: 'ops@example.test' };
  const now = Date.now();
  await createBackup(env, now - 25 * 3_600_000);
  assert.deepEqual(await checkBackup(bindings, now), { sent: true, failed: true });
  assert.equal((await manifests(env.archive)).length, 1);
  await createBackup(env, now);
  assert.deepEqual(await checkBackup(bindings, now + 1), { sent: true, failed: false });
  assert.equal(sent.length, 2);
  assert.equal(await env.archive.get('monitor.json'), null);
  assert.ok(await env.archive.get('watchdog.json'));
}));

test('independent watchdog flags a broken backup Worker despite a fresh restore point', async () => setup(async env => {
  const { checkBackup } = await import('../../ops/watchdog.mjs');
  await createBackup(env);
  let sends = 0;
  const result = await checkBackup({ ARCHIVE: env.archive, EMAIL: { send: async () => { sends++; } }, ALERT_TO: 'verified@example.test', ALERT_FROM: 'ops@example.test', BACKUP_WORKER: { fetch: async () => new Response('failed', { status: 500 }) } });
  assert.equal(result.failed, true);
  assert.equal(sends, 1);
}));

test('scheduled backup tick tolerates twelve-hour Cron jitter without losing the next point', async () => setup(async env => {
  const { tick } = await import('../../ops/monitor.mjs');
  const now = Date.now();
  let emails = 0;
  const bindings = { SOURCE_DB: env.db, SOURCE_IMAGES: env.images, ARCHIVE: env.archive, SOURCE_LABEL: env.source, EMAIL: { send: async () => { emails++; } }, ALERT_TO: 'verified@example.test', ALERT_FROM: 'ops@example.test' };
  await tick(bindings, now);
  assert.equal((await manifests(env.archive)).length, 1);
  await tick(bindings, now + 10 * 3_600_000);
  assert.equal((await manifests(env.archive)).length, 1);
  await tick(bindings, now + 12 * 3_600_000 - 1000);
  assert.equal((await manifests(env.archive)).length, 2);
  assert.equal(emails, 0);
}));
