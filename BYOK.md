# Feature: Bring Your Own Key (BYOK) + Model Selection

**Status:** Proposed
**Owner:** TBD
**Last updated:** 2026-06-17

## Summary

Let users supply their **own** Anthropic / OpenAI API keys in a Settings screen, choose
which **up-to-date model** runs each AI task, and see **our recommendation** for the best
model per task. Today every LLM call uses ContextBrain's platform keys (`ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`) with hardcoded model IDs. This feature makes the provider, key, and model
per-user and configurable, while keeping our keys as the default fallback.

Why:
- **Cost** — power users can run on their own billing instead of ours.
- **Choice** — pick a cheaper/faster model (Haiku/Sonnet) or a stronger one (Opus/Fable) per task.
- **Freshness** — model lists are fetched live from each provider, so new releases appear without a deploy.
- **Trust** — give a clear, opinionated recommendation so users don't have to guess.

## Goals

1. Users enter Anthropic and/or OpenAI keys in Settings; keys are validated and stored encrypted.
2. Users select a model per AI task from a **live** list pulled from the provider's models API.
3. We surface a **recommended** model per task with a one-line rationale; "Recommended" is the default.
4. All server-side AI routes resolve `{provider, apiKey, model}` per user at request time, falling back to platform keys + defaults when the user hasn't configured BYOK.
5. No regression for users who never touch Settings — behavior is identical to today.

## Non-goals (v1)

- Per-meeting or per-message model overrides (settings are account-wide).
- Non-Anthropic/OpenAI providers (Gemini, local models, OpenRouter). Architecture should not preclude them later.
- Showing/billing live token usage or cost dashboards (track as a follow-up).
- Letting users bring their own **embedding** key independently of chat — see "Embeddings" caveat below.

## User stories

- *As a user*, I open Settings → API & Models, paste my Anthropic key, and see a green "Connected" badge once it validates.
- *As a user*, for "Meeting Summary" I open a model dropdown showing the current Anthropic models, with "Claude Opus 4.8 — Recommended" preselected and a tooltip explaining why.
- *As a user*, I pick a cheaper model for tag suggestions and a stronger one for summaries.
- *As a user without a key*, everything keeps working on ContextBrain's keys and defaults; the model dropdowns show our defaults as "Recommended (using ContextBrain)".

---

## Current state (grounded in the codebase)

There is **no settings page** yet. The closest surface is the Integrations page.

| Concern | Where | Notes |
|---|---|---|
| Navigation | [Sidebar.tsx](src/app/(app)/Sidebar.tsx) | Meetings, Spaces, Contexts, Presets, Integrations. **Add "Settings".** |
| OAuth integrations (pattern to mirror) | [integrations/page.tsx](src/app/(app)/integrations/page.tsx) | Cards + connect flow; not a credentials store. |
| Chat (RAG, streaming) | [api/chat/route.ts](src/app/api/chat/route.ts) | `@ai-sdk/anthropic`, `claude-opus-4-7` or `claude-sonnet-4-6` (token heuristic). |
| Meeting summary (structured) | [api/meetings/[id]/summary/route.ts](src/app/api/meetings/[id]/summary/route.ts) | `generateObject`, `claude-opus-4-7` hardcoded. |
| Quick catch-up (streaming) | [api/meetings/[id]/catch-up/route.ts](src/app/api/meetings/[id]/catch-up/route.ts) | Opus/Sonnet token heuristic. |
| Tag suggestions | [api/meetings/[id]/tags/suggest/route.ts](src/app/api/meetings/[id]/tags/suggest/route.ts) | `generateObject`, `claude-sonnet-4-6`. |
| Embeddings | [embed.ts](src/lib/embed.ts) | `openai` SDK, `text-embedding-3-small`. |
| Data layer | [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql) | `pgcrypto` enabled; per-user RLS pattern; **no `user_settings` table**. |
| UI primitives | [src/components/ui/](src/components/ui/) | `Input`, `Select`, `Button`, `Checkbox`, `Card`, `Modal`, `Badge`, `typography`. |

