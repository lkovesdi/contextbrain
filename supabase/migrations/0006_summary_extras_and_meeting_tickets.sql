-- 0006 — Structured summary fields + created-ticket tracking.
--
-- `meetings.summary_extras` holds the AI's structured outputs that live
-- alongside the freeform markdown summary: decisions, open questions,
-- tangents, and suggested tickets. Shape (all fields optional):
--   {
--     decisions:        [{ text, owner? }],
--     open_questions:   [{ text, raised_by? }],
--     tangents:         [{ topic, note }],
--     suggested_tickets: [{
--       title, description, type, priority, suggested_owner?
--     }]
--   }
-- Regenerating the summary replaces this blob wholesale — created tickets
-- live in their own table so they survive regeneration.
--
-- `meeting_tickets` records issues that were actually created in an external
-- system (Jira or Linear) from a suggested ticket. UI matches by
-- suggestion_title to render "Created → KEY-123" on the card.

alter table meetings
  add column if not exists summary_extras jsonb not null default '{}'::jsonb;

create table if not exists meeting_tickets (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references meetings on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  provider text not null check (provider in ('jira', 'linear')),
  external_key text not null,
  external_url text,
  title text not null,
  suggestion_title text,
  created_at timestamptz default now()
);
create index if not exists meeting_tickets_meeting_id_idx on meeting_tickets(meeting_id);

alter table meeting_tickets enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'meeting_tickets' and policyname = 'own_rows_select') then
    create policy "own_rows_select" on meeting_tickets for select using (auth.uid() = user_id);
    create policy "own_rows_insert" on meeting_tickets for insert with check (auth.uid() = user_id);
    create policy "own_rows_update" on meeting_tickets for update using (auth.uid() = user_id);
    create policy "own_rows_delete" on meeting_tickets for delete using (auth.uid() = user_id);
  end if;
end $$;
