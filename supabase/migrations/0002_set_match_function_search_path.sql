-- Address advisor warning `function_search_path_mutable` by pinning the
-- search_path on the three match_* functions and fully qualifying refs.

create or replace function public.match_transcripts(
  query_embedding vector(1536),
  match_count int,
  user_id_filter uuid,
  meeting_id_filter uuid default null
) returns table (id uuid, content text, speaker text, similarity float)
language sql stable
set search_path = public
as $$
  select id, content, speaker, 1 - (embedding <=> query_embedding) as similarity
  from public.transcripts
  where user_id = user_id_filter
    and (meeting_id_filter is null or meeting_id = meeting_id_filter)
    and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;

create or replace function public.match_notes(
  query_embedding vector(1536),
  match_count int,
  user_id_filter uuid
) returns table (id uuid, content text, similarity float)
language sql stable
set search_path = public
as $$
  select id, content, 1 - (embedding <=> query_embedding) as similarity
  from public.notes
  where user_id = user_id_filter
    and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;

create or replace function public.match_external_chunks(
  query_embedding vector(1536),
  match_count int,
  user_id_filter uuid,
  context_ids uuid[]
) returns table (id uuid, content text, metadata jsonb, similarity float)
language sql stable
set search_path = public
as $$
  select id, content, metadata, 1 - (embedding <=> query_embedding) as similarity
  from public.external_chunks
  where user_id = user_id_filter
    and external_context_id = any(context_ids)
    and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;
