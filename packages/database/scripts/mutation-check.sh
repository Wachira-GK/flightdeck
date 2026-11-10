#!/usr/bin/env bash
# Mutation check: inject known security regressions and require the RLS suite to FAIL for each.
# A mutation that the suite does not catch means a test gap.
set -u
cd "$(dirname "$0")/.."
declare -A M=(
  [notes-readable-by-all]="create policy leak on public.notes for select to authenticated using (true);"
  [anon-reads-profiles]="grant select on public.profiles to anon; create policy leak on public.profiles for select to anon using (true);"
  [client-sets-score]="grant update (score, passed) on public.assessment_attempts to authenticated; create policy leak on public.assessment_attempts for update to authenticated using (user_id = auth.uid());"
  [answer-keys-exposed]="grant select on app_private.exercise_keys to authenticated; create policy leak on app_private.exercise_keys for select to authenticated using (true);"
  [definer-search-path-reset]="alter function app_private.can_enrol(uuid,uuid) reset search_path;"
  [drafts-readable]="create or replace function app_private.can_read_version(p_version uuid) returns boolean language sql stable security definer set search_path = '' as \$\$ select true \$\$;"
  [learner-self-grants-role]="grant insert on public.user_roles to authenticated; create policy leak on public.user_roles for insert to authenticated with check (true);"
  [client-sets-exercise-pass]="grant insert (passed, status, validated_at) on public.exercise_attempts to authenticated; drop policy own_insert on public.exercise_attempts; create policy leak on public.exercise_attempts for insert to authenticated with check (user_id = auth.uid());"
)
missed=0
for name in "${!M[@]}"; do
  if RLS_MUTATION="${M[$name]}" npx vitest run >/dev/null 2>&1; then
    echo "MISSED  $name"; missed=$((missed+1))
  else
    echo "caught  $name"
  fi
done
echo "mutations=${#M[@]} missed=$missed"
exit $missed
