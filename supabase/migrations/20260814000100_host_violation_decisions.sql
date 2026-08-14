create or replace function public.decide_violation(
  p_violation_id uuid,
  p_resolution public.violation_resolution,
  p_note text,
  p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare caller uuid := auth.uid(); violation public.violations%rowtype; target_game_id uuid; revision integer;
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_resolution not in ('accepted', 'disqualified') then raise exception 'INVALID_RESOLUTION'; end if;
  select violation.* into violation from public.violations violation
  join public.runs run on run.id = violation.run_id join public.games game on game.id = run.game_id
  join public.rooms room on room.id = game.room_id
  join public.player_identities identity on identity.player_id = room.host_player_id
  where violation.id = p_violation_id and identity.auth_user_id = caller and identity.kind = 'web' and identity.revoked_at is null
  for update of violation;
  if not found then raise exception 'HOST_REQUIRED'; end if;
  select run.game_id into target_game_id from public.runs run where run.id = violation.run_id;
  update public.violations set resolution = p_resolution, resolved_by = (select player_id from public.player_identities where auth_user_id = caller and kind = 'web' and revoked_at is null), resolved_at = now(), resolution_note = nullif(trim(p_note), '') where id = p_violation_id;
  if p_resolution = 'disqualified' then
    update public.runs set status = 'disqualified', rank = null where id = violation.run_id;
    perform public.rank_finished_runs(target_game_id);
  else
    update public.runs set violation_status = 'reviewed' where id = violation.run_id;
  end if;
  select coalesce(max(result_decisions.revision), 0) + 1 into revision from public.result_decisions where result_decisions.game_id = target_game_id;
  insert into public.result_decisions(game_id, revision, decided_by, leaderboard, violation_decisions)
  select target_game_id, revision, (select player_id from public.player_identities where auth_user_id = caller and kind = 'web' and revoked_at is null),
    coalesce(jsonb_agg(jsonb_build_object('runId', id, 'status', status, 'rank', rank) order by rank nulls last), '[]'::jsonb),
    jsonb_build_array(jsonb_build_object('violationId', p_violation_id, 'resolution', p_resolution)) from public.runs where game_id = target_game_id;
  return jsonb_build_object('violationId', p_violation_id, 'resolution', p_resolution, 'gameId', target_game_id);
end; $$;

revoke all on function public.decide_violation(uuid, public.violation_resolution, text, uuid) from public, anon;
grant execute on function public.decide_violation(uuid, public.violation_resolution, text, uuid) to authenticated;
