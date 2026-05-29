import { Composio } from "@composio/core";
import { cache } from "react";
import { unstable_cache } from "next/cache";

// Composio's TS SDK requires a concrete toolkit version on every tools.execute
// call (it refuses `"latest"`). We pin sensible defaults here so the codebase
// is reproducible; per-environment overrides can come from
// `COMPOSIO_TOOLKIT_VERSION_<TOOLKIT_SLUG>` env vars (the SDK reads those itself).
//
// To bump: GET https://backend.composio.dev/api/v3.1/tools/<SLUG> with the API
// key — `available_versions[0]` is the most recent snapshot. Pinning means
// upstream tool changes won't break us silently; we update on our own cadence.
const TOOLKIT_VERSIONS = {
  github: "20260501_01",
  linear: "20260512_00",
  jira: "20260429_01",
  figma: "20260506_01",
};

export const composio = new Composio({
  apiKey: process.env.COMPOSIO_API_KEY!,
  toolkitVersions: TOOLKIT_VERSIONS,
});

export type Provider =
  | "github"
  | "jira"
  | "figma"
  | "linear"
  | "linkedin"
  | "zoom"
  | "slack"
  | "gmail";

export const AUTH_CONFIG: Record<Provider, string | undefined> = {
  github: process.env.COMPOSIO_GITHUB_AUTH_CONFIG,
  jira: process.env.COMPOSIO_JIRA_AUTH_CONFIG,
  figma: process.env.COMPOSIO_FIGMA_AUTH_CONFIG,
  linear: process.env.COMPOSIO_LINEAR_AUTH_CONFIG,
  linkedin: process.env.COMPOSIO_LINKEDIN_AUTH_CONFIG,
  zoom: process.env.COMPOSIO_ZOOM_AUTH_CONFIG,
  slack: process.env.COMPOSIO_SLACK_AUTH_CONFIG,
  gmail: process.env.COMPOSIO_GMAIL_AUTH_CONFIG,
};

// Composio's toolkit metadata includes a hosted logo URL. We cache for a day
// since logos rarely change, and dedupe within a single render via React cache.
const fetchToolkitLogo = unstable_cache(
  async (slug: Provider): Promise<string | null> => {
    try {
      const t = await composio.toolkits.get(slug);
      return t.meta?.logo ?? null;
    } catch (e) {
      console.error(`composio.toolkits.get(${slug}) failed:`, e);
      return null;
    }
  },
  ["composio-toolkit-logo"],
  { revalidate: 60 * 60 * 24 }
);

export const getToolkitLogos = cache(
  async (): Promise<Record<Provider, string | null>> => {
    const providers = Object.keys(AUTH_CONFIG) as Provider[];
    const entries = await Promise.all(
      providers.map(async (p) => [p, await fetchToolkitLogo(p)] as const)
    );
    return Object.fromEntries(entries) as Record<Provider, string | null>;
  }
);

// Thin wrapper so callers always go through one place — handy for future
// instrumentation (logs, retries, version overrides on a single call).
export async function executeTool(
  slug: string,
  params: {
    userId: string;
    arguments?: Record<string, unknown>;
    connectedAccountId?: string;
  }
): Promise<unknown> {
  return composio.tools.execute(slug, params);
}

export async function findActiveConnection(userId: string, provider: Provider) {
  const authConfigId = AUTH_CONFIG[provider];
  if (!authConfigId) return null;
  try {
    const list = await composio.connectedAccounts.list({
      userIds: [userId],
      authConfigIds: [authConfigId],
      statuses: ["ACTIVE"],
      limit: 1,
    });
    return list.items?.[0] ?? null;
  } catch (e) {
    console.error(`composio.list(${provider}) failed:`, e);
    return null;
  }
}

export async function initiateConnection(
  userId: string,
  provider: Provider,
  callbackUrl: string
) {
  const authConfigId = AUTH_CONFIG[provider];
  if (!authConfigId) {
    throw new Error(`Missing COMPOSIO_${provider.toUpperCase()}_AUTH_CONFIG`);
  }
  // `initiate` was deprecated for Composio-managed OAuth auth configs;
  // `link` is the new endpoint and returns the same ConnectionRequest shape.
  // Composio appends `?status=success` (or `?status=failed`) to the callbackUrl
  // when the user completes OAuth — so we route them back through our own
  // callback handler to flip the integrations row out of `pending`.
  const conn = await composio.connectedAccounts.link(userId, authConfigId, {
    callbackUrl,
  });
  return {
    redirectUrl: conn.redirectUrl ?? "",
    connectionId: conn.id,
  };
}

export async function fetchIntegrationContext(
  userId: string,
  provider: Provider,
  query: string
): Promise<unknown> {
  try {
    if (provider === "github") {
      return await executeTool("GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS", {
        userId,
        arguments: { q: query, per_page: 5 },
      });
    }
    if (provider === "jira") {
      return await executeTool("JIRA_SEARCH_ISSUES", {
        userId,
        arguments: { jql: `text ~ "${query.replace(/"/g, "")}"`, maxResults: 5 },
      });
    }
    if (provider === "figma") {
      // Figma is now a chip-based integration (see /api/contexts/figma).
      // The catalog has no free-text "search all my files" endpoint, so the
      // live-search path is intentionally a no-op — relevant Figma content
      // lands via `external_chunks` from the picker-attached files.
      return null;
    }
    if (provider === "linear") {
      // Linear's catalog tool is "list issues" rather than a free-text search;
      // we lean on it as the integration's read endpoint and let retrieval pick
      // out what's relevant from the returned issue payload.
      return await executeTool("LINEAR_LIST_LINEAR_ISSUES", {
        userId,
        arguments: { first: 10 },
      });
    }
    if (
      provider === "linkedin" ||
      provider === "zoom" ||
      provider === "slack" ||
      provider === "gmail"
    ) {
      // OAuth connect works, but we don't yet have a chosen tool slug for live
      // retrieval. Leaving these as no-ops (same shape as Figma) until we pick
      // the specific Composio tool — e.g. GMAIL_FETCH_EMAILS, SLACK_SEARCH_MESSAGES,
      // ZOOM_LIST_MEETINGS — and tune the query shape per provider.
      return null;
    }
  } catch (e) {
    console.error(`Composio ${provider} call failed:`, e);
    return null;
  }
  return null;
}
