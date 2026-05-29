# ContextBrain — Product Requirements Document (v1)

> **For the implementing agent:** This PRD is the spec. Build top-to-bottom in the order listed in **§11 Build Order**. Do not skip ahead. Each step has an explicit acceptance check — verify before moving on. If something is ambiguous, prefer the simpler option and leave a `// TODO` note.

---

## 1. Product summary

ContextBrain is a desktop-bound web app that listens to your meetings, takes structured notes, and lets you chat with the whole context — your transcripts, your notes, your past Claude.ai conversations, and connected tools (GitHub, Jira, Figma) — through a single interface. Before a meeting, you load a "context preset" (e.g. "Sprint planning" or "Design review") that bundles the right notes and integration scopes so the chat is already primed when the meeting starts.

**Built as:** Next.js 14+ (App Router) web app, structured so it can later be wrapped in Tauri for system-audio capture. v1 ships as a browser-only app for **in-person meetings** (single mic captures the room).

**Differentiation versus Granola/Otter/Fellow:**
- Pre-meeting context presets (select which sources are live before the meeting starts)
- Local-first storage path on the Tauri roadmap (cloud is opt-in per item)
- Native ingestion of Claude.ai conversation exports as a first-class context source

---

## 2. Out of scope for v1

Explicitly **not** building in v1:
- Remote meeting bots (no Zoom/Meet/Teams participant bot)
- System audio capture (deferred to Tauri wrap)
- Team sharing / multi-user meetings
- Mobile apps
- Realtime collaboration on notes
- Audio playback / re-listening
- Speaker identity beyond Deepgram's diarization labels (Speaker 0, Speaker 1...)
- Slack, Notion, HubSpot integrations (only GitHub → Jira → Figma in v1)

If the user asks for any of these, decline and note them in a `BACKLOG.md`.

---

## 3. Tech stack (locked)

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 14+ App Router, TypeScript | Standard, easy Tauri wrap later |
| Styling | Tailwind CSS | Default with create-next-app |
| Database | Supabase (Postgres + pgvector) | Auth + DB + RLS in one |
| Auth | Supabase Auth (email magic link) | Simplest path |
| Transcription | Deepgram (Nova-3 model, streaming) | Best live accuracy + diarization |
| Embeddings | OpenAI `text-embedding-3-small` (1536 dim) | Cheap, good enough |
| Chat LLM | Anthropic Claude via Vercel AI SDK | Streaming UI included |
| Integrations | Composio | Pre-built OAuth for GitHub/Jira/Figma |
| Validation | Zod | Standard |

**Versions:** use latest stable at build time. Pin in `package.json` after install.

### Required env vars (`.env.local`)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DEEPGRAM_API_KEY=
DEEPGRAM_PROJECT_ID=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
COMPOSIO_API_KEY=
COMPOSIO_GITHUB_AUTH_CONFIG=
COMPOSIO_JIRA_AUTH_CONFIG=
COMPOSIO_FIGMA_AUTH_CONFIG=
```

Create a `.env.example` mirroring this with empty values. Never commit `.env.local`.

### Install
```bash
npx create-next-app@latest contextbrain --typescript --tailwind --app --eslint
cd contextbrain
npm install @supabase/supabase-js @supabase/ssr
npm install @deepgram/sdk
npm install openai
npm install ai @ai-sdk/anthropic
npm install @composio/core
npm install zod
npm install lucide-react
```

---

## 4. Data model (Supabase schema)

Run all of this in the Supabase SQL editor. Order matters.

```sql
-- Extensions
create extension if not exists vector;
create extension if not exists pgcrypto;

-- ============ Core tables ============

create table meetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  title text not null default 'Untitled meeting',
  started_at timestamptz default now(),
  ended_at timestamptz,
  context_preset_id uuid,
  summary text,
  created_at timestamptz default now()
);

create table transcripts (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references meetings on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  speaker text,
  content text not null,
  embedding vector(1536),
  timestamp_ms int,
  created_at timestamptz default now()
);
create index transcripts_meeting_id_idx on transcripts(meeting_id);
create index transcripts_embedding_idx on transcripts using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create table notes (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references meetings on delete set null,
  user_id uuid references auth.users on delete cascade not null,
  content text not null,
  embedding vector(1536),
  is_checked boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index notes_user_id_idx on notes(user_id);
create index notes_embedding_idx on notes using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ============ Context system ============

create table context_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  sources jsonb not null default '{}'::jsonb,
  -- shape: { external_context_ids: [...], include_notes: bool, integrations: { github: { repos: [...] }, jira: { projects: [...] }, figma: { files: [...] } } }
  created_at timestamptz default now()
);

