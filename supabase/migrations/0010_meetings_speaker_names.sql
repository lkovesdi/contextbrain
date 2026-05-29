-- Per-meeting speaker label → display name overrides.
-- Lets a user click a diarization label ("Speaker 0", "Unknown") in the
-- transcript and attach a name. Stored as { "<raw label>": "<name>" } and
-- applied at display/summary time, so the raw Deepgram labels are preserved
-- (and new live lines for the same speaker pick up the name automatically).
alter table meetings
  add column if not exists speaker_names jsonb not null default '{}'::jsonb;
