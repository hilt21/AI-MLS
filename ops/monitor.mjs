import { createBackup, manifests, MAX_AGE_MS, pruneExpired, validateBackup } from './backup.mjs';
export async function notifyState({ archive, email, to, from, failed, reason, stateKey = 'monitor.json', source = 'isolated-cloud-preview' }, now = Date.now()) {
  if (!to || !from || !email) throw new Error('Verified mail configuration required');
  let state = {};
  try {
    const saved = await archive.get(stateKey);
    if (saved) {
      const parsed = await saved.json();
      if (!parsed || Array.isArray(parsed) || typeof parsed.failed !== 'boolean' || !Number.isFinite(parsed.sentAt) || parsed.sentAt < 0 || parsed.sentAt > now) throw new Error('Invalid monitor state');
      state = parsed;
    }
  } catch {
    failed = true; reason = 'monitor state storage unavailable';
  }
  if (state.failed === undefined && !failed) {
    await archive.put(stateKey, JSON.stringify({ failed: false, sentAt: 0 }));
    return { sent: false };
  }
  const changed = state.failed !== failed;
  if (!changed && (!failed || now - state.sentAt < 6 * 3_600_000)) return { sent: false };
  const label = source === 'production' ? 'production' : 'pilot';
  const subject = failed ? `[AI-MLS ${label}] Backup or application check needs attention` : `[AI-MLS ${label}] Backup monitoring recovered`;
  // Deliberately omit owner IDs, object keys, question text and raw exceptions.
  const text = `${label} environment: ${reason}. UTC: ${new Date(now).toISOString()}. Operator response required; no automatic rollback was performed.`;
  await email.send({ to, from: { email: from, name: 'AI-MLS pilot operations' }, subject, text, html: `<p>${text}</p>` });
  await archive.put(stateKey, JSON.stringify({ failed, sentAt: now }));
  return { sent: true, failed };
}
export async function tick(env, now = Date.now()) {
  let failed = false;
  let reason = 'backup current';
  try {
    const latest = (await manifests(env.ARCHIVE))[0];
    // Allow an hour of Cron start-time jitter rather than skipping a whole 12h slot.
    if (!latest || now - Date.parse(latest.startedAt) >= 11 * 3_600_000) {
      await createBackup({ db: env.SOURCE_DB, images: env.SOURCE_IMAGES, archive: env.ARCHIVE, source: env.SOURCE_LABEL }, now);
    }
    await pruneExpired(env.ARCHIVE, now);
  } catch {
    failed = true; reason = 'backup batch failed';
  }
  try {
    const current = (await manifests(env.ARCHIVE))[0];
    if (!current || now - Date.parse(current.startedAt) > MAX_AGE_MS) {
      failed = true; reason = 'no successful paired restore point in 24 hours';
    } else {
      await validateBackup(env.ARCHIVE, current.key, now);
    }
  } catch {
    failed = true; reason = 'restore point validation or storage failed';
  }
  if (env.PREVIEW) {
    try {
      // Service binding reaches the app Worker verifier directly: no Access JWT
      // should be accepted; this is a safe anonymous boundary/readiness probe.
      const r = await env.PREVIEW.fetch('https://preview.invalid/api/auth/me');
      if (r.status !== 403) { failed = true; reason = 'application authentication boundary check failed'; }
    } catch { failed = true; reason = 'application check failed'; }
  }
  return notifyState({ archive: env.ARCHIVE, email: env.EMAIL, to: env.ALERT_TO, from: env.ALERT_FROM, failed, reason, source: env.SOURCE_LABEL }, now);
}
