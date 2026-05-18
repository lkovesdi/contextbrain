-- 0003 — chip status / indexing progress on external_contexts.
-- Each external_context now reports how its background indexing is going so
-- the UI can render a circular progress per chip and gate sub-agent calls
-- on `status = 'ready'`.

alter table external_contexts
  add column if not exists status text not null default 'ready'
    check (status in ('queued','indexing','ready','error')),
  add column if not exists chunks_total int not null default 0,
  add column if not exists chunks_done int not null default 0,
  add column if not exists error_message text;

-- Existing rows (e.g. Claude exports already imported) are treated as ready.
update external_contexts set status = 'ready' where status is null;

create index if not exists external_contexts_status_idx on external_contexts(status);
