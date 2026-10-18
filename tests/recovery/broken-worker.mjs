// Deliberate fault for the isolated pilot Worker rollback drill only.
import worker from '../../ops/worker.mjs';
export default { ...worker, fetch() { return new Response('M3 injected failure', { status: 500 }); } };
