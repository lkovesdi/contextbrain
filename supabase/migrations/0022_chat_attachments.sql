-- 0022 — Chat image attachments (screenshots pasted / captured into chat).
--
--   1. chat_messages.attachments — jsonb list of { path, media_type, width?,
--      height? }; `path` is an object key in the bucket below.
--   2. A private `chat-attachments` storage bucket, images only, 8 MB cap.
--   3. Storage RLS: an object lives at `<user_id>/<uuid>.<ext>` and only its
--      owner (the first path segment) can read, write, or delete it. Anonymous
--      guests are `authenticated` too, so their own screenshots work the same.
--
-- The chat route tolerates this migration not being applied yet (falls back
-- to persisting the text alone), but attachments won't survive a reload
-- until it is.

alter table chat_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-attachments',
  'chat-attachments',
  false,
  8388608,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

drop policy if exists "chat attachments: owner read" on storage.objects;
create policy "chat attachments: owner read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "chat attachments: owner write" on storage.objects;
create policy "chat attachments: owner write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "chat attachments: owner delete" on storage.objects;
create policy "chat attachments: owner delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
