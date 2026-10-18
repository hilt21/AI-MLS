import { tick } from './monitor.mjs';
const worker = {
  fetch() { return new Response('Not found', { status: 404 }); },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(tick(env).then(async result => {
      await env.ARCHIVE.put('backup-run.json', JSON.stringify({ completedAt: new Date().toISOString(), version: env.VERSION?.id ?? null }));
      console.info('M3 backup scheduled run completed');
      return result;
    }).catch(error => {
      console.error('M3 monitor run failed', { errorType: error?.name ?? 'Unknown' });
      throw error;
    }));
  },
};
export default worker;
