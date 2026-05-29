import { executeTool } from "./composio";

export type FigmaFile = {
  file_key: string;
  name: string;
  thumbnail_url?: string | null;
  last_modified?: string | null;
  // When the URL was a dev link (or any link with `?node-id=...`) we pass
  // the targeted node along so the picker can default the "Add" action to
  // chipping that frame rather than the whole file.
  target_node_id?: string | null;
  target_node_name?: string | null;
};

// Parse file_key + node_id directly from any Figma URL — more reliable than
// relying on Composio discovery to surface the node id, and lets us extract
// IDs even when the discovery call fails.
function extractIdsFromUrl(url: string): {
  fileKey: string | null;
  nodeId: string | null;
} {
  const fileMatch = url.match(
    /figma\.com\/(?:file|design|board|proto|slides|community\/file)\/([A-Za-z0-9]+)/i
  );
  const nodeMatch = url.match(/[?&]node-id=([^&#]+)/i);
  // Figma URLs serialize node ids as "67-3500"; the REST API wants "67:3500".
  const nodeId = nodeMatch
    ? decodeURIComponent(nodeMatch[1]).replace(/-/g, ":")
    : null;
  return { fileKey: fileMatch?.[1] ?? null, nodeId };
}

export type FigmaNode = {
  id: string;          // node id, e.g. "12:34"
  name: string;
  type: string;        // FRAME, COMPONENT, GROUP, PAGE, etc.
};

type ComposioResult = { data?: unknown; successful?: boolean; error?: string | null };
function unwrap(res: unknown): unknown {
  const r = res as ComposioResult;
  return r && typeof r === "object" && "data" in r ? r.data : res;
}

// ----- URL → file resolution ----------------------------------------------

// `FIGMA_DISCOVER_FIGMA_RESOURCES` accepts a `figma_url` and extracts file_key,
// node_id, team_id from any Figma URL format (file/, design/, board/, proto/,
// slides/). Returns the resolved file metadata.
export async function resolveFigmaUrl(
  userId: string,
  url: string
): Promise<FigmaFile | null> {
  // Parse first so we can fall back if discovery fails.
  const { fileKey: parsedKey, nodeId } = extractIdsFromUrl(url);

  let fileKey: string | null = null;
  let name: string | null = null;
  let thumbnail: string | null = null;
  let lastModified: string | null = null;

  try {
    const res = await executeTool("FIGMA_DISCOVER_FIGMA_RESOURCES", {
      userId,
      arguments: { figma_url: url },
    });
    const data = unwrap(res) as Record<string, unknown> | null;
    if (data) {
      fileKey =
        (data.file_key as string) ??
        ((data.file as Record<string, unknown> | undefined)?.key as string) ??
        null;
      name =
        (data.file_name as string) ??
        ((data.file as Record<string, unknown> | undefined)?.name as string) ??
        null;
      thumbnail = (data.thumbnail_url as string) ?? null;
      lastModified = (data.last_modified as string) ?? null;
    }
  } catch (e) {
    console.warn("[figma] discover failed, falling back to URL parse:", e);
  }

  // Discovery sometimes refuses dev URLs (extra query params confuse it).
  // Fall through to the parsed file_key so the picker still shows a result —
  // GET_FILE_JSON will pull the real name during indexing.
  if (!fileKey && parsedKey) fileKey = parsedKey;
  if (!fileKey) return null;

  // Discovery often returns the file_key but no human name. One small extra
  // GET_FILE_JSON call gives us the real title for the chip UI.
  if (!name) {
    try {
      const meta = await executeTool("FIGMA_GET_FILE_JSON", {
        userId,
        arguments: { file_key: fileKey },
      });
      const md = unwrap(meta) as Record<string, unknown> | null;
      if (md?.name) name = String(md.name);
      if (md?.lastModified && !lastModified) lastModified = String(md.lastModified);
    } catch {
      // Non-fatal — leave the name blank, indexer will fix it later.
    }
  }

  // Resolve the targeted node's name lazily — only worth a round-trip when
  // we actually have one to look up, and even then it's a nicety.
  let targetNodeName: string | null = null;
  if (nodeId) {
    try {
      const nodes = await listFileNodes(userId, fileKey, 3);
      targetNodeName = nodes.find((n) => n.id === nodeId)?.name ?? null;
    } catch {
      // Non-fatal — we can still chip the node by id alone.
    }
  }

  return {
    file_key: fileKey,
    name: name ?? fileKey,
    thumbnail_url: thumbnail,
    last_modified: lastModified,
    target_node_id: nodeId,
    target_node_name: targetNodeName,
  };
}

// ----- File → node tree ---------------------------------------------------

export async function listFileNodes(
  userId: string,
  fileKey: string,
  maxDepth = 2
): Promise<FigmaNode[]> {
  const res = await executeTool("FIGMA_DISCOVER_FIGMA_RESOURCES", {
    userId,
    arguments: { file_key: fileKey, max_depth: maxDepth },
  });
  const data = unwrap(res) as Record<string, unknown> | null;
  if (!data) return [];
  const nodes =
    (data.nodes as unknown[]) ??
    (data.children as unknown[]) ??
    [];
  if (!Array.isArray(nodes)) return [];
  return nodes
    .map(flattenNode)
    .flat()
    .filter((n): n is FigmaNode => !!n)
    .filter((n) => n.type !== "DOCUMENT");
}

// Discovery returns nested {id, name, type, children?}. We flatten into a
// single list — at depth 2 the leaves are typically frames inside pages.
function flattenNode(raw: unknown): FigmaNode[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? "");
  const name = String(r.name ?? "");
  const type = String(r.type ?? "");
  const here = id && name ? [{ id, name, type }] : [];
  const children = (r.children as unknown[]) ?? [];
  const nested = Array.isArray(children) ? children.flatMap(flattenNode) : [];
  return [...here, ...nested];
}

// ----- Rendering ----------------------------------------------------------

// In-memory cache for rendered URLs and recent failures.
// Composio's render endpoint is rate-limited; once we're throttled, hammering
// it on every <img> load just extends the cooldown. We cache the *failure*
// briefly so subsequent requests in the same window get an immediate 429
// without touching Composio. Successful URLs cache for hours — the underlying
// Figma S3 URL is valid for ~30 days.
type CacheEntry =
  | { kind: "ok"; url: string; expiresAt: number }
  | { kind: "rate_limited" | "none"; expiresAt: number };
const renderCache = new Map<string, CacheEntry>();
const OK_TTL_MS = 6 * 60 * 60 * 1000;       // 6 hours
const FAIL_TTL_MS = 60 * 1000;              // 60 seconds — long enough to
                                            // absorb a page-load burst, short
                                            // enough that a manual retry works.

export type ImageRenderResult =
  | { status: "ok"; url: string }
  | { status: "rate_limited" }
  | { status: "none" };

export async function getNodeImageUrl(
  userId: string,
  fileKey: string,
  nodeId: string,
  format: "png" | "jpg" | "svg" | "pdf" = "png",
  scale = 1
): Promise<ImageRenderResult> {
  const key = `${userId}:${fileKey}:${nodeId}:${format}:${scale}`;
  const cached = renderCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.kind === "ok") return { status: "ok", url: cached.url };
    return { status: cached.kind };
  }

  const res = await executeTool("FIGMA_RENDER_IMAGES_OF_FILE_NODES", {
    userId,
    arguments: { file_key: fileKey, ids: nodeId, format, scale },
  });
  const data = unwrap(res) as
    | { images?: Record<string, string | null>; err?: string | null; status?: number | null }
    | null;

  // Composio returns `status: 200, err: null, images: {…}` on success and
  // `status: 429, err: "Rate limit exceeded", images: {}` when throttled —
  // both with `successful: true` at the outer envelope.
  if (data?.status === 429 || (data?.err && /rate limit/i.test(String(data.err)))) {
    renderCache.set(key, {
      kind: "rate_limited",
      expiresAt: Date.now() + FAIL_TTL_MS,
    });
    return { status: "rate_limited" };
  }

  const url = data?.images?.[nodeId];
  if (!url) {
    renderCache.set(key, { kind: "none", expiresAt: Date.now() + FAIL_TTL_MS });
    return { status: "none" };
  }

  renderCache.set(key, {
    kind: "ok",
    url,
    expiresAt: Date.now() + OK_TTL_MS,
  });
  return { status: "ok", url };
}

