
-- FlightDeck: admin reset of someone's two-step sign-in (ADR-010, builds on ADR-009).
-- Used when a person loses their phone. The web server calls this FIRST (it re-checks that the actor is an active
-- admin and writes the audit entry), and only if it says ok does it remove the person's authenticator factors in
-- Supabase Auth. They then set it up again at their next sign-in (admins are made to before reaching /admin).
-- Nobody can reset their own (they could not have proved who they are without the app) and nobody can reset the
-- master's through the dashboard: the master recovers through the database (see ADR-010).
create function public.fd_admin_mfa_reset(p_actor uuid, p_target uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_problem text := app_private.admin_target_problem(p_actor, p_target);
begin
  if v_problem is not null then return jsonb_build_object('ok', false, 'reason', v_problem); end if;
  if app_private.is_master(p_target) then return jsonb_build_object('ok', false, 'reason', 'master_protected'); end if;
  if p_target = p_actor then return jsonb_build_object('ok', false, 'reason', 'self_change'); end if;
  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_actor, 'admin_mfa_reset', 'user', p_target::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.fd_admin_mfa_reset(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fd_admin_mfa_reset(uuid, uuid) to service_role;
