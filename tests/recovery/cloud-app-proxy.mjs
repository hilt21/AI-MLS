// Local operator gateway to the private restored cloud application. Never deploy.
const proxy = {
  async fetch(request, env) {
    if (!['127.0.0.1', 'localhost'].includes(new URL(request.url).hostname)) return new Response('Local operator only', { status: 403 });
    const user = request.headers.get('x-e2e-user');
    if (!['m3-synthetic-owner', 'm3-other-owner'].includes(user)) return new Response('Synthetic operator identity required', { status: 403 });
    const headers = new Headers(request.headers);
    for (const name of [...headers.keys()]) if (name.startsWith('oai-authenticated-user-') || name === 'cf-access-jwt-assertion') headers.delete(name);
    headers.set('oai-authenticated-user-id', user);
    headers.set('oai-authenticated-user-email', `${user}@example.test`);
    return env.APP.fetch(new Request(request, { headers }));
  },
};
export default proxy;
