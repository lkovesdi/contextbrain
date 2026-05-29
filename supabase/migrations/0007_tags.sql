-- 0007 — Tags & smart labels for meetings.
--
-- Two flavors share one table, discriminated by `label_key`:
--   • plain tag   → label_key IS NULL, value = "asset tagging"   (chip: "asset tagging")
--   • smart label → label_key = "topic", value = "asset tagging"  (chip: "topic: asset tagging")
-- Smart labels are namespaced key:value pairs you can group/filter by key.
-- Either flavor can be typed by the user or proposed by the AI from a meeting's
-- content; AI suggestions only become rows here once the user accepts them.
--
-- `meeting_tags` is the join. Like spaces (migration 0004), applied tags feed
-- retrieval: recent_tagged_summaries() pulls prior summaries from co-tagged
-- meetings so a new meeting starts with the topic's context already in hand —
-- even when those meetings live in different spaces.

create table if not exists tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  label_key text,                    -- null = plain tag; set = smart-label namespace
  value text not null,
  created_at timestamptz default now()
);
create index if not exists tags_user_id_idx on tags(user_id);
-- One canonical tag per (user, key, value), case-insensitive on both. coalesce
-- keeps plain "asset tagging" distinct from labelled "topic: asset tagging".
create unique index if not exists tags_user_unique
  on tags(user_id, lower(coalesce(label_key, '')), lower(value));

create table if not exists meeting_tags (
  meeting_id uuid references meetings on delete cascade not null,
  tag_id uuid references tags on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  created_at timestamptz default now(),
  primary key (meeting_id, tag_id)
);
create index if not exists meeting_tags_meeting_id_idx on meeting_tags(meeting_id);
create index if not exists meeting_tags_tag_id_idx on meeting_tags(tag_id);

alter table tags enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'tags' and policyname = 'own_rows_select') then
    create policy "own_rows_select" on tags for select using (auth.uid() = user_id);
    create policy "own_rows_insert" on tags for insert with check (auth.uid() = user_id);
    create policy "own_rows_update" on tags for update using (auth.uid() = user_id);
    create policy "own_rows_delete" on tags for delete using (auth.uid() = user_id);
  end if;
end $$;

alter table meeting_tags enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'meeting_tags' and policyname = 'own_rows_select') then
    create policy "own_rows_select" on meeting_tags for select using (auth.uid() = user_id);
    create policy "own_rows_insert" on meeting_tags for insert with check (auth.uid() = user_id);
    create policy "own_rows_update" on meeting_tags for update using (auth.uid() = user_id);
    create policy "own_rows_delete" on meeting_tags for delete using (auth.uid() = user_id);
  end if;
end $$;

-- Pull the last N summaries from meetings sharing ANY of the given tags, newest
-- first. Mirrors recent_space_summaries (migration 0004): same search_path
-- hardening (empty path + fully-qualified table refs so it can't be hijacked).
create or replace function recent_tagged_summaries(
  tag_ids uuid[],
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
  select m.id, m.title, m.summary_title, m.summary, m.ended_at
  from public.meetings m
  where m.user_id = user_id_filter
    and m.summary is not null
    and (exclude_meeting is null or m.id <> exclude_meeting)
    and exists (
      select 1 from public.meeting_tags mt
      where mt.meeting_id = m.id
        and mt.tag_id = any(tag_ids)
    )
  order by coalesce(m.ended_at, m.started_at, m.created_at) desc
  limit match_count;
$$;
