-- MeetingBrain v1 — initial schema (PRD §4)
-- Apply via MCP `execute_sql` or paste into Supabase SQL Editor.

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
  created_at timestamptz default now()
);

create table external_contexts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  source_type text not null,
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
  provider text not null,
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