**Key facts that shape the design:**
- All LLM calls are **server-side** (Next.js route handlers). The Tauri desktop app proxies through the web backend — it never holds the key. So BYOK keys live server-side, encrypted, and are used inside the routes.
- Model IDs are **hardcoded inline** — there is no central model config. This feature introduces one.
- The codebase currently pins `claude-opus-4-7` / `claude-sonnet-4-6`. The current recommended Anthropic flagship is **`claude-opus-4-8`** (same API surface as 4.7, no breaking changes) — see [AGENTS.md](AGENTS.md) and the `claude-api` skill. We should bump defaults to 4.8 as part of this work and let the live list expose newer ones automatically.

---

## Proposed UX

### New page: Settings → "API & Models"

Add a **Settings** entry to [Sidebar.tsx](src/app/(app)/Sidebar.tsx) and a route at
`src/app/(app)/settings/page.tsx` (use tabs if more settings categories land later).

Two sections, both built from existing `src/components/ui` primitives (no native `<select>`):

#### 1. Provider Credentials

Per provider (Anthropic, OpenAI):

```
┌─ Anthropic ────────────────────────────────  ● Connected ┐
│  API key   [ sk-ant-•••••••••••••••••••• ]   [ Save ]      │
│  Use my key for Anthropic tasks   [✓]                      │
│  Last validated: 2026-06-17 · 7 models available           │
└────────────────────────────────────────────────────────────┘
```

- `Input` with `type="password"` + reveal toggle. Show only a masked suffix once saved (never re-render the full key).
- `Button` "Save" → validates the key by calling the provider's models endpoint, then stores it encrypted.
- `Badge` for status: `ok` Connected · `alert` Invalid · `idle` Not set.
- `Checkbox` "Use my key" — lets a user store a key but temporarily fall back to ContextBrain's keys without deleting it.
- "Remove key" action behind `ConfirmModal`.

#### 2. Model selection (per task)

One `Select` per AI task. Options come from the **live** model list for whichever provider/key
is active. The recommended option is first, labeled `… — Recommended`, and is the default
(stored as the sentinel `"recommended"`, not a pinned ID, so the recommendation can evolve).

```
Meeting Summary     [ Claude Opus 4.8 — Recommended  ▼ ]   ⓘ best at structured extraction
Chat / Q&A          [ Claude Opus 4.8 — Recommended  ▼ ]   ⓘ deep reasoning over your context
Quick Catch-up      [ Claude Sonnet 4.6 — Recommended ▼ ]  ⓘ fast, cheap, great for recaps
Tag Suggestions     [ Claude Haiku 4.5 — Recommended  ▼ ]  ⓘ tiny task, cheapest model
Embeddings          [ text-embedding-3-small — Recommended ▼ ]  ⓘ retrieval default (see caveat)
```

- The `ⓘ` tooltip carries the **rationale** from the recommendation map below.
- If no key is set for the task's provider, the `Select` still renders but is annotated
  "using ContextBrain" and the recommendation is our platform default.
- Each task's "Recommended" badge resolves to a concrete model at request time so the
  user always sees what will actually run.

---

## Recommendations (per task)

We maintain a small **recommendation map** in code (the single source of truth for both the
default model and the rationale string shown in the UI). Live-fetched models are the *options*;
this map decides which one we star.

| Task | Recommended (default) | Why | Cheaper alt | Stronger alt |
|---|---|---|---|---|
| **Meeting Summary** | `claude-opus-4-8` | Best at long-context structured extraction (decisions, questions, tickets). | `claude-sonnet-4-6` | `claude-fable-5` |
| **Chat / Q&A** | `claude-opus-4-8` | Deep reasoning over retrieved context; current heuristic already escalates to Opus. | `claude-sonnet-4-6` | `claude-fable-5` |
| **Quick Catch-up** | `claude-sonnet-4-6` | Fast + cheap; recap quality is high and latency matters here. | `claude-haiku-4-5` | `claude-opus-4-8` |
| **Tag Suggestions** | `claude-haiku-4-5` | Tiny classification-style task; cheapest model is plenty. | — | `claude-sonnet-4-6` |
| **Embeddings** | `text-embedding-3-small` | Matches current retrieval index; cheap, 1536-dim. | — | `text-embedding-3-large` |

Notes:
- Model IDs are exact strings — never append date suffixes (see `claude-api` skill). The flagship
  is `claude-opus-4-8`; `claude-fable-5` is the most capable (and priciest) Anthropic model, offered
  as a "stronger alt" only.
