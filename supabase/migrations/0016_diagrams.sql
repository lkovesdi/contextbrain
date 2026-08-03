-- 0016 — Architecture diagrams.
--
-- A diagram is generated from one or more GitHub repos the user pulls in: we
-- walk each repo's tree, feed a condensed digest to the model, and it returns
-- a structured graph (nodes / groups / edges) that the client renders as an
-- animated SVG. Diagrams are versioned: every "Update" run appends a new row
-- to diagram_versions with the fresh graph plus a model-written summary of
-- what changed, so the UI can show old vs new side by side.
--
-- `repos` on diagrams is a jsonb array of { owner, name, branch } — a join
-- table buys nothing here since repos aren't first-class rows anywhere else.
-- `current_version` is 0 until the first generation succeeds, which is how
-- the detail page knows to kick off the initial run.
-- `user_id` is denormalized onto diagram_versions so RLS keeps the usual
-- own-rows shape without a join.

create table if not exists diagrams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  title text not null default 'Untitled diagram',
  repos jsonb not null default '[]'::jsonb,      -- [{ owner, name, branch }]
  current_version int not null default 0,        -- 0 = never generated
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists diagram_versions (
  id uuid primary key default gen_random_uuid(),
  diagram_id uuid references diagrams(id) on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  version int not null,
  graph jsonb not null,                          -- nodes / groups / edges (see src/lib/diagrams.ts)
  summary text,                                  -- v1: what the architecture is; vN: what changed
  changes jsonb not null default '[]'::jsonb,    -- [{ kind: added|removed|modified, target, detail }]
  created_at timestamptz default now(),
  unique (diagram_id, version)
);

create index if not exists diagrams_user_id_idx on diagrams(user_id);
create index if not exists diagram_versions_diagram_idx on diagram_versions(diagram_id, version);

alter table diagrams enable row level security;
alter table diagram_versions enable row level security;

do $$
declare t text;
begin
  foreach t in array array['diagrams', 'diagram_versions'] loop
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
