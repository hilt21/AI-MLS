import { manifests, MAX_AGE_MS, validateBackup } from './backup.mjs';
import { notifyState } from './monitor.mjs';
import { checkApplication } from './application-health.mjs';
export async function checkBackup(env, now = Date.now()) {
  let failed = false;
  let reason = 'independent restore-point check current';
  try {
    const latest = (await manifests(env.ARCHIVE))[0];
    if (!latest || now - Date.parse(latest.startedAt) > MAX_AGE_MS) {
      failed = true; reason = 'no successful paired restore point in 24 hours';
    } else await validateBackup(env.ARCHIVE, latest.key, now);
    if (env.BACKUP_WORKER) {
      const response = await env.BACKUP_WORKER.fetch('https://operations.invalid/');
      if (response.status !== 404) { failed = true; reason = 'backup Worker readiness failed'; }
    }
  } catch { failed = true; reason = 'independent restore-point validation or storage failed'; }
  // An explicitly authorized transport is required; a 403 is never readiness.
  // No production transport or Access credentials are provisioned here.
  if (env.APPLICATION_HEALTH && !await checkApplication(env.APPLICATION_HEALTH, 'https://application.invalid/api/health')) {
    failed = true; reason = 'application dependency readiness failed';
  }
  return notifyState({ archive: env.ARCHIVE, email: env.EMAIL, to: env.ALERT_TO,
    from: env.ALERT_FROM, failed, reason, stateKey: 'watchdog.json', source: env.SOURCE_LABEL }, now);
}
const watchdog = {
  fetch() { return new Response('Not found', { status: 404 }); },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(checkBackup(env).then(async result => {
      await env.ARCHIVE.put('watchdog-run.json', JSON.stringify({ completedAt: new Date().toISOString(), version: env.VERSION?.id ?? null }));
      console.info('M3 independent scheduled run completed');
      return result;
    }).catch(error => {
      console.error('M3 independent check failed', { errorType: error?.name ?? 'Unknown' });
      throw error;
    }));
  },
};
export default watchdog;