- The recommendation map is versioned in the repo; when a new flagship ships we update one file
  and every "Recommended" badge moves with it. Users pinned to an explicit model are untouched.

### Why a map, not "just pick the newest"

The live list will include older and cheaper models too. "Newest" ≠ "best for this task" (a
recap shouldn't default to the most expensive model). The curated map is what makes the feature
feel like a recommendation rather than a raw dropdown.

---

## Live model lists

Fetch the provider's catalog with the **user's key** so the list reflects what *they* can access.

- **Anthropic:** `GET https://api.anthropic.com/v1/models` (header `anthropic-version: 2023-06-01`).
  Returns `id`, `display_name`, and per-model capabilities (context window, vision, etc.). The
  Anthropic SDK exposes `client.models.list()`.
- **OpenAI:** `GET https://api.openai.com/v1/models` (used for the embeddings picker).

Implementation:
- A server route, e.g. `GET /api/settings/models?provider=anthropic`, that calls the provider
  with the user's decrypted key and returns a normalized `{ id, displayName, recommendedFor[] }[]`.
- **Cache** results (per provider, ~1h) to avoid hammering the models endpoint on every Settings open.
- Filter to the relevant family per task (chat/completion models for Anthropic tasks; `text-embedding-*`
  for the embeddings picker).
- This call **doubles as key validation**: a 200 means the key works; 401/403 → mark Invalid.

---

## Data model

New migration (next sequence number, e.g. `00NN_user_settings.sql`) on the remote Supabase
project `nopzhjevenszabzkgdkl` via MCP `apply_migration` (no local DB — see project memory).

```sql
create table public.user_settings (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  -- encrypted provider keys (null = use ContextBrain platform key)
  anthropic_key  bytea,
  openai_key     bytea,
  anthropic_enabled boolean not null default true,
  openai_enabled    boolean not null default true,
  -- per-task model choices; null/"recommended" = resolve from recommendation map
  models         jsonb not null default '{}'::jsonb,  -- { summary, chat, catchup, tags, embeddings }
  key_status     jsonb not null default '{}'::jsonb,  -- { anthropic: {valid, validatedAt, count}, openai: {...} }
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.user_settings enable row level security;

create policy "own settings - select" on public.user_settings
  for select using (auth.uid() = user_id);
create policy "own settings - upsert" on public.user_settings
  for insert with check (auth.uid() = user_id);
create policy "own settings - update" on public.user_settings
  for update using (auth.uid() = user_id);
```

`models` shape:
```json
{ "summary": "claude-opus-4-8", "chat": "recommended", "catchup": "recommended",
  "tags": "claude-haiku-4-5", "embeddings": "recommended" }
```

---

## Security

Keys are secrets. Rules:

1. **Encrypt at rest.** `pgcrypto` is already enabled. Encrypt with `pgp_sym_encrypt(key, :app_secret)`
   server-side and store the ciphertext in the `bytea` columns; decrypt only inside the route that
   makes the LLM call. The symmetric secret is a server-only env var (e.g. `BYOK_ENCRYPTION_KEY`),
   **not** the Supabase anon key.
   - Alternative: a Node crypto AEAD (`aes-256-gcm`) helper in `src/lib/crypto.ts` if we'd rather
     keep encryption in app code than in SQL. Either is fine; pick one and centralize it.
2. **Never return the plaintext key** to the client. The Settings API returns only
   `{ status, maskedSuffix, modelCount, validatedAt }`.
3. **RLS** confines rows to their owner (pattern already used across the schema).
4. **Validate format** before storing (`sk-ant-…`, `sk-…`) and validate liveness via the models call.
5. **Redact in logs.** Never log decrypted keys or full request bodies that include them.
6. **Decryption happens late** — only in the AI route, on the server, per request.

---

## Backend changes

### 1. A central LLM config resolver

New `src/lib/llm.ts` (single source of truth; replaces the inline hardcoding):

```ts
type Task = "summary" | "chat" | "catchup" | "tags" | "embeddings";

// Resolves provider + key + concrete model for a user/task, with fallback.
async function resolveModel(userId: string, task: Task): Promise<{
  provider: "anthropic" | "openai";
  apiKey: string;           // user's decrypted key, or platform key
  model: string;            // concrete ID (recommendation map resolved)
  usingPlatformKey: boolean;
}>;
```

Precedence:
1. User has a valid, **enabled** key for the task's provider → use it.
2. Otherwise → ContextBrain platform key (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`).

Model choice:
1. User picked an explicit model → use it (if still available for the active key; else fall back to recommended + warn).
2. User left it on `"recommended"` (or unset) → resolve from the recommendation map.

### 2. Wire each route through the resolver

In each AI route, replace the hardcoded `anthropic("claude-opus-4-7")` etc. with:

```ts
const { provider, apiKey, model } = await resolveModel(userId, "summary");
const client = createAnthropic({ apiKey });           // or createOpenAI
const result = await generateObject({ model: client(model), ... });
```

- Keep the existing **token-count heuristic** (chat/catch-up choosing Sonnet vs Opus for large
  context) only when the user is on `"recommended"`. If they pinned a model, honor it — don't override.
- `@ai-sdk/anthropic`'s `createAnthropic({ apiKey })` and `openai`'s client both accept a per-call key,
  so this is a drop-in.

### Embeddings caveat (important)

Embeddings power semantic retrieval, and **all stored vectors must come from the same model** —
mixing `text-embedding-3-small` (1536-dim) and `-3-large` (3072-dim) breaks similarity search and
the column dimension. So:
- v1: keep embeddings on the **platform OpenAI key + fixed model** even for BYOK users, OR
- if exposing it: changing the embedding model requires a **full re-embed** of that user's corpus
  and a dimension migration. Gate this behind a clear warning, or defer to a later version.

Recommendation: **v1 shows embeddings as informational/locked** ("Recommended · managed by ContextBrain")
and we only open chat/summary/catch-up/tags model selection. Revisit per-user embeddings later.

---

## Error & edge cases

- **Invalid/expired key at request time** → fall back to platform key, complete the request, and
  flag the key Invalid in `key_status` so Settings shows it. Don't fail the user's action.
- **Pinned model no longer available** (deprecated/retired for that key) → fall back to recommended,
  surface a non-blocking "your selected model X is unavailable, using Y" notice.
- **Rate limit on user's key (429)** → surface a clear message; optionally fall back to platform key
  (decide policy — falling back spends our budget).
- **Provider down (5xx)** → standard retry/backoff; the SDKs retry 429/5xx automatically.
- **Key saved but "Use my key" unchecked** → store but skip; resolver treats it as platform-only.

---

## Implementation phases

1. **Data + crypto** — migration, `src/lib/crypto.ts` (encrypt/decrypt), `user_settings` access helpers.
2. **Resolver + route wiring** — `src/lib/llm.ts` with recommendation map; refactor the 4 AI routes
   (and decide embeddings policy). Bump defaults to `claude-opus-4-8`.
3. **Settings APIs** — `POST /api/settings/keys` (validate + encrypt + store), `GET /api/settings/models`
   (live list, cached), `GET/PATCH /api/settings` (model choices, masked status).
4. **Settings UI** — Sidebar entry, page, Provider Credentials cards, per-task model `Select`s with
   recommendation badges + rationale tooltips. Reuse `src/components/ui` (cursor-pointer on all
   interactive elements per [AGENTS.md](AGENTS.md)).
5. **Polish** — masking/reveal, ConfirmModal for removal, fallback notices, docs.

## Verification

Local can't drive the authed app end-to-end (see project memory), so verify with: `tsc`/lint clean,
route smoke tests for the resolver (user-key path vs platform fallback, recommended vs pinned),
a migration dry-run via MCP, and a public-page/Settings screenshot where possible. State explicitly
that the real authed flow wasn't exercised.

## Open questions

1. Do we fall back to **our** key (and our cost) when a user's key is rate-limited, or hard-fail?
2. Is embeddings selection in or out for v1? (Recommend: **out/locked** — re-embed cost.)
3. One shared `BYOK_ENCRYPTION_KEY`, or per-user derived keys? (Shared is simpler for v1.)
4. Account-wide only, or eventually per-Space / per-meeting overrides?
5. Should the recommendation map be remotely configurable (so we can restar a model without a deploy),
   or is a code constant fine for v1?
