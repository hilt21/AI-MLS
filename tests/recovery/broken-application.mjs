// Deliberate progress-API regression for the private restored-app drill only.
import application from '../../dist/server/index.js';
export default {
  ...application,
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname === '/api/progress') return Response.json({ error: 'M3 injected release fault' }, { status: 500 });
    return application.fetch(request, env, ctx);
  },
};
