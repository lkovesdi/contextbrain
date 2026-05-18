// Fire-and-forget trigger of the indexing worker on the same origin.
// Disconnects after 2s — the worker has already started reading the request by
// then, and we don't need its response. Without the abort, undici would log a
// "headers timeout" 5 minutes later for long-running indexers.
export function triggerIndexing(req: Request, contextId: string) {
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host = req.headers.get("host") ?? "localhost:3000";
  const cookie = req.headers.get("cookie") ?? "";
  void fetch(`${proto}://${host}/api/contexts/${contextId}/index`, {
    method: "POST",
    headers: { cookie },
    signal: AbortSignal.timeout(2000),
  }).catch((e) => {
    if (e instanceof Error && e.name === "AbortError") return;
    console.error("index trigger failed:", e);
  });
}
