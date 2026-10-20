// Private disposable M4 capacity Worker. No production bindings or public routes.
import { createBackup, validateBackup, pruneExpired, manifests } from '../../ops/backup.mjs';
import schema0 from '../../drizzle/0000_empty_lockheed.sql';
import schema1 from '../../drizzle/0001_upload_budget.sql';
const owner = 'm4-capacity-owner';
const worker = {
  async fetch(request, env) {
    if (request.method !== 'POST' || new URL(request.url).hostname !== 'capacity.invalid') return new Response('Not found', { status: 404 });
    const { action, index } = await request.json();
    if (action === 'seed-schema') {
      const tables = await env.SOURCE_DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all();
      if (tables.results.length) return new Response('Expected new empty capacity DB', { status: 409 });
      for (const sql of (schema0 + schema1).split(';').map(x => x.trim()).filter(Boolean)) await env.SOURCE_DB.prepare(sql).run();
      return Response.json({ schemaReady: true });
    }
    if (action === 'seed-image') {
      if (!Number.isInteger(index) || index < 0 || index >= 6) return new Response('Invalid fixture', { status: 400 });
      const id = `synthetic-${index}`, image = `${owner}/${id}`;
      await env.SOURCE_IMAGES.put(image, new Uint8Array(2 * 1024 * 1024).fill(index));
      await env.SOURCE_DB.prepare('INSERT INTO questions(id,owner,data,status,image,created) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id, owner, JSON.stringify({ title: 'synthetic capacity', padding: 'x'.repeat(4096) }), 'confirmed', image, new Date().toISOString()).run();
      return Response.json({ index, imageBytes: 2 * 1024 * 1024 });
    }
    if (action === 'seed-review') {
      if (!Number.isInteger(index) || index < 0 || index >= 24) return new Response('Invalid fixture', { status: 400 });
      await env.SOURCE_DB.prepare('INSERT INTO attempts VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(`capacity-review-${index}`, owner, `synthetic-${Math.floor(index / 4)}`, JSON.stringify({ padding: 'x'.repeat(2048) }), new Date().toISOString()).run();
      return Response.json({ reviewSeeded: index });
    }
    const source = { db: env.SOURCE_DB, images: env.SOURCE_IMAGES, archive: env.ARCHIVE, source: 'm4-isolated-capacity' };
    if (action === 'backup') {
      const start = performance.now();
      const slot = index ?? 0;
      if (!Number.isInteger(slot) || slot < 0 || slot > 14) return new Response('Invalid time fixture', { status: 400 });
      const m = await createBackup(source, Date.now() - slot * 12 * 3600000 - (slot === 14 ? 10000 : 0));
      return Response.json({ questions: m.objects.length, bytes: m.objects.reduce((s, x) => s + x.size, 0), elapsedMs: performance.now() - start });
    }
    if (action === 'validate') {
      const latest = (await manifests(env.ARCHIVE))[0];
      if (!latest) return new Response('No complete point', { status: 409 });
      const start = performance.now();
      const result = await validateBackup(env.ARCHIVE, latest.key);
      return Response.json({ valid: true, questions: result.snapshot.tables.questions.length, elapsedMs: performance.now() - start });
    }
    if (action === 'prune') return Response.json({ removed: await pruneExpired(env.ARCHIVE) });
    return new Response('Unknown operation', { status: 400 });
  },
};
export default worker;
