// Test-only entry; never referenced by production or Preview release configs.
import { setModelMode } from './model.mjs';
import application from '../../dist/server/index.js';
const testWorker = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return new Response('Local tests only', { status: 403 });
    if (url.pathname === '/__fixture/model-mode' && request.method === 'POST') {
      setModelMode(await request.text());
      return new Response('ok');
    }
    const headers = new Headers(request.headers);
    for (const name of [...headers.keys()]) if (name.startsWith('oai-authenticated-user-')) headers.delete(name);
    const user = headers.get('x-e2e-user');
    if (user) {
      headers.set('oai-authenticated-user-id', user);
      headers.set('oai-authenticated-user-email', `${user}@example.test`);
    }
    return application.fetch(new Request(request, { headers }), env, ctx);
  },
};

export default testWorker;
