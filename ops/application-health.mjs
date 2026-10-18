// Caller supplies an already-authorized transport. This never creates credentials.
export async function checkApplication(fetcher, request) {
  try {
    const response = await fetcher.fetch(new Request(request, {
      method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000),
    }));
    if (response.status !== 200) return false;
    const body = await response.json();
    return body.ready === true && body.checks?.database === true && body.checks?.images === true;
  } catch { return false; }
}
