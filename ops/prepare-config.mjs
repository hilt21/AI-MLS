import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export function pilotConfig(role, env) {
  if (!['backup', 'watchdog'].includes(role)) throw new Error('Choose backup or watchdog');
  for (const name of ['M3_ACCOUNT_ID', 'M3_SOURCE_DATABASE_ID', 'M3_PRODUCTION_DATABASE_ID', 'M3_ALERT_TO', 'M3_ALERT_FROM']) {
    if (!env[name]) throw new Error(`Missing ${name}`);
  }
  if (!/^[a-f0-9]{32}$/.test(env.M3_ACCOUNT_ID)) throw new Error('Invalid account ID');
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  if (![env.M3_SOURCE_DATABASE_ID, env.M3_PRODUCTION_DATABASE_ID].every(id => uuid.test(id)) || env.M3_SOURCE_DATABASE_ID === env.M3_PRODUCTION_DATABASE_ID) throw new Error('Distinct audited source and production database IDs required');
  if (![env.M3_ALERT_TO, env.M3_ALERT_FROM].every(address => /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address))) throw new Error('Valid verified email addresses required');
  const config = {
    name: role === 'backup' ? 'ai-mls-pilot-ops' : 'ai-mls-pilot-watchdog',
    account_id: env.M3_ACCOUNT_ID,
    main: fileURLToPath(new URL(role === 'backup' ? './worker.mjs' : './watchdog.mjs', import.meta.url)),
    compatibility_date: '2026-09-25', workers_dev: false, preview_urls: false,
    observability: { enabled: true }, version_metadata: { binding: 'VERSION' },
    vars: { ALERT_TO: env.M3_ALERT_TO, ALERT_FROM: env.M3_ALERT_FROM, SOURCE_LABEL: 'isolated-cloud-preview' },
    send_email: [{ name: 'EMAIL', destination_address: env.M3_ALERT_TO, allowed_sender_addresses: [env.M3_ALERT_FROM] }],
    r2_buckets: [{ binding: 'ARCHIVE', bucket_name: 'ai-mls-m3-backups' }],
    triggers: { crons: role === 'backup' ? ['0 */12 * * *'] : ['15 * * * *'] },
  };
  if (role === 'backup') {
    config.d1_databases = [{ binding: 'SOURCE_DB', database_name: 'ai-mls-preview-db', database_id: env.M3_SOURCE_DATABASE_ID }];
    config.r2_buckets.push({ binding: 'SOURCE_IMAGES', bucket_name: 'ai-mls-preview-images' });
  } else config.services = [{ binding: 'BACKUP_WORKER', service: 'ai-mls-pilot-ops' }];
  return config;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [role, output] = process.argv.slice(2);
  if (!output) throw new Error('Usage: node ops/prepare-config.mjs backup|watchdog /absolute/private/config.json');
  if (!output.startsWith('/')) throw new Error('Private absolute output path required');
  await writeFile(output, JSON.stringify(pilotConfig(role, process.env), null, 2), { mode: 0o600 });
  console.info(`Prepared ${role} pilot config; verify actual resource bindings before deployment.`);
}
