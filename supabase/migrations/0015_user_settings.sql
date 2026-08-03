-- 0015 — Per-user BYOK settings.
--
-- Each user can supply their own provider API keys. Keys are encrypted in app
-- code (aes-256-gcm, base64 "iv:tag:ct" — see src/lib/crypto.ts) and stored as
-- text; a null key means "fall back to the ContextBrain platform key". Enable
-- flags let a user keep a key on file but temporarily run on the platform key.
-- `models` is reserved for per-task model selection (BYOK.md phase 2). See
-- BYOK.md for the full design.

create table if not exists user_settings (
  user_id             uuid primary key references auth.users on delete cascade,
  anthropic_key       text,          -- encrypted; null = use platform key
  openai_key          text,          -- encrypted; reserved (embeddings locked to platform in v1)
  deepgram_key        text,          -- encrypted
  deepgram_project_id text,          -- not a secret; stored plain
  anthropic_enabled   boolean not null default true,
  openai_enabled      boolean not null default true,
  deepgram_enabled    boolean not null default true,
  models              jsonb not null default '{}'::jsonb,   -- reserved (per-task model choices)
  key_status          jsonb not null default '{}'::jsonb,   -- cached { provider: { valid, validatedAt } }
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

alter table user_settings enable row level security;

-- Owner-only, matching the house own_rows_* pattern (see 0001_init).
do $$
begin
  execute 'drop policy if exists "own_rows_select" on user_settings';
  execute 'drop policy if exists "own_rows_insert" on user_settings';
  execute 'drop policy if exists "own_rows_update" on user_settings';
  execute 'drop policy if exists "own_rows_delete" on user_settings';
  execute 'create policy "own_rows_select" on user_settings for select using (auth.uid() = user_id)';
  execute 'create policy "own_rows_insert" on user_settings for insert with check (auth.uid() = user_id)';
  execute 'create policy "own_rows_update" on user_settings for update using (auth.uid() = user_id)';
  execute 'create policy "own_rows_delete" on user_settings for delete using (auth.uid() = user_id)';
end $$;
