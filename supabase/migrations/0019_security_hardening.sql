-- 0019 — Security hardening: bind find_org_by_domain to the caller's own
-- verified email domain (previously any authenticated user could pass an
-- arbitrary p_domain and enumerate org name + member count for any company),
-- and revoke anon/public execute on is_meeting_participant (previously
-- callable unauthenticated as a participant-membership oracle).

create or replace function public.find_org_by_domain(p_domain text)
returns table (id uuid, name text, member_count bigint)
language sql stable security definer set search_path = public
as $$
  select o.id, o.name,
         (select count(*) from organization_members m where m.org_id = o.id)
  from organizations o
  where o.domain = lower(p_domain)
    and lower(p_domain) = current_email_domain()
  limit 1
$$;

revoke execute on function public.is_meeting_participant(uuid, uuid) from public, anon;
grant execute on function public.is_meeting_participant(uuid, uuid) to authenticated;
