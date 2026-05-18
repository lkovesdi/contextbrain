-- 0004 — Spaces (folders for meetings) and a separate AI-generated summary title.
--
-- Spaces let users bucket meetings (e.g. by customer/project) so the same
-- recurring meeting type accumulates context over time. A space owns a
-- default preset, so starting a meeting in a space pre-selects the right
-- bundle of context.
--
-- `meetings.summary_title` holds the AI-generated headline so the existing
-- user-editable `title` is never clobbered when the post-meeting summary
-- regenerates.

create table if not exists spaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  icon text,
  description text,
  default_preset_id uuid references context_presets on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists spaces_user_id_idx on spaces(user_id);

alter table meetings
  add column if not exists space_id uuid references spaces on delete set null,
  add column if not exists summary_title text;
create index if not exists meetings_space_id_idx on meetings(space_id);

alter table spaces enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'spaces' and policyname = 'own_rows_select') then
    create policy "own_rows_select" on spaces for select using (auth.uid() = user_id);
    create policy "own_rows_insert" on spaces for insert with check (auth.uid() = user_id);
    create policy "own_rows_update" on spaces for update using (auth.uid() = user_id);
    create policy "own_rows_delete" on spaces for delete using (auth.uid() = user_id);
  end if;
end $$;

-- Pull the last N summaries from a space, newest first. Used by chat
-- retrieval when a preset references `space_id` as recurring context.
-- Matches the search_path-hardened convention from migration 0002 — the
-- function pins an empty search_path and fully qualifies its table refs so
-- it can't be hijacked by a malicious schema on the path.
create or replace function recent_space_summaries(
  space_id_filter uuid,
  user_id_filter uuid,
  match_count int default 5,
  exclude_meeting uuid default null
) returns table (
  meeting_id uuid,
  title text,
  summary_title text,
  summary text,
  ended_at timestamptz
)
language sql stable
set search_path = ''
as $$
  select id, title, summary_title, summary, ended_at
  from public.meetings
  where space_id = space_id_filter
    and user_id = user_id_filter
    and summary is not null
    and (exclude_meeting is null or id <> exclude_meeting)
  order by coalesce(ended_at, started_at, created_at) desc
  limit match_count;
$$;