// ----- Indexing content ---------------------------------------------------

// Used by the indexer: pull the simplified file JSON, walk it, and produce
// one "file" per top-level frame so chunking groups text by where it sits in
// the design.
export type FigmaFrameContent = {
  path: string;        // e.g. "Page > Frame name"
  content: string;     // assembled text content
  nodeId: string;      // Figma node id, e.g. "82:2053"
  nodeName: string;    // human-friendly frame name
};

export async function getFileContentForIndexing(
  userId: string,
  fileKey: string,
  scopedNodeId: string | null
): Promise<{ fileName: string; frames: FigmaFrameContent[] }> {
  const args: Record<string, unknown> = { file_key: fileKey };
  if (scopedNodeId) args.ids = scopedNodeId;
  const res = await executeTool("FIGMA_GET_FILE_JSON", {
    userId,
    arguments: args,
  });
  const data = unwrap(res) as Record<string, unknown> | null;
  if (!data) return { fileName: fileKey, frames: [] };

  const fileName = String(data.name ?? data.file_name ?? fileKey);

  // FIGMA_GET_FILE_JSON returns one of:
  //   { nodes: [{id, name, type:CANVAS|FRAME|..., children}, ...] }  ← simplified mode + scoped queries
  //   { document: { ..., children: [...] } }                          ← older raw format
  // We accept either, normalising to a list of root subtrees to walk.
  const roots: unknown[] = [];
  if (Array.isArray(data.nodes)) {
    roots.push(...(data.nodes as unknown[]));
  } else if (data.document) {
    roots.push(data.document);
  } else if (data.simplified) {
    roots.push(data.simplified);
  } else {
    roots.push(data);
  }

  const frames: FigmaFrameContent[] = [];
  for (const root of roots) {
    const before = frames.length;
    walkForFrames(root, [], frames);
    // No FRAME-typed descendants under this root — happens when the user
    // pointed at a leaf shape (RECTANGLE, ELLIPSE, etc.) or a page that
    // only contains shapes. Synthesize a stub so the chip still indexes,
    // and so the chat route can stamp a screenshot URL onto the chunk
    // (any chunk with file_key + node_id gets a screenshot_url).
    if (frames.length === before) {
      const stub = synthesizeStubFrame(root);
      if (stub) frames.push(stub);
    }
  }

  // Last resort: the API returned something we couldn't walk at all
  // (unfamiliar response shape, or an empty scoped query). Fall back to a
  // file-level entry keyed on the scoped node or the document root so the
  // screenshot endpoint still has coordinates to render.
  if (frames.length === 0) {
    frames.push({
      path: fileName,
      content: `Figma file: ${fileName}`,
      nodeId: scopedNodeId ?? "0:0",
      nodeName: fileName,
    });
  }

  return { fileName, frames };
}

