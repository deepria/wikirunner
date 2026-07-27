create or replace function public.abandon_run(
  p_game_id uuid,
  p_run_id uuid,
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
  target_run public.runs%rowtype;
  target_game public.games%rowtype;
  abandoned_time timestamptz := statement_timestamp();
  current_game_status public.game_status;
  current_room_status public.room_status;
  result jsonb;
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(caller_id::text || ':' || p_idempotency_key::text, 0)
  );

  request_digest := encode(
    digest(
      jsonb_build_object('gameId', p_game_id, 'runId', p_run_id)::text,
      'sha256'
    ),
    'hex'
  );

  select *
  into existing_receipt
  from public.command_receipts
  where auth_user_id = caller_id
    and idempotency_key = p_idempotency_key;

  if found then
    if existing_receipt.command_type <> 'abandon_run'
      or existing_receipt.request_hash <> request_digest
    then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return existing_receipt.response;
  end if;

  select run.*
  into target_run
  from public.runs run
  join public.player_identities identity on identity.player_id = run.player_id
  where run.id = p_run_id
    and run.game_id = p_game_id
    and identity.auth_user_id = caller_id
    and identity.kind = 'extension'
    and identity.revoked_at is null
  for update of run;

  if not found then
    raise exception using errcode = '42501', message = 'RUN_ACCESS_DENIED';
  end if;

  select *
  into target_game
  from public.games
  where id = p_game_id
  for update;

  if target_game.status not in ('countdown', 'running')
    or target_run.status not in ('waiting', 'running', 'flagged')
  then
    raise exception using errcode = '55000', message = 'RUN_NOT_ACTIVE';
  end if;

  update public.runs
  set
    status = 'abandoned',
    finished_at = abandoned_time,
    version = version + 1
  where id = p_run_id;

  if not exists (
    select 1
    from public.runs
    where game_id = p_game_id
      and status not in ('finished', 'abandoned', 'disqualified')
  ) then
    update public.games
    set
      status = (
        case
          when status = 'countdown' then 'cancelled'
          else 'finished'
        end
      )::public.game_status,
      finished_at = case
        when status = 'countdown' then null
        else coalesce(finished_at, abandoned_time)
      end
    where id = p_game_id;

    update public.rooms
    set
      status = 'finished',
      version = version + 1
    where id = target_game.room_id
      and status in ('countdown', 'running');
  end if;

  select status
  into current_game_status
  from public.games
  where id = p_game_id;

  select status
  into current_room_status
  from public.rooms
  where id = target_game.room_id;

  result := jsonb_build_object(
    'runId', p_run_id,
    'status', 'abandoned',
    'abandonedAt', abandoned_time,
    'gameStatus', current_game_status,
    'roomStatus', current_room_status
  );

  insert into public.command_receipts (
    idempotency_key,
    auth_user_id,
    command_type,
    request_hash,
    response
  )
  values (
    p_idempotency_key,
    caller_id,
    'abandon_run',
    request_digest,
    result
  );

  return result;
end;
$$;

revoke all on function public.abandon_run(uuid, uuid, uuid) from public, anon;
grant execute on function public.abandon_run(uuid, uuid, uuid) to authenticated;
