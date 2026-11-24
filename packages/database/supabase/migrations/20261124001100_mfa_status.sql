-- FlightDeck: show and reset two-step sign-in from the database's own record (ADR-010).
-- Supabase's admin user LIST does not report authenticator factors reliably, so the admin screens showed "2-step off"
-- for people who had it on, and "Reset two-step sign-in" could miss factors. The truth lives in auth.mfa_factors, which
-- the service role cannot read directly. This SECURITY DEFINER helper (owner = the migration owner, who can) exposes
-- only: which users have which authenticator factor and whether it is confirmed. No secrets are selected.
-- Only service_role may run it, and the admin-facing wrapper re-checks that the actor is an active admin.

create function app_private.mfa_factors_of(p_ids uuid[])
returns table (user_id uuid, factor_id uuid, status text)
language sql stable security definer set search_path = '' as $$
  select f.user_id, f.id, f.status::text
    from auth.mfa_factors f
   where f.factor_type = 'totp' and f.user_id = any (coalesce(p_ids, '{}'::uuid[]));
$$;
revoke execute on function app_private.mfa_factors_of(uuid[]) from public, anon, authenticated;
grant execute on function app_private.mfa_factors_of(uuid[]) to service_role;

-- For the user list and detail pages: up to 200 users per call.
create function public.fd_admin_mfa_status(p_actor uuid, p_ids uuid[])
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  if not app_private.admin_actor_ok(p_actor) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_ids is null or cardinality(p_ids) > 200 then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;
  return jsonb_build_object('ok', true, 'factors', coalesce((
    select jsonb_agg(jsonb_build_object('userId', m.user_id, 'factorId', m.factor_id, 'status', m.status))
      from app_private.mfa_factors_of(p_ids) m), '[]'::jsonb));
end;
$$;
revoke execute on function public.fd_admin_mfa_status(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.fd_admin_mfa_status(uuid, uuid[]) to service_role;

-- Reset now also returns the factor ids to delete in Supabase Auth (every authenticator factor, confirmed or not).
create or replace function public.fd_admin_mfa_reset(p_actor uuid, p_target uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_problem text := app_private.admin_target_problem(p_actor, p_target);
  v_ids     jsonb;
begin
  if v_problem is not null then return jsonb_build_object('ok', false, 'reason', v_problem); end if;
  if app_private.is_master(p_target) then return jsonb_build_object('ok', false, 'reason', 'master_protected'); end if;
  if p_target = p_actor then return jsonb_build_object('ok', false, 'reason', 'self_change'); end if;
  select coalesce(jsonb_agg(m.factor_id), '[]'::jsonb) into v_ids from app_private.mfa_factors_of(array[p_target]) m;
  insert into app_private.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_actor, 'admin_mfa_reset', 'user', p_target::text, jsonb_build_object('factors', jsonb_array_length(v_ids)));
  return jsonb_build_object('ok', true, 'factorIds', v_ids);
end;
$$;