// Builds a single frame entry from a root node when walkForFrames couldn't
// find any FRAME-typed descendants. Uses whatever text + names live under
// the node — at minimum the node's own name — so the embedding has *some*
// signal and the chunk carries the node_id needed for screenshot rendering.
function synthesizeStubFrame(root: unknown): FigmaFrameContent | null {
  if (!root || typeof root !== "object") return null;
  const r = root as Record<string, unknown>;
  const nodeId = String(r.id ?? "");
  if (!nodeId) return null;
  const name = String(r.name ?? "") || nodeId;
  const type = String(r.type ?? "") || "NODE";
  const text = collectText(r).trim();
  const lines = [`Figma ${type.toLowerCase()}: ${name}`];
  if (text && text !== name) lines.push(text);
  return {
    path: name,
    content: lines.join("\n"),
    nodeId,
    nodeName: name,
  };
}

const FRAME_TYPES = new Set(["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE"]);

function walkForFrames(
  node: unknown,
  ancestors: string[],
  out: FigmaFrameContent[]
) {
  if (!node || typeof node !== "object") return;
  const r = node as Record<string, unknown>;
  const name = String(r.name ?? "");
  const type = String(r.type ?? "");
  const nextAncestors = name ? [...ancestors, name] : ancestors;

  if (FRAME_TYPES.has(type)) {
    const text = collectText(r).trim();
    const nodeId = String(r.id ?? "");
    if (text && nodeId) {
      out.push({
        path: nextAncestors.join(" > "),
        content: text,
        nodeId,
        nodeName: name || nodeId,
      });
    }
    // Don't descend into nested frames separately — keep the top-level frame
    // as one chunkable unit.
    return;
  }

  // Pages, groups, the document itself — recurse to find frames inside.
  const children = (r.children as unknown[]) ?? [];
  if (Array.isArray(children)) {
    for (const child of children) walkForFrames(child, nextAncestors, out);
  }
}

// Pull every TEXT node's characters out of a subtree, plus the frame's own
// name, so the embedding has something to match against.
function collectText(root: unknown): string {
  const parts: string[] = [];
  function visit(n: unknown) {
    if (!n || typeof n !== "object") return;
    const r = n as Record<string, unknown>;
    const type = String(r.type ?? "");
    const name = String(r.name ?? "");
    if (name) parts.push(name);
    if (type === "TEXT" && typeof r.characters === "string") {
      parts.push(r.characters as string);
    }
    const children = (r.children as unknown[]) ?? [];
    if (Array.isArray(children)) for (const c of children) visit(c);
  }
  visit(root);
  return Array.from(new Set(parts)).join("\n");
}
