-- Ephemeral meeting guests.
-- A host shares a link for an ongoing meeting; guests sign in anonymously
-- (just a name, optional email) and get READ access to that one meeting's
-- transcript + notes, plus chat scoped to the host's attached context.

-- Share token: presence = guest link is live. Rotated/revoked by the host.
alter table meetings
  add column if not exists share_token text;
create unique index if not exists meetings_share_token_idx
  on meetings(share_token) where share_token is not null;

-- Ephemeral participants (one row per anonymous guest per meeting).
create table if not exists meeting_participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references meetings on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  email text,
  role text not null default 'guest' check (role in ('host', 'guest')),
  created_at timestamptz default now(),
  unique (meeting_id, user_id)
);
create index if not exists meeting_participants_meeting_idx
  on meeting_participants(meeting_id);

alter table meeting_participants enable row level security;

-- A guest sees their own row; the meeting owner sees all rows for their meeting.
create policy "participants_select_self" on meeting_participants
  for select using (auth.uid() = user_id);
create policy "participants_select_owner" on meeting_participants
  for select using (
    exists (
      select 1 from meetings m
      where m.id = meeting_id and m.user_id = auth.uid()
    )
  );

-- Membership check used by the read policies below. SECURITY DEFINER so it can
-- read meeting_participants without re-triggering that table's RLS (which would
-- recurse). Marked STABLE; locked search_path.
create or replace function is_meeting_participant(p_meeting_id uuid, p_uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from meeting_participants mp
    where mp.meeting_id = p_meeting_id and mp.user_id = p_uid
  );
$$;

-- Additional permissive SELECT policies — these OR with the existing
-- owner-only ("own_rows_select") policies, so the owner is unaffected and a
-- participant gains read-only access to exactly their meeting's rows.
create policy "meetings_select_participant" on meetings
  for select using (is_meeting_participant(id, auth.uid()));

create policy "transcripts_select_participant" on transcripts
  for select using (is_meeting_participant(meeting_id, auth.uid()));

create policy "notes_select_participant" on notes
  for select using (
    meeting_id is not null and is_meeting_participant(meeting_id, auth.uid())
  );

-- Join via share link: validate the token, then upsert the caller's row.
-- SECURITY DEFINER so it can look up the meeting by its (RLS-protected) token
-- and insert the participant row regardless of the caller's own-row policies.
create or replace function join_meeting_by_token(
  p_token text,
  p_name text,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  m meetings%rowtype;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'missing token';
  end if;

  select * into m from meetings where share_token = p_token;
  if not found then
    raise exception 'invalid or expired link';
  end if;
  if m.ended_at is not null then
    raise exception 'this meeting has ended';
  end if;

  insert into meeting_participants (meeting_id, user_id, name, email, role)
  values (
    m.id,
    uid,
    coalesce(nullif(trim(p_name), ''), 'Guest'),
    nullif(trim(p_email), ''),
    'guest'
  )
  on conflict (meeting_id, user_id) do update
    set name = excluded.name,
        email = coalesce(excluded.email, meeting_participants.email);

  return m.id;
end;
$$;

-- Realtime: broadcast transcript inserts so guests see new lines live. RLS
-- still gates which rows each subscriber receives. Guarded so re-running is a
-- no-op if the table is already in the publication.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'transcripts'
  ) then
    execute 'alter publication supabase_realtime add table transcripts';
  end if;
end $$;