create table external_contexts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  source_type text not null,  -- 'claude_export' | 'file_upload'
  name text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table external_chunks (
  id uuid primary key default gen_random_uuid(),
  external_context_id uuid references external_contexts on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  content text not null,
  embedding vector(1536),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create index external_chunks_context_idx on external_chunks(external_context_id);
create index external_chunks_embedding_idx on external_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ============ Integrations ============

create table integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  provider text not null,  -- 'github' | 'jira' | 'figma'
  composio_connection_id text not null,
  metadata jsonb default '{}'::jsonb,
  connected_at timestamptz default now(),
  unique(user_id, provider)
);

-- ============ Chat ============

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references meetings on delete cascade,
  user_id uuid references auth.users on delete cascade not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  sources jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);
create index chat_messages_meeting_idx on chat_messages(meeting_id);

-- ============ Row-level security ============

alter table meetings enable row level security;
alter table transcripts enable row level security;
alter table notes enable row level security;
alter table context_presets enable row level security;
alter table external_contexts enable row level security;
alter table external_chunks enable row level security;
alter table integrations enable row level security;
alter table chat_messages enable row level security;

-- Generic "users see their own rows" policy on every table
do $$
declare t text;
begin
  for t in select unnest(array['meetings','transcripts','notes','context_presets','external_contexts','external_chunks','integrations','chat_messages']) loop
    execute format('create policy "own_rows_select" on %I for select using (auth.uid() = user_id)', t);
    execute format('create policy "own_rows_insert" on %I for insert with check (auth.uid() = user_id)', t);
    execute format('create policy "own_rows_update" on %I for update using (auth.uid() = user_id)', t);
    execute format('create policy "own_rows_delete" on %I for delete using (auth.uid() = user_id)', t);
  end loop;
end $$;

-- ============ Similarity search functions ============

create or replace function match_transcripts(
  query_embedding vector(1536),
  match_count int,
  user_id_filter uuid,
  meeting_id_filter uuid default null
) returns table (id uuid, content text, speaker text, similarity float)
language sql stable as $$
  select id, content, speaker, 1 - (embedding <=> query_embedding) as similarity
  from transcripts
  where user_id = user_id_filter
    and (meeting_id_filter is null or meeting_id = meeting_id_filter)
    and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;

create or replace function match_notes(
  query_embedding vector(1536),
  match_count int,
  user_id_filter uuid
) returns table (id uuid, content text, similarity float)
language sql stable as $$
  select id, content, 1 - (embedding <=> query_embedding) as similarity
  from notes
  where user_id = user_id_filter
    and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;

create or replace function match_external_chunks(
  query_embedding vector(1536),
  match_count int,
  user_id_filter uuid,
  context_ids uuid[]
) returns table (id uuid, content text, metadata jsonb, similarity float)
language sql stable as $$
  select id, content, metadata, 1 - (embedding <=> query_embedding) as similarity
  from external_chunks
  where user_id = user_id_filter
    and external_context_id = any(context_ids)
    and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;
