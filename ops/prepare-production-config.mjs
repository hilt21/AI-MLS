// Generates a private, inactive production proposal. Never deploys or enables Cron.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pilotConfig } from './prepare-config.mjs';

export function productionConfig(role, env) {
  const config = pilotConfig(role, {
    M3_ACCOUNT_ID: env.M4_ACCOUNT_ID,
    M3_SOURCE_DATABASE_ID: env.M4_PREVIEW_DATABASE_ID,
    M3_PRODUCTION_DATABASE_ID: env.M4_PRODUCTION_DATABASE_ID,
    M3_ALERT_TO: env.M4_ALERT_TO, M3_ALERT_FROM: env.M4_ALERT_FROM,
  });
  config.name = role === 'backup' ? 'ai-mls-production-ops' : 'ai-mls-production-watchdog';
  config.vars.SOURCE_LABEL = 'production';
  config.triggers.crons = []; // Activation is a separately approved M4-B change.
  config.r2_buckets = [{ binding: 'ARCHIVE', bucket_name: 'ai-mls-production-backups' }];
  if (role === 'backup') {
    config.d1_databases = [{ binding: 'SOURCE_DB', database_name: 'ai-mls-db', database_id: env.M4_PRODUCTION_DATABASE_ID }];
    config.r2_buckets.push({ binding: 'SOURCE_IMAGES', bucket_name: 'site-creator-r2' });
  } else config.services = [{ binding: 'BACKUP_WORKER', service: 'ai-mls-production-ops' }];
  return config;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [role, output] = process.argv.slice(2);
  if (!output?.startsWith('/')) throw new Error('Private absolute output path required');
  await writeFile(output, JSON.stringify(productionConfig(role, process.env), null, 2), { mode: 0o600, flag: 'wx' });
  console.info('Prepared inactive production proposal; review bindings and obtain M4-B approval before use.');
}
