-- 0018 — PRD mode: repo atlas, meeting research, meeting mode.
--
-- PRD mode turns a client call into a grounded PRD instead of tickets. The
-- pipeline needs three pieces of state:
--
-- * meetings.mode — 'standard' (existing behavior) or 'prd'. meetings.prd
--   stores the generated artifact: { pm_doc, eng_doc, open_questions }.
-- * repo_atlas — one row per repo the user's GitHub connection can see, with
--   a model-written "card" (purpose, stack, domains, key paths). This is the
--   shallow always-on map that intent routing runs over, so a non-technical
--   PM never has to pick repos. Built by the "Scan my GitHub" flow; refreshed
--   by re-scanning.
-- * meeting_research — scope memos produced by the deep scout at generation
--   time (and, later, live during the call). Kept as rows so the PRD can cite
--   them and a future live panel can stream them.

alter table meetings add column if not exists mode text not null default 'standard';
alter table meetings add column if not exists prd jsonb;

create table if not exists repo_atlas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  owner text not null,
  name text not null,
  default_branch text not null default 'main',
  head_sha text,                              -- staleness marker (filled when known)
  status text not null default 'pending',     -- pending | building | ready | error
  error text,
  card jsonb,                                 -- { purpose, stack, domains, key_paths, packages }
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, owner, name)
);

create table if not exists meeting_research (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references meetings(id) on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  topic text not null,
  status text not null default 'running',     -- running | done | error
  memo jsonb,                                 -- scope memo (see src/lib/prd.ts)
  created_at timestamptz default now()
);

create index if not exists repo_atlas_user_idx on repo_atlas(user_id);
create index if not exists meeting_research_meeting_idx on meeting_research(meeting_id, created_at);

alter table repo_atlas enable row level security;
alter table meeting_research enable row level security;

do $$
declare t text;
begin
  foreach t in array array['repo_atlas', 'meeting_research'] loop
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