```

**Acceptance check:** running these statements in a fresh Supabase project produces no errors. `select * from meetings` returns an empty result set (not a permission error) when authenticated as a real user.

---

## 5. Folder structure

```
contextbrain/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── auth/callback/route.ts
│   ├── (app)/
│   │   ├── layout.tsx                  # protected layout, redirects to /login if not authed
│   │   ├── page.tsx                    # dashboard: list of meetings + "new meeting"
│   │   ├── meetings/
│   │   │   ├── [id]/
│   │   │   │   ├── page.tsx            # meeting workspace: recorder + notes + chat
│   │   │   │   ├── Recorder.tsx        # client component, mic + Deepgram
│   │   │   │   ├── Notes.tsx           # client component, notes editor
│   │   │   │   ├── ChatPanel.tsx       # client component, chat with context selector
│   │   │   │   └── ContextSelector.tsx # checkbox sidebar
│   │   ├── contexts/
│   │   │   ├── page.tsx                # manage external contexts (Claude imports, etc.)
│   │   │   └── ImportClaude.tsx
│   │   ├── presets/
│   │   │   └── page.tsx                # CRUD context presets
│   │   └── integrations/
│   │       └── page.tsx                # connect GitHub/Jira/Figma via Composio
│   └── api/
│       ├── deepgram/token/route.ts
│       ├── meetings/
│       │   ├── route.ts                # POST create meeting
│       │   └── [id]/
│       │       ├── route.ts            # GET, PATCH, DELETE
│       │       ├── transcript/route.ts # POST append transcript
│       │       └── summary/route.ts    # POST trigger summary generation
│       ├── notes/
│       │   ├── route.ts                # POST create
│       │   └── [id]/route.ts           # PATCH, DELETE, toggle is_checked
│       ├── contexts/
│       │   └── claude-export/route.ts  # POST upload
│       ├── presets/route.ts            # CRUD
│       ├── integrations/
│       │   ├── connect/route.ts        # POST initiate Composio OAuth
│       │   ├── callback/route.ts       # GET handle Composio redirect
│       │   └── [provider]/route.ts     # DELETE disconnect
│       └── chat/route.ts               # POST stream chat response with RAG
├── lib/
│   ├── supabase/
│   │   ├── client.ts                   # browser client
│   │   └── server.ts                   # server client (cookies)
│   ├── embed.ts                        # OpenAI embedding helper
│   ├── retrieve.ts                     # unified RAG retrieval
│   ├── composio.ts                     # Composio client + helpers
│   └── chunk.ts                        # text chunking utility
├── middleware.ts                       # Supabase session refresh
├── .env.example
├── .env.local                          # gitignored
└── BACKLOG.md                          # parking lot for out-of-scope requests
```

---

## 6. Key implementation patterns

### 6.1 Supabase clients

```ts
// lib/supabase/server.ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch { /* called from a Server Component, safe to ignore */ }
        },
      },
    }
  );
}
```

```ts
// lib/supabase/client.ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

```ts
// middleware.ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

### 6.2 Embedding helper

```ts
// lib/embed.ts
import OpenAI from "openai";

const openai = new OpenAI();

export async function embed(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 8000), // safety truncation
  });
  return res.data[0].embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: texts.map((t) => t.slice(0, 8000)),
  });
  return res.data.map((d) => d.embedding);
}
```

### 6.3 Deepgram ephemeral token + recorder

```ts
// app/api/deepgram/token/route.ts
import { createClient as createDg } from "@deepgram/sdk";
import { NextResponse } from "next/server";

export async function GET() {
  const dg = createDg(process.env.DEEPGRAM_API_KEY!);
  const { result, error } = await dg.manage.createProjectKey(
    process.env.DEEPGRAM_PROJECT_ID!,
    {
      comment: "Ephemeral browser key",
      scopes: ["usage:write"],
      time_to_live_in_seconds: 3600,
    }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ key: result.key });
}
```

```tsx
// app/(app)/meetings/[id]/Recorder.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { createClient as createDg, LiveTranscriptionEvents } from "@deepgram/sdk";

type Line = { speaker: string; text: string; is_final: boolean };

