# Agent Chat — Build Plan

Status: **proposed** · Owner: Laszlo · Companion spec: [BYOK.md](BYOK.md)

> **2026-07-22:** Per-space chat shipped separately (migration 0013, `space_wide`
> retrieval, `SpaceChatPanel` on the space page) reusing `/api/chat` — it covers
> the "chat across folder" entry point below. This plan (standalone agentic chat
> with write tools) remains unbuilt and unchanged.

## Goal

A standalone, **agentic** chat that can be pointed at **unlimited context** (many
meetings + external contexts + notes + integrations) and can **take actions** on
the user's behalf — create a Jira ticket, reply to a GitHub PR comment, open a
Linear issue — with **human approval before any write**.

This is distinct from today's per-meeting chat ([`ChatPanel.tsx`](src/app/(app)/meetings/[id]/ChatPanel.tsx)),
which is single-meeting-bound, text-stream only, and read-only. That stays as-is;
the agent chat is a new, first-class entity built alongside it.

---

## Decisions already locked

1. **First-class `chats` entity**, not an extension of per-meeting chat (which is
   wired into guest-sharing + meeting RLS and shouldn't absorb this).
2. **Unbounded context.** Attach as many meetings/contexts as the user wants.
3. **Retrieval-as-a-tool.** The model calls `search_context` on demand instead of
   us prefilling the window — this is what makes "unlimited context" actually work
   within a token budget.
4. **Agentic tool loop** with two tool classes: read tools (auto-run) and write
   tools (Composio actions, **`needsApproval: true`**).
5. **Human-in-the-loop for every write** to start; a per-chat "trusted actions"
   toggle can relax it later via `needsApproval: async (input) => …`.
6. **Build order: this (Track B) first**, against existing platform keys + the
   already-working per-user OAuth connections. Per-user BYOK settings (Track A,
   [BYOK.md](BYOK.md)) layers on afterward — the chat doesn't block on it.

---

## Verified AI SDK v6 facts (do not trust training data — checked against `node_modules/ai/docs/`)

- Agent loop: `streamText({ model, tools, stopWhen: stepCountIs(N) })`.
- Tools: `tool({ description, inputSchema: z.object(...), execute, needsApproval })`.
  Note **`inputSchema`** (not `parameters`).
- **Write approval** (`node_modules/ai/docs/03-ai-sdk-core/15-tools-and-tool-calling.mdx`,
  `.../04-ai-sdk-ui/03-chatbot-tool-usage.mdx`): a server tool with
  `needsApproval: true` streams a part in state `approval-requested`; the client
  renders a card and calls `addToolApprovalResponse({ id: part.approval.id, approved })`.
  The tool still executes **on the server**, only after approval.
- Client: `useChat` from **`@ai-sdk/react`** (NEW dependency — not installed) with
  `DefaultChatTransport`. Messages are `UIMessage[]` rendered via `message.parts`;
  tool parts are typed `tool-<name>` with states
  `input-streaming → input-available → approval-requested → output-available | output-error`.
  Auto-continue after approval via
  `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses`.
- Route: read `{ messages: UIMessage[] }`, pass `convertToModelMessages(messages)`
  to `streamText`, return `result.toUIMessageStreamResponse()`.
- Model: use **Opus 4.8** for the loop (strongest at multi-step tool use).
  ⚠️ Confirm the exact model id at build time — existing code pins
  `claude-opus-4-7` / `claude-sonnet-4-6`; do not copy an id from memory.

---

## Data model

Migration `supabase/migrations/0014_agent_chats.sql` (0013 was taken by space
chat). MCP access to project `nopzhjevenszabzkgdkl` was restored 2026-07-22
(the connection had been OAuth'd to the wrong Supabase org) — apply via
`apply_migration` as usual. No local DB.

```sql
create table chats (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text,
  selection     jsonb not null default '{}'::jsonb,   -- non-meeting context: external_context_ids, note_ids, space_id, tag_ids, integrations, recent_summary_count
  enabled_tools text[] not null default '{}',         -- which write tools are armed for this chat
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table chats enable row level security;
create policy chats_owner on chats for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Meetings attached to the chat. Join table (not in `selection`) so deleting a
-- meeting cleanly drops it from every chat via cascade.
create table chat_meetings (
  chat_id    uuid not null references chats(id) on delete cascade,
  meeting_id uuid not null references meetings(id) on delete cascade,
  primary key (chat_id, meeting_id)
);
alter table chat_meetings enable row level security;
create policy chat_meetings_owner on chat_meetings for all
  using (exists (select 1 from chats c where c.id = chat_id and c.user_id = auth.uid()))
  with check (exists (select 1 from chats c where c.id = chat_id and c.user_id = auth.uid()));

-- One row per turn, storing the full UIMessage parts array (text, tool calls,
-- approvals, tool results) so an agent conversation round-trips losslessly.
create table chat_turns (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid not null references chats(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('user','assistant')),
  parts      jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table chat_turns enable row level security;
create policy chat_turns_owner on chat_turns for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index chat_turns_chat_idx on chat_turns (chat_id, created_at);
```

---

## Server

### 1. Retrieval: teach `retrieve()` about many meetings

[`src/lib/retrieve.ts`](src/lib/retrieve.ts) — add `meeting_ids?: string[]` to
`ContextSelection`. When present, loop `match_transcripts` per meeting and allocate
`k` fairly across them (mirror the per-source top-1 logic already used for external
chunks at lines 157–201, so one long meeting doesn't starve the others). Also pull
each attached meeting's **summary into the priority bucket** (same pattern as
`recent_space_summaries` at lines 100–126) — summaries first, transcript detail to
fill remaining slots. Keep the existing singular `meeting_id` path untouched for
per-meeting chat.

### 2. Tools — `src/lib/agent/tools.ts` (new)

Built per-request (tool set depends on the user's live connections + chat's
`enabled_tools`).

**Read tools (auto-run, no approval):**
- `search_context({ query })` → builds the chat's server-derived selection
  (`selection` + `chat_meetings`), calls `retrieve(query, selection, k)`, returns
  `{ chunks: [{ content, source }] }`. This is the unbounded-context unlock.
- `get_meeting_summary({ meeting_id })` → returns the summary markdown; gated to
  meetings attached to the chat.

**Write tools (`needsApproval: true`, execute via [`executeTool`](src/lib/composio.ts)):**
- `create_jira_issue`, `comment_github_pr`, `create_linear_issue`, … each is a
  thin `tool()` wrapping `executeTool(SLUG, { userId, arguments })`.
- ⚠️ **Confirm exact Composio slugs + arg shapes** against the v3.1 catalog at
  build time (the repo already pins toolkit versions and uses specific slugs like
  `JIRA_SEARCH_ISSUES`). Do not ship guessed slugs.
- **Scoping:** only include a write tool if `findActiveConnection(userId, provider)`
  returns a connection AND the provider is in `chat.enabled_tools`. Keeps the tool
  count small and prevents offering actions the user can't perform.

### 3. Agent route — `src/app/api/agent-chat/route.ts` (new)

New route (not a fork of `/api/chat`, which carries guest-sharing + text-stream
persistence we don't want here).

```
POST { chat_id, messages: UIMessage[] }
  → auth; load chat (RLS = owner-only) + chat_meetings
  → build server-derived selection (never trust client for context scope)
  → build tools (read always; writes gated by connection + enabled_tools)
  → streamText({ model: opus-4.8, system, messages: convertToModelMessages(messages),
                 tools, stopWhen: stepCountIs(8) })
  → persist turns to chat_turns keyed by chat_id (onFinish; see message-persistence doc)
  → return result.toUIMessageStreamResponse({ onError })
```

System prompt: adapt the existing one in [`chat/route.ts`](src/app/api/chat/route.ts#L173)
(citation style, "your knowledge vs retrieved context") + instructions to call
`search_context` before answering about user data, and to propose writes only when
the user clearly asks.

### 4. Chats CRUD — `src/app/api/chats/route.ts` + `.../[id]/route.ts` (new)

`GET` list, `POST` create, `GET/PATCH/DELETE` one. `PATCH` edits `title`,
`selection`, `enabled_tools`, and the `chat_meetings` set.

---

## Client

New dep: **`@ai-sdk/react`** (matches installed `ai@6`).

- **Routes:** `src/app/(app)/chat/page.tsx` (list + "New chat") and
  `src/app/(app)/chat/[id]/page.tsx` (the conversation).
- **`AgentChatPanel.tsx`** — `useChat({ transport: DefaultChatTransport({ api: '/api/agent-chat', body: { chat_id } }), sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses })`.
  Render `message.parts`:
  - `text` → reuse the existing markdown renderer (factor `AssistantMarkdown` +
    `ChatImage` out of `ChatPanel.tsx` into a shared component per AGENTS.md reuse rule).
  - `tool-*` states → a `ToolCallCard`: show inputs while streaming, an
    **approval card** with Approve/Deny at `approval-requested`
    (`addToolApprovalResponse`), result/error at `output-*`.
  - `step-start` → step divider.
- **`MeetingMultiPicker.tsx`** (new UI primitive in `src/components/ui`) — searchable
  multi-select over `GET /api/meetings` (fuzzy search + pagination already exist).
- **Context editing:** reuse `ContextSelector` for the non-meeting selection; both
  it and the meeting picker write through `PATCH /api/chats/[id]`.
- **Entry points:** "Chats" in `Sidebar.tsx`; "Chat about these" from a multi-select
  on `MeetingsBrowser`; "Chat across folder" from a space.

Follow project UI conventions: `cursor-pointer` on every clickable; reuse
`src/components/ui` primitives (`Button`, `Select`, `Input`); no native `<select>`.

---

## Milestones (each independently shippable)

- **M1 — Foundation.** Migration + chats CRUD + `retrieve()` `meeting_ids` support.
- **M2 — Read-only agent.** Agent route with `search_context` + `get_meeting_summary`
  only; `AgentChatPanel` on `useChat` at `/chat/[id]`. Proves multi-context RAG,
  streaming, and parts rendering end-to-end.
- **M3 — First write w/ approval.** Add `create_jira_issue` (`needsApproval`) + the
  approval card. Proves the full HITL round-trip.
- **M4 — Expand actions.** GitHub PR comment, Linear issue, etc.; connection gating;
  `enabled_tools` UI.
- **M5 — Entry points + persistence polish.** Sidebar, "chat about these", chat list,
  title auto-naming, load `chat_turns` on open.

Then **Track A** ([BYOK.md](BYOK.md)) makes it self-serve/self-hostable via the
`getConfig` resolver.

---

## Verification (can't drive the authed app locally — see memory)

Per-milestone: `tsc --noEmit` + lint; route smoke tests with a seeded session;
public-page screenshots where relevant. State explicitly that the real end-to-end
agent+approval flow wasn't exercised locally. Build-time confirmations required:
(a) exact Opus 4.8 model id, (b) Composio write-tool slugs + arg schemas,
(c) `@ai-sdk/react` version resolves against `ai@6`.

---

## Open questions

1. **Token budgeting** across many meetings — keep the existing >30k→Sonnet
   downshift, or size `k`/summary count per attached-meeting count?
2. **Autonomy** — ship confirm-every-write (recommended); add per-chat "trusted
   actions" later.
3. **Which write actions for M4** beyond Jira/GitHub/Linear (Slack post? Gmail draft?).
