-- 0020 — Prepaid credits.
--
-- Users without a BYOK key draw down a prepaid dollar balance when their calls
-- run on the platform keys (Anthropic, Deepgram). BYOK calls bypass credits
-- entirely. The ledger is append-only, denominated in micro-USD (1_000_000 =
-- $1.00) so sub-cent LLM debits don't lose precision. All writes happen
-- server-side with the service key (bypasses RLS); clients can only read
-- their own rows. See src/lib/credits.ts for pricing.

create table if not exists credit_ledger (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users on delete cascade,
  delta_usd_micros bigint not null,   -- positive = credit, negative = debit
  reason      text not null check (reason in
                ('signup_grant','purchase','llm_usage','transcription_usage','adjustment','refund')),
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists credit_ledger_user_idx
  on credit_ledger (user_id, created_at desc);

-- Idempotency: one purchase row per Stripe checkout session.
create unique index if not exists credit_ledger_stripe_session_idx
  on credit_ledger ((meta->>'stripe_session_id'))
  where reason = 'purchase' and meta ? 'stripe_session_id';

alter table credit_ledger enable row level security;

-- Read-only for owners; no insert/update/delete policies — the service role
-- (which bypasses RLS) is the only writer.
do $$
begin
  execute 'drop policy if exists "own_rows_select" on credit_ledger';
  execute 'create policy "own_rows_select" on credit_ledger for select using (auth.uid() = user_id)';
end $$;

-- Balance = sum of deltas. SECURITY DEFINER so it can aggregate without a
-- table-wide select grant, but guarded: a user can only ask about themself;
-- the service role can ask about anyone.
create or replace function credit_balance_usd_micros(p_user_id uuid)
returns bigint
language sql stable
security definer set search_path = public
as $$
  select coalesce(sum(delta_usd_micros), 0)::bigint
  from credit_ledger
  where user_id = p_user_id
    and (p_user_id = (select auth.uid()) or (select auth.role()) = 'service_role');
$$;

-- $5 starter grant for every new (non-anonymous) signup, so onboarding keeps
-- working the day the platform-key fallback stops being free. Ephemeral guests
-- (signInAnonymously on /join) get nothing.
create or replace function grant_signup_credits()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.is_anonymous is distinct from true then
    insert into credit_ledger (user_id, delta_usd_micros, reason, meta)
    values (new.id, 5000000, 'signup_grant', '{}'::jsonb);
  end if;
  return new;
end;
$$;

drop trigger if exists grant_signup_credits_trigger on auth.users;
create trigger grant_signup_credits_trigger
  after insert on auth.users
  for each row execute function grant_signup_credits();

-- Backfill: existing real users get the same starter grant once, so nothing
-- breaks for current accounts when metering turns on.
insert into credit_ledger (user_id, delta_usd_micros, reason, meta)
select u.id, 5000000, 'signup_grant', '{"backfill": true}'::jsonb
from auth.users u
where u.is_anonymous is distinct from true
  and not exists (
    select 1 from credit_ledger l
    where l.user_id = u.id and l.reason = 'signup_grant'
  );
