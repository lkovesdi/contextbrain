// Fire-and-forget trigger of the indexing worker on the same origin.
// Disconnects after 2s — the worker has already started reading the request by
// then, and we don't need its response. Without the abort, undici would log a
// "headers timeout" 5 minutes later for long-running indexers.
//
// The target origin MUST come from a trusted, server-controlled value, not
// request headers (Host / X-Forwarded-Proto are attacker-controlled and were
// previously used here, which let a caller redirect this self-call — cookie
// included — to an arbitrary host).
function ownOrigin(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export function triggerIndexing(req: Request, contextId: string) {
  const cookie = req.headers.get("cookie") ?? "";
  void fetch(`${ownOrigin()}/api/contexts/${contextId}/index`, {
    method: "POST",
    headers: { cookie },
    signal: AbortSignal.timeout(2000),
  }).catch((e) => {
    if (e instanceof Error && e.name === "AbortError") return;
    console.error("index trigger failed:", e);
  });
}
