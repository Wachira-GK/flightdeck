-- Read-only audit log screen for admins (ADR-013). The log itself stays append-only; this only READS it.
-- Keyset pagination (newest first, "before" = the smallest id of the previous page), optional filter on the action name.
-- Opening the first page is itself recorded (action 'admin_view_audit'), like opening a user profile.

create function public.fd_admin_audit_list(p_actor uuid, p_action text, p_before bigint, p_limit integer)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 10), 100);
  v_action text := nullif(btrim(coalesce(p_action, '')), '');
  v_rows jsonb;
  v_more boolean;
begin
  if not app_private.admin_actor_ok(p_actor) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'at', r.at, 'actorId', r.actor_id, 'action', r.action, 'entity', r.entity, 'entityId', r.entity_id, 'detail', r.detail) order by r.id desc), '[]'::jsonb)
    into v_rows
    from (select * from app_private.audit_log a
           where (v_action is null or a.action = v_action) and (p_before is null or a.id < p_before)
           order by a.id desc limit v_limit) r;

  select exists (select 1 from app_private.audit_log a
                  where (v_action is null or a.action = v_action)
                    and a.id < coalesce((select min((x->>'id')::bigint) from jsonb_array_elements(v_rows) x), 0))
    into v_more;

  if p_before is null then
    insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
    values (p_actor, 'admin_view_audit', 'audit_log', null, jsonb_build_object('filter', v_action));
  end if;

  return jsonb_build_object(
    'ok', true,
    'rows', v_rows,
    'more', v_more,
    'actions', coalesce((select jsonb_agg(distinct a.action order by a.action) from app_private.audit_log a), '[]'::jsonb));
end;
$$;

revoke execute on function public.fd_admin_audit_list(uuid, text, bigint, integer) from public, anon, authenticated;
grant execute on function public.fd_admin_audit_list(uuid, text, bigint, integer) to service_role;
