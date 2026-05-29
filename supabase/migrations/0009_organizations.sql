-- Organizations & memberships (onboarding-metadata model).
-- Orgs are an OPTIONAL layer: existing meetings/notes/contexts stay
-- user-scoped, so solo (non-org) users keep working untouched. Org
-- creation/joining is bound to the caller's *verified* email domain at the
-- DB boundary via SECURITY DEFINER functions — the "real + work-only" rule is
-- enforced here, not just in the UI. (DNS/MX + free-provider checks live in
-- the API since SQL can't resolve DNS.)

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null unique,
  industry text,
  size text,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz default now()
);

create table organization_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz default now(),
  unique (org_id, user_id)
);
create index organization_members_user_idx on organization_members(user_id);
create index organization_members_org_idx on organization_members(org_id);

-- ============ Row-level security ============

alter table organizations enable row level security;
alter table organization_members enable row level security;

-- A member sees only their own membership rows. Kept deliberately simple
-- (no self-reference) so the organizations policy below can't recurse.
create policy "own_membership_select" on organization_members
  for select using (user_id = auth.uid());

-- A user sees an org only if they belong to it. References
-- organization_members (a different table) so there's no policy recursion.
create policy "member_org_select" on organizations
  for select using (
    exists (
      select 1 from organization_members m
      where m.org_id = organizations.id and m.user_id = auth.uid()
    )
  );

-- No direct INSERT/UPDATE/DELETE policies: all writes flow through the
-- SECURITY DEFINER functions below, which bypass RLS and enforce the
-- domain-binding invariant.

-- ============ Domain-bound write functions ============

-- Lowercased email domain of the current authed user, from the verified JWT.
create or replace function public.current_email_domain()
returns text
language sql stable security invoker set search_path = public
as $$
  select lower(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 2))
$$;

-- Look up an org by domain without requiring membership (so a prospective
-- member can discover "your team is already here"). Returns minimal info.
create or replace function public.find_org_by_domain(p_domain text)
returns table (id uuid, name text, member_count bigint)
language sql stable security definer set search_path = public
as $$
  select o.id, o.name,
         (select count(*) from organization_members m where m.org_id = o.id)
  from organizations o
  where o.domain = lower(p_domain)
  limit 1
$$;

-- Create an org bound to the caller's verified email domain (or join the
-- existing one if the domain is already claimed). Idempotent on membership.
create or replace function public.create_organization(
  p_name text,
  p_industry text default null,
  p_size text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_domain text := current_email_domain();
  v_org_id uuid;
begin
  if v_domain is null or v_domain = '' then
    raise exception 'no_email_domain';
  end if;

  select id into v_org_id from organizations where domain = v_domain;
  if v_org_id is not null then
    insert into organization_members (org_id, user_id, role)
    values (v_org_id, auth.uid(), 'member')
    on conflict (org_id, user_id) do nothing;
    return v_org_id;
  end if;

  insert into organizations (name, domain, industry, size, created_by)
  values (coalesce(nullif(trim(p_name), ''), v_domain), v_domain, p_industry, p_size, auth.uid())
  returning id into v_org_id;

  insert into organization_members (org_id, user_id, role)
  values (v_org_id, auth.uid(), 'owner');

  return v_org_id;
end;
$$;

-- Join an existing org, but only if the caller's verified email domain
-- matches the org's domain.
create or replace function public.join_organization(p_org_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_domain text := current_email_domain();
  v_org_domain text;
begin
  select domain into v_org_domain from organizations where id = p_org_id;
  if v_org_domain is null then
    raise exception 'org_not_found';
  end if;
  if v_org_domain <> v_domain then
    raise exception 'domain_mismatch';
  end if;

  insert into organization_members (org_id, user_id, role)
  values (p_org_id, auth.uid(), 'member')
  on conflict (org_id, user_id) do nothing;

  return p_org_id;
end;
$$;

-- ============ Function grants ============
-- These RPCs require an authenticated caller. Supabase grants execute to both
-- PUBLIC and the `anon` role by default, so revoke from both and grant execute
-- only to authenticated.

revoke execute on function public.create_organization(text, text, text) from public, anon;
revoke execute on function public.join_organization(uuid) from public, anon;
revoke execute on function public.find_org_by_domain(text) from public, anon;

grant execute on function public.create_organization(text, text, text) to authenticated;
grant execute on function public.join_organization(uuid) to authenticated;
grant execute on function public.find_org_by_domain(text) to authenticated;
