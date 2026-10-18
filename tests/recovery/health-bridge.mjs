// Localhost-only synthetic identity bridge to private test apps. Never deploy.
import { checkBackup } from '../../ops/watchdog.mjs';
const bridge = {
  async fetch(request, env) {
    if (!['localhost', '127.0.0.1'].includes(new URL(request.url).hostname) || request.method !== 'POST') return new Response('Local operator only', { status: 403 });
    const { fault } = await request.json();
    if (typeof fault !== 'boolean') return new Response('Choose a fixed fixture', { status: 400 });
    const app = fault ? env.FAULT_APP : env.APP;
    const probes = [];
    const transport = { fetch: async req => { const r = await app.fetch(new Request(req, { headers: { 'oai-authenticated-user-id': 'm3-synthetic-owner', 'oai-authenticated-user-email': 'synthetic@example.test' } })); probes.push({ status: r.status, body: await r.clone().json() }); return r; } };
    const response = await transport.fetch(new Request('https://application.invalid/api/health'));
    // Dedicated notification state avoids altering the regular pilot watchdog.
    const archive = new Proxy(env.ARCHIVE, { get(target, name) {
      if (name === 'get' || name === 'put') return (key, ...args) => target[name](key === 'watchdog.json' ? 'm4-health.json' : key, ...args);
      const value = target[name]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const result = await checkBackup({ ...env, ARCHIVE: archive, APPLICATION_HEALTH: transport });
    return Response.json({ fault, applicationStatus: response.status, probes, ...result });
  },
};
export default bridge;
