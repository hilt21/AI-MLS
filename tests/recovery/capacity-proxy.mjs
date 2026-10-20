// Local operator only. Never deploy. No credentials or production bindings.
const proxy = {
  async fetch(request, env) {
    if (!['localhost', '127.0.0.1'].includes(new URL(request.url).hostname) || request.method !== 'POST') return new Response('Local operator only', { status: 403 });
    return env.CAPACITY.fetch('https://capacity.invalid/', { method: 'POST', body: await request.text(), headers: { 'content-type': 'application/json' } });
  },
};
export default proxy;
