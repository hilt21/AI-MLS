// Standalone synthetic capacity drill; no credentials or remote bindings.
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createBackup, validateBackup, pruneExpired, restoreBackup } from '../../ops/backup.mjs';
const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'capacity', modules: true, script: 'export default {fetch(){return new Response("isolated")}}', compatibilityDate: '2026-09-25', d1Databases: ['SOURCE', 'TARGET'], r2Buckets: ['IMAGES', 'ARCHIVE', 'RESTORED'] }] }));
const calls = {};
function counted(bucket) {
  return new Proxy(bucket, { get(target, name) {
    const value = target[name];
    if (typeof value !== 'function') return value;
    return (...args) => { calls[name] = (calls[name] ?? 0) + 1; return value.apply(target, args); };
  } });
}
try {
  const db = await mf.getD1Database('SOURCE'), target = await mf.getD1Database('TARGET');
  const images = counted(await mf.getR2Bucket('IMAGES')), archive = counted(await mf.getR2Bucket('ARCHIVE')), restored = counted(await mf.getR2Bucket('RESTORED'));
  const schema = await readFile('drizzle/0000_empty_lockheed.sql', 'utf8') + await readFile('drizzle/0001_upload_budget.sql', 'utf8');
  for (const d of [db, target]) for (const sql of schema.split(';').map(x => x.trim()).filter(Boolean)) await d.prepare(sql).run();
  const now = Date.now(), imageBytes = 2 * 1024 * 1024, count = 6;
  for (let i = 0; i < count; i++) {
    await db.prepare('INSERT INTO questions(id,owner,data,status,image,created) VALUES(?,?,?,?,?,?)').bind(`synthetic-${i}`, 'capacity-owner', JSON.stringify({ title: 'capacity', padding: 'x'.repeat(4096) }), 'confirmed', `capacity-owner/synthetic-${i}`, new Date(now).toISOString()).run();
    await images.put(`capacity-owner/synthetic-${i}`, new Uint8Array(imageBytes).fill(i));
    for (let j = 0; j < 4; j++) await db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?)').bind(`${i}-${j}`, 'capacity-owner', `synthetic-${i}`, JSON.stringify({ padding: 'x'.repeat(2048) }), new Date(now).toISOString()).run();
  }
  await db.prepare('INSERT INTO upload_budget VALUES(?,?)').bind('2026-10', count).run();
  const source = { db, images, archive, source: 'independent-synthetic-capacity' };
  let latest;
  const started = performance.now();
  for (let slot = 14; slot >= 0; slot--) latest = await createBackup(source, now - slot * 12 * 3600000 - (slot === 14 ? 1000 : 0));
  const beforePrune = { ...calls };
  const removed = await pruneExpired(archive, now);
  const afterPrune = { ...calls };
  await validateBackup(archive, `manifests/${latest.batch}.json`, now);
  const result = await restoreBackup({ archive, db: target, images: restored, approved: true, target: 'independent-empty-test-target', manifestKey: `manifests/${latest.batch}.json` }, now);
  assert.equal(result.questionCount, count); assert.equal(result.reviewCount, count * 4); assert.equal(result.imageCount, count);
  assert.ok(removed >= count + 2);
  const evidence = { environment: 'local Miniflare; synthetic only; CPU is NOT Cloudflare CPU', questions: count, reviews: count * 4, imageBytes, totalSourceImageBytes: count * imageBytes, restorePointsCreated: 15, expiredPoints: 1, result, elapsedMs: Math.round(performance.now() - started), r2Calls: calls, beforePrune, afterPrune, peakRssKiB: process.resourceUsage().maxRSS, limits: 'No 500-question capacity claim; cloud CPU/memory require separate runtime evidence' };
  await mkdir('outputs/recovery', { recursive: true });
  await writeFile('outputs/recovery/capacity.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally { await mf.dispose(); }
