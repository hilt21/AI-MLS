// Operator-only local bridge for real isolated Cloudflare bindings. Never deploy.
import { createBackup, manifests, restoreBackup, validateBackup, pruneExpired, digest } from '../../ops/backup.mjs';
import { checkBackup } from '../../ops/watchdog.mjs';
import schema0 from '../../drizzle/0000_empty_lockheed.sql';
import schema1 from '../../drizzle/0001_upload_budget.sql';
const fixtureId = '33333333-3333-4333-8333-333333333333';
const attemptId = '44444444-4444-4444-8444-444444444444';
const owner = 'm3-synthetic-owner';
const imageKey = `${owner}/${fixtureId}`;
const bridge = {
  async fetch(request, env) {
    if (!['127.0.0.1', 'localhost'].includes(new URL(request.url).hostname)) return new Response('Local operator only', { status: 403 });
    if (request.method !== 'POST' || request.headers.get('content-type') !== 'application/json') return new Response('JSON POST required', { status: 405 });
    const input = await request.json();
    const source = { db: env.SOURCE_DB, images: env.SOURCE_IMAGES, archive: env.ARCHIVE, source: 'isolated-cloud-preview' };
    let result;
    switch (input.action) {
      case 'scheduled-evidence': {
        const read = async key => { const object = await env.ARCHIVE.get(key); return object ? object.json() : null; };
        result = { backupRun: await read('backup-run.json'), watchdogRun: await read('watchdog-run.json') }; break;
      }
      case 'init-target': {
        const tables = await env.TARGET_DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%'").all();
        if (tables.results.length) throw new Error('Target schema already present; stop');
        for (const sql of (schema0.replaceAll('--> statement-breakpoint', '') + schema1).split(';').map(s => s.trim()).filter(Boolean)) await env.TARGET_DB.prepare(sql).run();
        result = { initialized: true }; break;
      }
      case 'seed-fixture': {
        if (await env.SOURCE_DB.prepare('SELECT id FROM questions WHERE id=?').bind(fixtureId).first()) throw new Error('Fixture already exists; stop');
        const now = new Date().toISOString();
        const data = { title: '[M3] 合成恢复演练', question_markdown: '$x+2=5$', correct_answer: '3', solution_markdown: '两边减去 2，得到 $x=3$。', stage: 'primary', grade: 5, knowledge_points: ['方程'], error_type: 'unknown', image_required: true, recognition_notes: 'M3 synthetic recovery fixture.', student_wrong_answer: '' };
        const png = Uint8Array.from(atob(input.pngBase64), c => c.charCodeAt(0));
        if (png.length > 10000 || png.length < 50) throw new Error('Expected small synthetic PNG');
        await env.SOURCE_IMAGES.put(imageKey, png, { httpMetadata: { contentType: 'image/png' } });
        await env.SOURCE_DB.batch([
          env.SOURCE_DB.prepare('INSERT INTO questions(id,owner,data,status,image,created,due,version) VALUES(?,?,?,?,?,?,?,0)').bind(fixtureId, owner, JSON.stringify(data), 'confirmed', imageKey, now, now),
          env.SOURCE_DB.prepare('INSERT INTO attempts(id,owner,question,data,created) VALUES(?,?,?,?,?)').bind(attemptId, owner, fixtureId, JSON.stringify({ input: { questionId: fixtureId, submissionId: attemptId, rawAnswer: '3', selfReportCorrect: true, usedHint: false, selfRating: 'good' }, before: null, after: null, algorithm: 'synthetic-history-fixture' }), now),
        ]);
        result = { seeded: true, imageSha256: await digest(png) }; break;
      }
      case 'backup': {
        const now = input.injectStale === true ? Date.now() - 25 * 3600000 : Date.now();
        const m = await createBackup(source, now);
        result = { manifestKey: `manifests/${m.batch}.json`, snapshotAt: m.startedAt, questions: m.objects.length, injectedStale: input.injectStale === true }; break;
      }
      case 'check': result = await checkBackup(env); break;
      case 'damage-fixture': {
        if (input.approved !== true) throw new Error('Disposable fixture deletion approval required');
        const row = await env.SOURCE_DB.prepare('SELECT owner,image FROM questions WHERE id=?').bind(fixtureId).first();
        if (!row || row.owner !== owner || row.image !== imageKey) throw new Error('Fixture identity mismatch');
        await env.SOURCE_IMAGES.delete(imageKey);
        await env.SOURCE_DB.batch([
          env.SOURCE_DB.prepare('DELETE FROM attempts WHERE question=? AND owner=?').bind(fixtureId,owner),
          env.SOURCE_DB.prepare('DELETE FROM questions WHERE id=? AND owner=?').bind(fixtureId,owner),
        ]);
        result = { deletedDisposableFixture: true, detectedAt: new Date().toISOString() }; break;
      }
      case 'restore': result = await restoreBackup({ archive: env.ARCHIVE, db: env.TARGET_DB, images: env.TARGET_IMAGES, target: 'independent-empty-test-target', approved: input.approved, manifestKey: input.manifestKey }); break;
      case 'make-restored-fixture-due': {
        const updated = await env.TARGET_DB.prepare('UPDATE questions SET due=? WHERE id=? AND owner=?').bind(new Date().toISOString(), fixtureId, owner).run();
        if (updated.meta.changes !== 1) throw new Error('Restored synthetic fixture missing');
        result = { syntheticFixtureDue: true }; break;
      }
      case 'verify': {
        const q = await env.TARGET_DB.prepare('SELECT owner,image FROM questions WHERE id=?').bind(fixtureId).first();
        const review = await env.TARGET_DB.prepare('SELECT owner,question FROM attempts WHERE id=?').bind(attemptId).first();
        const image = await env.TARGET_IMAGES.get(imageKey);
        result = { fixtureRestored: q?.owner === owner && q.image === imageKey, reviewRestored: review?.owner === owner && review.question === fixtureId, imageSha256: image ? await digest(await image.arrayBuffer()) : null }; break;
      }
      case 'retention-drill': {
        const old = new Date(Date.now() - 8 * 86400000).toISOString();
        const keys = [`batches/${old}/m3-retention-fixture/partial`, `manifests/${old}/m3-retention-fixture.json`];
        for (const key of keys) await env.ARCHIVE.put(key, '{}');
        const removed = await pruneExpired(env.ARCHIVE);
        const fresh = (await manifests(env.ARCHIVE))[0];
        await validateBackup(env.ARCHIVE, fresh.key);
        result = { removed, syntheticExpiredKeysAbsent: (await Promise.all(keys.map(k => env.ARCHIVE.get(k)))).every(x => !x), currentRestorePointValid: true }; break;
      }
      case 'rollback-probe': {
        const response = await env.BACKUP_WORKER.fetch('https://operations.invalid/');
        result = { status: response.status }; break;
      }
      default: return new Response('Unknown operation', { status: 400 });
    }
    return Response.json(result);
  },
};
export default bridge;
