-- 0013 — Per-space chat.
--
-- Each space gets one persistent chat thread that searches "everything in the
-- space" by default: transcripts across all its meetings, its notes, recent
-- summaries (already covered by recent_space_summaries), plus whatever preset
-- sources the space carries. Two additions:
--   1. chat_messages.space_id — space-scoped persistence, mirroring meeting_id.
--   2. Space-wide vector search RPCs over transcripts and notes.

alter table chat_messages
  add column if not exists space_id uuid references spaces on delete cascade;
create index if not exists chat_messages_space_idx on chat_messages(space_id);

-- Vector search across every transcript line in a space's meetings. Returns
-- the meeting headline so chat sources read "«Weekly sync» transcript" instead
-- of a bare "transcript".
create or replace function public.match_space_transcripts(
  query_embedding vector(1536),
  match_count int,
  user_id_filter uuid,
  space_id_filter uuid
) returns table (
  id uuid,
  content text,
  speaker text,
  meeting_id uuid,
  meeting_title text,
  similarity float
)
language sql stable
set search_path = public
as $$
  select t.id, t.content, t.speaker, t.meeting_id,
         coalesce(nullif(trim(m.summary_title), ''), m.title) as meeting_title,
         1 - (t.embedding <=> query_embedding) as similarity
  from public.transcripts t
  join public.meetings m on m.id = t.meeting_id
  where t.user_id = user_id_filter
    and m.space_id = space_id_filter
    and t.embedding is not null
  order by t.embedding <=> query_embedding
  limit match_count;
$$;

-- Vector search over the space's notes (notes.space_id backfilled in 0005).
create or replace function public.match_space_notes(
  query_embedding vector(1536),
  match_count int,
  user_id_filter uuid,
  space_id_filter uuid
) returns table (id uuid, content text, similarity float)
language sql stable
set search_path = public
as $$
  select n.id, n.content, 1 - (n.embedding <=> query_embedding) as similarity
  from public.notes n
  where n.user_id = user_id_filter
    and n.space_id = space_id_filter
    and n.embedding is not null
  order by n.embedding <=> query_embedding
  limit match_count;
$$;