export function Recorder({ meetingId }: { meetingId: string }) {
  const [recording, setRecording] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const connRef = useRef<any>(null);
  const recRef = useRef<MediaRecorder | null>(null);

  async function start() {
    const res = await fetch("/api/deepgram/token");
    const { key } = await res.json();

    const dg = createDg(key);
    const conn = dg.listen.live({
      model: "nova-3",
      smart_format: true,
      interim_results: true,
      diarize: true,
      utterance_end_ms: 1000,
      vad_events: true,
    });
    connRef.current = conn;

    conn.on(LiveTranscriptionEvents.Open, async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
      recRef.current = rec;
      rec.addEventListener("dataavailable", (e) => {
        if (e.data.size > 0 && conn.getReadyState() === 1) conn.send(e.data);
      });
      rec.start(250);
    });

    conn.on(LiveTranscriptionEvents.Transcript, (data: any) => {
      const transcript = data.channel.alternatives[0]?.transcript;
      if (!transcript) return;
      const sp = data.channel.alternatives[0]?.words?.[0]?.speaker;
      const speaker = sp !== undefined ? `Speaker ${sp}` : "Unknown";
      const line: Line = { speaker, text: transcript, is_final: !!data.is_final };

      setLines((prev) => {
        const last = prev[prev.length - 1];
        if (last && !last.is_final) return [...prev.slice(0, -1), line];
        return [...prev, line];
      });

      if (data.is_final) {
        fetch(`/api/meetings/${meetingId}/transcript`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(line),
        });
      }
    });

    setRecording(true);
  }

  function stop() {
    recRef.current?.stop();
    recRef.current?.stream.getTracks().forEach((t) => t.stop());
    connRef.current?.finish();
    setRecording(false);
  }

  useEffect(() => () => stop(), []);

  return (
    <div className="space-y-4">
      <button
        onClick={recording ? stop : start}
        className="rounded-md bg-black px-4 py-2 text-white"
      >
        {recording ? "Stop" : "Start recording"}
      </button>
      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {lines.map((l, i) => (
          <p key={i} className={l.is_final ? "" : "opacity-50"}>
            <span className="font-semibold">{l.speaker}:</span> {l.text}
          </p>
        ))}
      </div>
    </div>
  );
}
```

### 6.4 Transcript persistence

```ts
// app/api/meetings/[id]/transcript/route.ts
import { createClient } from "@/lib/supabase/server";
import { embed } from "@/lib/embed";
import { NextResponse } from "next/server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: meetingId } = await params;
  const { speaker, text } = await req.json();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("transcripts")
    .insert({ meeting_id: meetingId, user_id: user.id, speaker, content: text })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fire-and-forget embedding
  embed(text)
    .then((vector) =>
      supabase.from("transcripts").update({ embedding: vector }).eq("id", data.id)
    )
    .catch(console.error);

  return NextResponse.json({ ok: true, id: data.id });
}
```

### 6.5 Claude export ingestion

```ts
// app/api/contexts/claude-export/route.ts
import { createClient } from "@/lib/supabase/server";
import { embedBatch } from "@/lib/embed";
import { NextResponse } from "next/server";
import { z } from "zod";

const Msg = z.object({
  text: z.string().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  sender: z.enum(["human", "assistant"]).optional(),
  created_at: z.string().optional(),
});
const Convo = z.object({
  uuid: z.string(),
  name: z.string().optional(),
  created_at: z.string().optional(),
  chat_messages: z.array(Msg),
});
const Export = z.array(Convo);

function extractText(m: z.infer<typeof Msg>): string {
  if (m.text) return m.text;
  if (m.content) return m.content.filter((c) => c.type === "text").map((c) => c.text || "").join("\n");
  return "";
}

function chunkConvo(c: z.infer<typeof Convo>) {
  const chunks: { content: string; metadata: Record<string, any> }[] = [];
  for (let i = 0; i < c.chat_messages.length; i += 2) {
    const u = c.chat_messages[i];
    const a = c.chat_messages[i + 1];
    const parts: string[] = [];
    if (u) parts.push(`User: ${extractText(u)}`);
    if (a) parts.push(`Assistant: ${extractText(a)}`);
    const content = parts.join("\n\n").trim();
    if (!content) continue;
    chunks.push({
      content,
      metadata: {
        conversation_id: c.uuid,
        conversation_name: c.name,
        created_at: u?.created_at,
        message_index: i,
      },
    });
  }
  return chunks;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

  let parsed: z.infer<typeof Export>;
  try {
    parsed = Export.parse(JSON.parse(await file.text()));
  } catch {
    return NextResponse.json({ error: "Invalid Claude export file" }, { status: 400 });
  }

  const { data: ctx, error: ctxErr } = await supabase
    .from("external_contexts")
    .insert({
      user_id: user.id,
      source_type: "claude_export",
      name: `Claude export — ${parsed.length} conversations`,
      metadata: { conversation_count: parsed.length, imported_at: new Date().toISOString() },
    })
    .select()
    .single();
  if (ctxErr) return NextResponse.json({ error: ctxErr.message }, { status: 500 });

  const allChunks = parsed.flatMap(chunkConvo);
  const BATCH = 50;
  for (let i = 0; i < allChunks.length; i += BATCH) {
    const batch = allChunks.slice(i, i + BATCH);
    const embeddings = await embedBatch(batch.map((c) => c.content));
    await supabase.from("external_chunks").insert(
      batch.map((c, idx) => ({
        external_context_id: ctx.id,
        user_id: user.id,
        content: c.content,
        embedding: embeddings[idx],
        metadata: c.metadata,
      }))
    );
  }

  return NextResponse.json({ ok: true, context_id: ctx.id, chunk_count: allChunks.length });
}
```

### 6.6 Composio integration layer

```ts
// lib/composio.ts
import { Composio } from "@composio/core";

