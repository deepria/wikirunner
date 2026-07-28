create or replace function public.report_fair_play_violation(
  p_game_id uuid,
  p_run_id uuid,
  p_type public.violation_type,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  request_digest text;
  existing_receipt public.command_receipts%rowtype;
  target_game public.games%rowtype;
  target_run public.runs%rowtype;
  result jsonb;
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;
  if p_type not in ('search_attempt', 'new_tab') then
    raise exception using errcode = '22023', message = 'INVALID_REQUEST';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(caller_id::text || ':' || p_idempotency_key::text, 0)
  );
  request_digest := encode(
    digest(
      jsonb_build_object('gameId', p_game_id, 'runId', p_run_id, 'type', p_type)::text,
      'sha256'
    ),
    'hex'
  );
  select * into existing_receipt from public.command_receipts
  where auth_user_id = caller_id and idempotency_key = p_idempotency_key;
  if found then
    if existing_receipt.command_type <> 'report_fair_play_violation'
      or existing_receipt.request_hash <> request_digest
    then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return existing_receipt.response;
  end if;

  select * into target_game from public.games where id = p_game_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'GAME_NOT_FOUND';
  end if;
  if target_game.status not in ('countdown', 'running') then
    raise exception using errcode = '55000', message = 'GAME_NOT_ACTIVE';
  end if;

  select * into target_run from public.runs
  where id = p_run_id and game_id = p_game_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'RUN_ACCESS_DENIED';
  end if;
  if not exists (
    select 1 from public.player_identities identity
    where identity.player_id = target_run.player_id
      and identity.auth_user_id = caller_id
      and identity.kind = 'extension'
      and identity.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'RUN_ACCESS_DENIED';
  end if;
  if target_run.status not in ('waiting', 'running') then
    raise exception using errcode = '55000', message = 'RUN_NOT_ACTIVE';
  end if;

  insert into public.violations (run_id, type, severity, detail)
  values (p_run_id, p_type, 'warning', jsonb_build_object('source', 'extension_ui_block'));
  update public.runs set violation_status = 'warned' where id = p_run_id;

  result := jsonb_build_object('runId', p_run_id, 'violationStatus', 'warned');
  insert into public.command_receipts (
    idempotency_key, auth_user_id, command_type, request_hash, response
  ) values (
    p_idempotency_key, caller_id, 'report_fair_play_violation', request_digest, result
  );
  return result;
end;
$$;

revoke all on function public.report_fair_play_violation(uuid, uuid, public.violation_type, uuid)
  from public, anon;
grant execute on function public.report_fair_play_violation(uuid, uuid, public.violation_type, uuid)
  to authenticated;
