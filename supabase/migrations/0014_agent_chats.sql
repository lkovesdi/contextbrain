-- 0014 — Agent chat.
--
-- A standalone, first-class chat decoupled from any single meeting. The user
-- attaches unbounded context (many meetings + preset-style sources) and the
-- assistant runs an agentic tool loop over it (retrieval + approved write
-- actions). Distinct from per-meeting chat (chat_messages.meeting_id) and
-- per-space chat (chat_messages.space_id, migration 0013).

create table if not exists chats (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users on delete cascade not null,
  title         text,
  -- Non-meeting context: external_context_ids, note_ids, space_id, tag_ids,
  -- recent_summary_count, integrations. Mirrors ContextSelection sans meetings.
  selection     jsonb not null default '{}'::jsonb,
  -- Which write tools are armed for this chat (e.g. 'jira', 'github', 'linear').
  enabled_tools text[] not null default '{}',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Meetings attached to the chat. A join row (rather than ids inside `selection`)
-- so deleting a meeting cleanly drops it from every chat via cascade. user_id is
-- denormalized so RLS matches the house `auth.uid() = user_id` shape.
create table if not exists chat_meetings (
  chat_id    uuid references chats on delete cascade not null,
  meeting_id uuid references meetings on delete cascade not null,
  user_id    uuid references auth.users on delete cascade not null,
  primary key (chat_id, meeting_id)
);
create index if not exists chat_meetings_chat_idx on chat_meetings(chat_id);

-- One row per turn, storing the full UIMessage `parts` array (text, tool calls,
-- approvals, tool results) so an agent conversation round-trips losslessly.
create table if not exists chat_turns (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid references chats on delete cascade not null,
  user_id    uuid references auth.users on delete cascade not null,
  role       text not null check (role in ('user', 'assistant')),
  parts      jsonb not null default '[]'::jsonb,
  created_at timestamptz default now()
);
create index if not exists chat_turns_chat_idx on chat_turns(chat_id, created_at);

alter table chats         enable row level security;
alter table chat_meetings enable row level security;
alter table chat_turns    enable row level security;

-- Owner-only, same four-policy shape as the base tables (see 0001_init).
-- drop-if-exists guards keep this idempotent on re-run.
do $$
declare t text;
begin
  foreach t in array array['chats', 'chat_meetings', 'chat_turns'] loop
    execute format('drop policy if exists "own_rows_select" on %I', t);
    execute format('drop policy if exists "own_rows_insert" on %I', t);
    execute format('drop policy if exists "own_rows_update" on %I', t);
    execute format('drop policy if exists "own_rows_delete" on %I', t);
    execute format('create policy "own_rows_select" on %I for select using (auth.uid() = user_id)', t);
    execute format('create policy "own_rows_insert" on %I for insert with check (auth.uid() = user_id)', t);
    execute format('create policy "own_rows_update" on %I for update using (auth.uid() = user_id)', t);
    execute format('create policy "own_rows_delete" on %I for delete using (auth.uid() = user_id)', t);
  end loop;
end $$;
