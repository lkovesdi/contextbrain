-- 0005 — Notes get their own space.
--
-- Notes are first-class citizens of a space, not just children of a meeting.
-- A note created inside a meeting inherits the meeting's space at insert time
-- (handled in the API layer), and can be re-filed independently later. The
-- space FK is `on delete set null` so deleting a space turns its notes into
-- unfiled notes rather than destroying them.

alter table notes
  add column if not exists space_id uuid references spaces on delete set null;

create index if not exists notes_space_id_idx on notes(space_id);

-- Backfill existing notes from their meeting's current space. Notes whose
-- meeting was already deleted (meeting_id null) and notes attached to
-- unfiled meetings stay unfiled.
update notes n
   set space_id = m.space_id
  from meetings m
 where n.meeting_id = m.id
   and n.space_id is null
   and m.space_id is not null;
