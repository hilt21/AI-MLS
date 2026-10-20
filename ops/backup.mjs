const HOUR = 3_600_000;
export const RETENTION_MS = 7 * 24 * HOUR;
export const MAX_AGE_MS = 24 * HOUR;
const columns = {
  questions: ['id', 'owner', 'data', 'status', 'image', 'created', 'due', 'card', 'version'],
  attempts: ['id', 'owner', 'question', 'data', 'created'],
  upload_budget: ['month', 'used'],
};
const bytes = value => new TextEncoder().encode(JSON.stringify(value));
export async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function readJson(bucket, key) {
  const object = await bucket.get(key);
  if (!object) throw new Error('Required backup object missing');
  return object.json();
}
function validSnapshot(snapshot) {
  if (snapshot.format !== 1 || !Number.isFinite(Date.parse(snapshot.startedAt))) throw new Error('Unsupported snapshot');
  if (!snapshot.tables || Object.keys(snapshot.tables).sort().join() !== Object.keys(columns).sort().join()) throw new Error('Unexpected snapshot tables');
  for (const [table, rows] of Object.entries(snapshot.tables)) {
    if (!Array.isArray(rows)) throw new Error('Invalid rows');
    for (const row of rows) if (Object.keys(row).sort().join() !== [...columns[table]].sort().join()) throw new Error('Unexpected columns');
  }
  const questions = new Map(snapshot.tables.questions.map(q => [q.id, q]));
  if (questions.size !== snapshot.tables.questions.length || questions.size > 500) throw new Error('Question capacity or identity mismatch');
  for (const q of questions.values()) {
    if (typeof q.id !== 'string' || typeof q.owner !== 'string' || !q.owner || (q.image && q.image !== `${q.owner}/${q.id}`)) throw new Error('Image ownership mismatch');
  }
  for (const a of snapshot.tables.attempts) if (questions.get(a.question)?.owner !== a.owner) throw new Error('Review ownership mismatch');
}
export async function createBackup({ db, images, archive, source }, now = Date.now()) {
  if (!source || images === archive) throw new Error('Distinct backup storage required');
  const startedAt = new Date(now).toISOString();
  const inventory = await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const appTables = inventory.results.map(t => t.name).filter(name => !name.startsWith('sqlite_') && !name.startsWith('_cf_') && name !== 'd1_migrations');
  if (appTables.sort().join() !== Object.keys(columns).sort().join()) throw new Error('Unsupported application table inventory');
  const schema = await db.batch(Object.keys(columns).map(t => db.prepare(`PRAGMA table_info(${t})`)));
  for (const [i, table] of Object.keys(columns).entries()) {
    if (schema[i].results.map(c => c.name).sort().join() !== [...columns[table]].sort().join()) throw new Error('Schema changed; backup implementation must be updated');
  }
  // One D1 batch is a transaction. Objects created later are not part of this point.
  const results = await db.batch(Object.entries(columns).map(([t, names]) => db.prepare(`SELECT ${names.join(',')} FROM ${t}`)));
  const snapshot = { format: 1, source, startedAt, tables: Object.fromEntries(Object.keys(columns).map((t, i) => [t, results[i].results])) };
  validSnapshot(snapshot);
  const snapshotBytes = bytes(snapshot);
  if (snapshotBytes.byteLength > 16 * 1024 * 1024) throw new Error('Snapshot exceeds pilot memory bound');
  const batch = `${startedAt}/${crypto.randomUUID()}`;
  const prefix = `batches/${batch}/`;
  const objects = [];
  for (const q of snapshot.tables.questions) {
    if (!q.image) continue;
    const image = await images.get(q.image);
    if (!image || image.size > 6 * 1024 * 1024) throw new Error('Referenced image missing or too large; no restore point committed');
    const data = await image.arrayBuffer();
    const sha256 = await digest(data);
    const key = `${prefix}images/${q.id}`;
    await archive.put(key, data, { httpMetadata: image.httpMetadata, sha256 });
    // Read back the independent copy; a successful put alone is not a recovery proof.
    const copy = await archive.get(key);
    if (!copy || await digest(await copy.arrayBuffer()) !== sha256) throw new Error('Backup image verification failed');
    objects.push({ original: q.image, key, sha256, size: data.byteLength, httpMetadata: image.httpMetadata ?? {} });
  }
  const dataKey = `${prefix}database.json`;
  const dataHash = await digest(snapshotBytes);
  await archive.put(dataKey, snapshotBytes, { sha256: dataHash });
  const dataCopy = await archive.get(dataKey);
  if (!dataCopy || await digest(await dataCopy.arrayBuffer()) !== dataHash) throw new Error('Backup database verification failed');
  const manifest = { format: 1, source, batch, startedAt, completedAt: new Date().toISOString(), expiresAt: new Date(now + RETENTION_MS).toISOString(), database: { key: dataKey, sha256: dataHash }, objects };
  // This is the sole commit point. Incomplete prefixes are never recovery points.
  await archive.put(`manifests/${batch}.json`, JSON.stringify(manifest));
  return manifest;
}
export async function validateBackup(archive, key, now = Date.now()) {
  const manifest = await readJson(archive, key);
  if (manifest.format !== 1 || !Number.isFinite(Date.parse(manifest.startedAt)) || Date.parse(manifest.startedAt) > now || !Number.isFinite(Date.parse(manifest.expiresAt)) || Date.parse(manifest.expiresAt) <= now) throw new Error('Expired or invalid restore point');
  const prefix = `batches/${manifest.batch}/`;
  if (!manifest.database?.key.startsWith(prefix) || !Array.isArray(manifest.objects)) throw new Error('Invalid manifest');
  const data = await archive.get(manifest.database.key);
  if (!data) throw new Error('Database copy missing');
  const raw = await data.arrayBuffer();
  if (await digest(raw) !== manifest.database.sha256) throw new Error('Database checksum mismatch');
  const snapshot = JSON.parse(new TextDecoder().decode(raw));
  validSnapshot(snapshot);
  if (snapshot.source !== manifest.source || snapshot.startedAt !== manifest.startedAt) throw new Error('Restore point metadata mismatch');
  const expected = snapshot.tables.questions.filter(q => q.image).map(q => q.image).sort();
  if (manifest.objects.map(o => o.original).sort().join() !== expected.join()) throw new Error('Image manifest mismatch');
  for (const object of manifest.objects) {
    if (!object.key.startsWith(prefix)) throw new Error('Invalid backup prefix');
    const image = await archive.get(object.key);
    if (!image || await digest(await image.arrayBuffer()) !== object.sha256) throw new Error('Image checksum mismatch');
  }
  return { manifest, snapshot };
}
export async function restoreBackup({ archive, db, images, target, approved, manifestKey }, now = Date.now()) {
  // Caller provisions a dedicated empty target; never truncate an existing DB.
  if (approved !== true || target !== 'independent-empty-test-target' || images === archive) throw new Error('Explicit isolated restore approval required');
  const { manifest, snapshot } = await validateBackup(archive, manifestKey, now);
  const existing = await db.batch(Object.keys(columns).map(t => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`)));
  if (existing.some(r => r.results[0].n !== 0)) throw new Error('Restore target is not empty');
  const targetObjects = await images.list({ limit: 1 });
  if (targetObjects.objects.length || targetObjects.truncated) throw new Error('Restore image target is not empty');
  for (const object of manifest.objects) {
    const image = await archive.get(object.key);
    const raw = await image.arrayBuffer();
    if (await digest(raw) !== object.sha256) throw new Error('Image changed during restore');
    await images.put(object.original, raw, { httpMetadata: object.httpMetadata, sha256: object.sha256 });
    const copy = await images.get(object.original);
    if (!copy || await digest(await copy.arrayBuffer()) !== object.sha256) throw new Error('Restored image verification failed');
  }
  const statements = [];
  for (const [table, names] of Object.entries(columns)) for (const row of snapshot.tables[table]) {
    statements.push(db.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).bind(...names.map(n => row[n])));
  }
  if (statements.length) await db.batch(statements);
  const restored = await db.batch(Object.entries(columns).map(([table, names]) => db.prepare(`SELECT ${names.join(',')} FROM ${table}`)));
  for (const [i, table] of Object.keys(columns).entries()) {
    const sort = rows => rows.map(r => JSON.stringify(r)).sort();
    if (JSON.stringify(sort(restored[i].results)) !== JSON.stringify(sort(snapshot.tables[table]))) throw new Error('Restored rows mismatch');
  }
  return { restored: true, startedAt: snapshot.startedAt, questionCount: snapshot.tables.questions.length, reviewCount: snapshot.tables.attempts.length, imageCount: manifest.objects.length };
}
export async function manifests(archive) {
  const found = [];
  let cursor;
  do {
    const page = await archive.list({ prefix: 'manifests/', cursor });
    for (const object of page.objects) {
      const item = await readJson(archive, object.key);
      found.push({ key: object.key, ...item });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return found.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}
export async function pruneExpired(archive, now = Date.now()) {
  // Separate manifests and batches share a seven-day cutoff from snapshot start.
  // Deleting a whole expired batch never propagates a live application's delete.
  let cursor;
  let removed = 0;
  do {
    const page = await archive.list({ cursor });
    for (const object of page.objects) {
      const match = /^(?:manifests|batches)\/(\d{4}-\d{2}-\d{2}T[^/]+)\//.exec(object.key);
      if (match && Number.isFinite(Date.parse(match[1])) && now - Date.parse(match[1]) >= RETENTION_MS) {
        await archive.delete(object.key); removed++;
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return removed;
}
export function rollbackDecision({ beforeHealthy, consecutiveFailures, newVersionCause, compatible, expectedCurrent, current, configUnchanged }) {
  return beforeHealthy === true && consecutiveFailures >= 2 && newVersionCause === true
    && compatible === true && configUnchanged === true && current === expectedCurrent ? 'eligible-for-operator-rollback' : 'alert-and-stop';
}
export function recoveryObjectives({ detectedAt, restoredAt, snapshotAt, respondedAt, approvalRequestedAt, approvedAt }) {
  const values = [detectedAt, restoredAt, snapshotAt, respondedAt, approvalRequestedAt, approvedAt].map(Date.parse);
  if (values.some(v => !Number.isFinite(v))) throw new Error('All response and approval timestamps required');
  const [detected, restored, snapshot, responded, requested, approved] = values;
  if (!(snapshot <= detected && detected <= responded && responded <= requested && requested <= approved && approved <= restored)) throw new Error('Invalid recovery chronology');
  return { rpoMs: detected - snapshot, rtoMs: restored - detected, rpoMet: detected - snapshot <= MAX_AGE_MS, rtoMet: restored - detected <= 4 * HOUR };
}
