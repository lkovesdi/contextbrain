-- 0008 — Meetings list: keyset pagination + fuzzy title search.
--
-- The dashboard used to `select *` every meeting with no limit or search. This
-- adds the indexes and the search function to support:
--   • Keyset (cursor) pagination ordered by (started_at desc, id desc) — stable
--     under inserts and fast at depth. started_at defaults to now() so it's
--     effectively non-null; id is the tiebreaker for equal timestamps.
--   • Trigram fuzzy search over title + summary_title via pg_trgm (typo- and
--     substring-tolerant), ranked by similarity.

create extension if not exists pg_trgm;

-- Keyset/order index for the browse list.
create index if not exists meetings_started_at_id_idx
  on meetings (started_at desc, id desc);

-- Trigram indexes power both `ilike '%q%'` and `similarity()` ranking.
create index if not exists meetings_title_trgm_idx
  on meetings using gin (title gin_trgm_ops);
create index if not exists meetings_summary_title_trgm_idx
  on meetings using gin (summary_title gin_trgm_ops);

-- Fuzzy search ranked by best trigram similarity across title/summary_title,
-- with a substring (ilike) fallback so short exact queries still match. Hardened
-- like the other functions: empty search_path + fully-qualified refs (pg_trgm
-- lives in public here, so similarity() is qualified).
create or replace function search_meetings(
  q text,
  user_id_filter uuid,
  match_count int default 30
) returns table (
  id uuid,
  title text,
  summary_title text,
  started_at timestamptz,
  ended_at timestamptz,
  space_id uuid,
  score real
)
language sql stable
set search_path = ''
as $$
  select
    m.id, m.title, m.summary_title, m.started_at, m.ended_at, m.space_id,
    greatest(
      public.similarity(m.title, q),
      public.similarity(coalesce(m.summary_title, ''), q)
    ) as score
  from public.meetings m
  where m.user_id = user_id_filter
    and (
      m.title ilike '%' || q || '%'
      or coalesce(m.summary_title, '') ilike '%' || q || '%'
      or public.similarity(m.title, q) > 0.2
      or public.similarity(coalesce(m.summary_title, ''), q) > 0.2
    )
  order by score desc, coalesce(m.started_at, m.created_at) desc, m.id desc
  limit match_count;
$$;
