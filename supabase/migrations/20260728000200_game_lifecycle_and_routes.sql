alter table public.runs
  alter column move_count set default 0;

update public.runs run
set move_count = (
  select count(*)::integer
  from public.navigation_events navigation_event
  where navigation_event.run_id = run.id
    and navigation_event.counts_as_move
    and navigation_event.validation_status in ('accepted', 'accepted_with_warning')
);

do $migration$
declare
  current_body text;
  corrected_body text;
  old_assignment constant text := $old$      last_event_hash = event_hash_value,
      violation_status = case$old$;
  new_assignment constant text := $new$      last_event_hash = event_hash_value,
      move_count = coalesce(move_count, 0) + case
        when event_type_value = 'link' then 1
        else 0
      end,
      violation_status = case$new$;
begin
  select procedure.prosrc
  into current_body
  from pg_proc procedure
  where procedure.oid =
    'public.submit_navigation_events(uuid,uuid,jsonb,uuid)'::regprocedure;

  if current_body is null then
    raise exception 'submit_navigation_events function was not found';
  end if;

  corrected_body := replace(current_body, old_assignment, new_assignment);
  if corrected_body = current_body
    and position(new_assignment in current_body) = 0
  then
    raise exception 'submit_navigation_events move count assignment was not found';
  end if;

  execute format(
    $definition$
      create or replace function public.submit_navigation_events(
        p_game_id uuid,
        p_run_id uuid,
        p_events jsonb,
        p_idempotency_key uuid
      )
      returns jsonb
      language plpgsql
      security definer
      set search_path = public, extensions, pg_temp
      as %L
    $definition$,
    corrected_body
  );
end;
$migration$;

drop policy if exists navigation_events_owner_or_host_select
  on public.navigation_events;

create policy navigation_events_room_member_select
  on public.navigation_events for select to authenticated
  using (
    exists (
      select 1
      from public.runs run
      join public.games game on game.id = run.game_id
      where run.id = navigation_events.run_id
        and (select public.is_room_member(game.room_id))
    )
  );

create or replace function public.prepare_next_game(
  p_room_id uuid,
  p_expected_version bigint,
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
  target_room public.rooms%rowtype;
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
      jsonb_build_object(
        'roomId', p_room_id,
        'expectedVersion', p_expected_version
      )::text,
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
    if existing_receipt.command_type <> 'prepare_next_game'
      or existing_receipt.request_hash <> request_digest
    then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return existing_receipt.response;
  end if;

  select *
  into target_room
  from public.rooms
  where id = p_room_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ROOM_NOT_FOUND';
  end if;
  if target_room.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'VERSION_CONFLICT';
  end if;
  if not exists (
    select 1
    from public.player_identities
    where player_id = target_room.host_player_id
      and auth_user_id = caller_id
      and kind = 'web'
      and revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'HOST_REQUIRED';
  end if;
  if target_room.status <> 'finished' then
    raise exception using errcode = '55000', message = 'NEXT_GAME_NOT_AVAILABLE';
  end if;

  update public.players
  set ready_at = null
  where room_id = p_room_id
    and connection_status <> 'left';

  update public.rooms
  set
    status = 'waiting',
    current_game_id = null,
    version = version + 1
  where id = p_room_id
  returning * into target_room;

  result := jsonb_build_object(
    'roomId', target_room.id,
    'status', target_room.status,
    'roomVersion', target_room.version
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
    'prepare_next_game',
    request_digest,
    result
  );

  return result;
end;
$$;

create or replace function public.end_game(
  p_game_id uuid,
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
  target_room public.rooms%rowtype;
  ended_time timestamptz := statement_timestamp();
  resulting_game_status public.game_status;
  result jsonb;
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(caller_id::text || ':' || p_idempotency_key::text, 0)
  );

  request_digest := encode(
    digest(jsonb_build_object('gameId', p_game_id)::text, 'sha256'),
    'hex'
  );

  select *
  into existing_receipt
  from public.command_receipts
  where auth_user_id = caller_id
    and idempotency_key = p_idempotency_key;

  if found then
    if existing_receipt.command_type <> 'end_game'
      or existing_receipt.request_hash <> request_digest
    then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return existing_receipt.response;
  end if;

  select *
  into target_game
  from public.games
  where id = p_game_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'GAME_NOT_FOUND';
  end if;

  select *
  into target_room
  from public.rooms
  where id = target_game.room_id
  for update;

  if not exists (
    select 1
    from public.player_identities
    where player_id = target_room.host_player_id
      and auth_user_id = caller_id
      and kind = 'web'
      and revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'HOST_REQUIRED';
  end if;
  if target_room.current_game_id is distinct from p_game_id
    or target_game.status not in ('countdown', 'running')
  then
    raise exception using errcode = '55000', message = 'GAME_NOT_ACTIVE';
  end if;

  update public.runs
  set
    status = 'abandoned',
    finished_at = ended_time,
    move_count = coalesce(move_count, 0),
    version = version + 1
  where game_id = p_game_id
    and status not in ('finished', 'abandoned', 'disqualified');

  resulting_game_status := (
    case
      when target_game.status = 'countdown' then 'cancelled'
      else 'finished'
    end
  )::public.game_status;

  update public.games
  set
    status = resulting_game_status,
    finished_at = case
      when resulting_game_status = 'cancelled' then null
      else ended_time
    end
  where id = p_game_id;

  update public.rooms
  set
    status = 'finished',
    version = version + 1
  where id = target_room.id
  returning * into target_room;

  result := jsonb_build_object(
    'gameId', p_game_id,
    'gameStatus', resulting_game_status,
    'roomStatus', target_room.status,
    'endedAt', ended_time
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
    'end_game',
    request_digest,
    result
  );

  return result;
end;
$$;

revoke all on function public.prepare_next_game(uuid, bigint, uuid)
  from public, anon;
revoke all on function public.end_game(uuid, uuid) from public, anon;

grant execute on function public.prepare_next_game(uuid, bigint, uuid)
  to authenticated;
grant execute on function public.end_game(uuid, uuid) to authenticated;