export const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY! });

export type Provider = "github" | "jira" | "figma";

const AUTH_CONFIG: Record<Provider, string> = {
  github: process.env.COMPOSIO_GITHUB_AUTH_CONFIG!,
  jira: process.env.COMPOSIO_JIRA_AUTH_CONFIG!,
  figma: process.env.COMPOSIO_FIGMA_AUTH_CONFIG!,
};

export async function initiateConnection(userId: string, provider: Provider) {
  const conn = await composio.connectedAccounts.initiate({
    userId,
    authConfigId: AUTH_CONFIG[provider],
  });
  return { redirectUrl: conn.redirectUrl, connectionId: conn.id };
}

export async function fetchIntegrationContext(
  userId: string,
  provider: Provider,
  query: string
) {
  // Implementation depends on provider. Examples:
  if (provider === "github") {
    return composio.tools.execute("GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS", {
      userId,
      arguments: { q: query, per_page: 5 },
    });
  }
  if (provider === "jira") {
    return composio.tools.execute("JIRA_SEARCH_ISSUES", {
      userId,
      arguments: { jql: `text ~ "${query}"`, maxResults: 5 },
    });
  }
  if (provider === "figma") {
    return composio.tools.execute("FIGMA_SEARCH_FILES", {
      userId,
      arguments: { query },
    });
  }
}
```

> **Note:** Composio SDK shapes have shifted across versions. Verify exact method names and tool slugs in `node_modules/@composio/core` after install. If they differ, fix the wrapper but keep the function signatures stable.

### 6.7 Unified retrieval

```ts
// lib/retrieve.ts
import { createClient } from "@/lib/supabase/server";
import { embed } from "./embed";
import { fetchIntegrationContext, Provider } from "./composio";

export type ContextSelection = {
  meeting_id?: string;
  include_meeting_transcripts?: boolean;
  include_notes?: boolean;
  external_context_ids?: string[];
  integrations?: { provider: Provider }[];
};

export type RetrievedChunk = {
  content: string;
  source: string;
  score: number;
  metadata?: Record<string, any>;
};

