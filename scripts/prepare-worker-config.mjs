import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function createReleaseConfig(generated, template, environment = process.env) {
  const settings = JSON.parse(JSON.stringify(template), (_, value) => {
    const variable = typeof value === 'string' && /^\$\{([A-Z0-9_]+)\}$/.exec(value);
    if (!variable) return value;
    const resolved = environment[variable[1]]?.trim();
    if (!resolved) throw new Error(`Missing release variable: ${variable[1]}`);
    return resolved;
  });
  for (const target of [settings.production, settings.previews]) {
    const database = target?.d1_databases?.[0];
    const bucket = target?.r2_buckets?.[0];
    if (target?.d1_databases?.length !== 1 || database.binding !== 'DB'
      || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(database.database_id)
      || database.database_id === '00000000-0000-4000-8000-000000000000') {
      throw new Error('An explicit DB database UUID is required for each target');
    }
    if (target?.r2_buckets?.length !== 1 || bucket.binding !== 'BUCKET' || !bucket.bucket_name) {
      throw new Error('An explicit BUCKET is required for each target');
    }
    if (!target.vars?.CLOUDFLARE_ACCESS_ISSUER?.startsWith('https://') || !target.vars?.CLOUDFLARE_ACCESS_AUD
      || Object.keys(target.vars).some(key => !['CLOUDFLARE_ACCESS_ISSUER', 'CLOUDFLARE_ACCESS_AUD'].includes(key))) {
      throw new Error('Only the two non-secret Access settings belong in release configuration');
    }
  }
  if (settings.production.d1_databases[0].database_id === settings.previews.d1_databases[0].database_id
    || settings.production.r2_buckets[0].bucket_name === settings.previews.r2_buckets[0].bucket_name) {
    throw new Error('Preview D1/R2 must differ from production');
  }
  const inheritModel = environment.AI_MLS_PREVIEW_MODEL_INHERIT;
  if (inheritModel !== undefined && inheritModel !== '1') {
    throw new Error('AI_MLS_PREVIEW_MODEL_INHERIT must be unset or 1');
  }
  if (inheritModel === '1') {
    // Preview uploads ignore keep_vars. Inherit only this Preview's existing model bindings.
    settings.previews.unsafe = {
      bindings: ['MODEL_API_KEY', 'MODEL_BASE_URL', 'MODEL_NAME']
        .map(name => ({ name, type: 'inherit' })),
    };
  }
  return {
    ...generated,
    account_id: settings.account_id,
    ...settings.production,
    keep_vars: true,
    previews: settings.previews,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const generated = JSON.parse(await readFile('dist/server/wrangler.json', 'utf8'));
  const settings = JSON.parse(await readFile('deployments/cloudflare.json', 'utf8'));
  const config = createReleaseConfig(generated, settings);
  await writeFile('dist/server/wrangler.release.json', JSON.stringify(config, null, 2) + '\n');
  console.log('Prepared dist/server/wrangler.release.json; production and Preview bindings are distinct.');
}
