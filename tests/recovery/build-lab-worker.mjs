// Inert test target for Builds trigger/retry/configuration rehearsal.
const worker = { fetch() { return new Response('Not found', { status: 404 }); } };
export default worker;
