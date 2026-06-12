-- Resolves the host-owned context a guest is allowed to chat against, in one
-- authorized call. Returns nothing unless the caller is a participant of the
-- meeting, so it doubles as the authorization check. SECURITY DEFINER so it can
-- read the host's (RLS-protected) context_presets row.
--
-- Scope is deliberately narrow: the meeting's own transcripts (handled by the
-- caller) plus the external contexts + integrations the host explicitly
-- attached to THIS meeting via its preset. No cross-meeting summaries, no
-- arbitrary notes — a guest must not be able to reach the host's other data.
create or replace function guest_meeting_context(p_meeting_id uuid)
returns table (
  owner_id uuid,
  external_context_ids uuid[],
  integrations jsonb
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  m meetings%rowtype;
  p context_presets%rowtype;
begin
  if not is_meeting_participant(p_meeting_id, auth.uid()) then
    return; -- empty result = not authorized
  end if;

  select * into m from meetings where id = p_meeting_id;
  if not found then
    return;
  end if;

  if m.context_preset_id is not null then
    select * into p from context_presets where id = m.context_preset_id;
  end if;

  owner_id := m.user_id;
  external_context_ids := coalesce(
    (select array(
      select jsonb_array_elements_text(p.sources -> 'external_context_ids')
    ))::uuid[],
    '{}'::uuid[]
  );
  integrations := coalesce(p.sources -> 'integrations', '{}'::jsonb);
  return next;
end;
$$;
