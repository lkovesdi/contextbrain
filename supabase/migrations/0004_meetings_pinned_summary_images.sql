-- 0004 — pinned summary images.
-- Users can right-click an image in the chat and pin it to the meeting; the
-- summary generator embeds pinned images regardless of retrieval relevance.
-- Each entry: { url: text, alt: text|null, label: text|null }.

alter table meetings
  add column if not exists pinned_summary_images jsonb not null default '[]'::jsonb;