export async function retrieve(
  query: string,
  selection: ContextSelection,
  k = 8
): Promise<RetrievedChunk[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const qVec = await embed(query);
  const results: RetrievedChunk[] = [];

  if (selection.include_meeting_transcripts && selection.meeting_id) {
    const { data } = await supabase.rpc("match_transcripts", {
      query_embedding: qVec,
      match_count: k,
      user_id_filter: user.id,
      meeting_id_filter: selection.meeting_id,
    });
    data?.forEach((r: any) =>
      results.push({ content: r.content, source: `transcript (${r.speaker})`, score: r.similarity })
    );
  }

  if (selection.include_notes) {
    const { data } = await supabase.rpc("match_notes", {
      query_embedding: qVec,
      match_count: k,
      user_id_filter: user.id,
    });
    data?.forEach((r: any) =>
      results.push({ content: r.content, source: "note", score: r.similarity })
    );
  }

  if (selection.external_context_ids?.length) {
    const { data } = await supabase.rpc("match_external_chunks", {
      query_embedding: qVec,
      match_count: k,
      user_id_filter: user.id,
      context_ids: selection.external_context_ids,
    });
    data?.forEach((r: any) =>
      results.push({
        content: r.content,
        source: `external (${r.metadata?.conversation_name || "unknown"})`,
        score: r.similarity,
        metadata: r.metadata,
      })
    );
  }

  if (selection.integrations?.length) {
    for (const { provider } of selection.integrations) {
      try {
        const res = await fetchIntegrationContext(user.id, provider, query);
        // Flatten Composio response into chunks; exact shape depends on provider
        const summary = JSON.stringify(res).slice(0, 2000);
        results.push({ content: summary, source: `integration:${provider}`, score: 0.5 });
      } catch (e) {
        console.error(`Integration ${provider} failed:`, e);
      }
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, k);
}
```

### 6.8 Chat endpoint with streaming + RAG

```ts
// app/api/chat/route.ts
import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import { retrieve, ContextSelection } from "@/lib/retrieve";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages, selection, meeting_id } = await req.json() as {
    messages: { role: "user" | "assistant"; content: string }[];
    selection: ContextSelection;
    meeting_id?: string;
  };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const chunks = await retrieve(lastUserMsg, { ...selection, meeting_id }, 8);

  const contextBlock = chunks.length
    ? `\n\n<retrieved_context>\n${chunks
        .map((c, i) => `[${i + 1}] (${c.source})\n${c.content}`)
        .join("\n\n")}\n</retrieved_context>`
    : "";

  const system = `You are ContextBrain, an assistant for the user's meetings and notes. Use the retrieved context below to answer. Cite sources by bracket number when relevant. If the context doesn't cover the question, say so plainly.${contextBlock}`;

  const result = streamText({
    model: anthropic("claude-sonnet-4-5"),
    system,
    messages,
  });

  // Persist the user message immediately; assistant message gets persisted on stream complete by the client
  if (meeting_id) {
    supabase.from("chat_messages").insert({
      meeting_id,
      user_id: user.id,
      role: "user",
      content: lastUserMsg,
      sources: chunks.map((c) => ({ source: c.source, score: c.score })),
    });
  }

  return result.toDataStreamResponse();
}
```

---

## 7. UI surfaces (screens)

### 7.1 Dashboard (`/`)
- List of meetings (title, date, duration). Click → meeting page.
- "New meeting" button → POST `/api/meetings` → redirect to `/meetings/[id]`.
- New-meeting modal optionally accepts a context preset selection.

### 7.2 Meeting workspace (`/meetings/[id]`)
Three-column layout (desktop), stacked on narrow widths:
- **Left:** Recorder + live transcript stream
- **Middle:** Notes editor (simple textarea or basic markdown; auto-save on blur or every 5s). Each note row has a checkbox (`is_checked`).
- **Right:** ChatPanel with collapsible ContextSelector at the top.

ContextSelector shows checkboxes for: include this meeting's transcripts, include all notes, plus a list of `external_contexts` and connected `integrations`. Selecting a saved preset auto-checks the right boxes.

### 7.3 Contexts (`/contexts`)
- List of external contexts (name, source type, chunk count, created date).
- "Import from Claude.ai" → file upload triggers `/api/contexts/claude-export`. Show progress text.
- Delete button per context (cascade deletes chunks).

### 7.4 Presets (`/presets`)
- List of presets with names.
- Create/edit form: name + checkboxes mirroring ContextSelector.

### 7.5 Integrations (`/integrations`)
- Three cards: GitHub, Jira, Figma. Each shows "Connect" or "Connected ✓ Disconnect".
- Connect → POST `/api/integrations/connect` with provider → redirect to Composio URL → callback stores `composio_connection_id`.

---

## 8. Auth flow

- Magic link via Supabase Auth.
- `/login` page: email input → `supabase.auth.signInWithOtp({ email })`.
- `/auth/callback` route exchanges code for session.
- All `(app)` routes are server components that call `supabase.auth.getUser()` and redirect to `/login` if null.

---

## 9. Error handling + edge cases

- **Mic permission denied:** show a clear message with a "Try again" button.
- **Deepgram WS drops mid-meeting:** auto-reconnect once, then surface a banner with a manual reconnect button. Don't lose existing transcript state.
- **Embedding API errors:** log, do not block the write. Transcripts/notes still save; the row just has `embedding = null` until a future backfill.
- **Claude export malformed:** return the Zod error, don't crash.
- **Composio token expired:** detect 401 from `fetchIntegrationContext`, mark integration as needing reconnect.
- **Long meetings (>1 hour):** verify the Deepgram WebSocket stays alive; if not, document the limit and add reconnection.

---

## 10. Security notes

- Never expose `SUPABASE_SERVICE_ROLE_KEY`, `DEEPGRAM_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `COMPOSIO_API_KEY` to the client. All only used in route handlers.
- Deepgram uses ephemeral 1-hour keys minted server-side (§6.3).
- RLS enforces that users can only ever see their own rows.
- No public sharing of meetings in v1. All meeting pages 404 if not owned by current user.

---

## 11. Build order (do these in sequence)

Each step has an acceptance check. Stop and verify before moving on.

### Step 1 — Project skeleton
- Run install commands from §3.
- Create `.env.example`. Add real values to `.env.local`.
- Create `lib/supabase/{client,server}.ts` and `middleware.ts` from §6.1.
- **Acceptance:** `npm run dev` starts without error, root page renders default Next.js content.

