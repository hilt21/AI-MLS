// Temporary isolated mail-channel probe. No Cron or public send endpoint.
export default {
  fetch() { return new Response('Not found', { status: 404 }); },
  async scheduled(_event, env) {
    if (!env.ALERT_TO || !env.ALERT_FROM) throw new Error('Mail probe configuration missing');
    const result = await env.EMAIL.send({
      to: env.ALERT_TO,
      from: { email: env.ALERT_FROM, name: 'AI-MLS pilot operations' },
      subject: '[AI-MLS M3] Alert channel delivery test',
      text: 'This is the authorized AI-MLS M3 test-environment alert channel test. No production data is included. No automatic rollback was performed.',
      html: '<p>This is the authorized AI-MLS M3 test-environment alert channel test. No production data is included. No automatic rollback was performed.</p>',
    });
    console.info(JSON.stringify({ event: 'm3-mail-probe-accepted', messageId: result?.messageId ?? null }));
  },
};