### Step 2 — Supabase schema
- Run all SQL from §4 in Supabase SQL editor.
- **Acceptance:** all tables visible in Supabase Table Editor, `match_*` functions exist under Database → Functions.

### Step 3 — Auth
- Build `/login`, `/auth/callback`, protected `(app)` layout.
- **Acceptance:** can log in with magic link, hitting `/` while logged out redirects to `/login`.

### Step 4 — Meetings CRUD + dashboard
- Build dashboard at `/` listing meetings, "New meeting" creates a row and redirects to `/meetings/[id]`.
- Meeting page renders a stub three-column layout.
- **Acceptance:** can create a meeting and land on its workspace page.

### Step 5 — Live transcription
- Implement `/api/deepgram/token` and `Recorder.tsx` from §6.3.
- Implement `/api/meetings/[id]/transcript` from §6.4.
- **Acceptance:** clicking record captures mic, transcripts stream in the UI, final lines appear in `transcripts` table with embeddings populated within ~10s.

### Step 6 — Notes
- Build `Notes.tsx` (simple list of note rows; create, edit, check, delete).
- API routes `/api/notes` and `/api/notes/[id]`.
- Embed notes on create/update.
- **Acceptance:** notes persist, embeddings populate, checkbox toggles `is_checked`.

### Step 7 — Claude export ingestion
- Build `/contexts` page and `ImportClaude.tsx`.
- Implement `/api/contexts/claude-export` from §6.5.
- **Acceptance:** uploading a real Claude export file creates an `external_contexts` row and N `external_chunks` rows with embeddings.

### Step 8 — Retrieval + chat (no integrations yet)
- Implement `lib/retrieve.ts` and `/api/chat/route.ts` from §6.7 and §6.8.
- Build `ContextSelector.tsx` and `ChatPanel.tsx`.
- ChatPanel uses `useChat` from `ai/react`, posts to `/api/chat` with current selection.
- **Acceptance:** asking a question with transcripts+notes+claude_export selected returns a streamed Claude response that visibly references the right content.

### Step 9 — Context presets
- Build `/presets` page (list + create/edit form).
- API `/api/presets` (CRUD).
- "New meeting" modal accepts an optional preset → applies it on the meeting page.
- **Acceptance:** create preset → use in new meeting → chat selector starts with correct checkboxes.

### Step 10 — Composio integrations
- Build `/integrations` page.
- Implement `/api/integrations/connect`, `/api/integrations/callback`, `/api/integrations/[provider]` (DELETE).
- Wire `lib/composio.ts` from §6.6.
- Extend `retrieve.ts` to actually call `fetchIntegrationContext` (already stubbed in §6.7).
- Start with GitHub. Once it works end-to-end, add Jira, then Figma.
- **Acceptance:** can connect GitHub, then ask the chat about an open issue and get a grounded answer.

### Step 11 — Meeting summary
- Implement `/api/meetings/[id]/summary`: send full transcript to Claude with a "summarize this meeting; pull out action items" prompt, save to `meetings.summary`.
- Auto-trigger on stop recording.
- **Acceptance:** stopping a meeting produces a readable summary on the meeting page.

### Step 12 — Polish
- Loading states everywhere.
- Empty states on dashboard, contexts, integrations.
- Toast notifications on errors.
- Keyboard shortcut: `Cmd+K` to focus chat input.

---

## 12. Quality checks before declaring v1 done

- [ ] Lighthouse accessibility score ≥ 90 on every page
- [ ] No console errors in a 10-minute test session
- [ ] A meeting with 30+ minutes of transcript, 10 notes, 1 Claude export, 1 GitHub connection chats without timeout
- [ ] All env vars documented in `.env.example`
- [ ] `README.md` has setup instructions and the prerequisite Supabase/Composio steps
- [ ] `BACKLOG.md` lists every "we'll do that later" item that came up during build

---

## 13. Roadmap (not v1, but design for it)

- Tauri wrap for desktop + system audio capture (the big one)
- Local SQLite mirror with opt-in cloud sync
- MCP server exposing your meetings to external Claude/ChatGPT clients
- Team Spaces and shared notes
- Notion, Slack, Linear integrations
- Mobile companion app (in-person meetings, hands-free)
- Voice query: "Hey ContextBrain, what did we decide about X?"

When adding to the codebase later, keep these in mind so today's choices don't paint into a corner.