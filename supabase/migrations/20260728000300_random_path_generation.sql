alter table public.rooms
  add column draft_random_path jsonb,
  add column draft_random_generation_count smallint not null default 0
    check (draft_random_generation_count between 0 and 10),
  add constraint rooms_draft_random_path_array check (
    draft_random_path is null or jsonb_typeof(draft_random_path) = 'array'
  );

alter table public.games
  add column generated_path jsonb,
  add constraint games_generated_path_array check (
    generated_path is null or jsonb_typeof(generated_path) = 'array'
  );

create or replace function public.snapshot_random_generated_path()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.article_source = 'random' then
    select draft_random_path
    into new.generated_path
    from public.rooms
    where id = new.room_id;

    if new.generated_path is null or jsonb_array_length(new.generated_path) < 2 then
      raise exception using errcode = '22023', message = 'RANDOM_PATH_REQUIRED';
    end if;
  else
    new.generated_path := null;
  end if;
  return new;
end;
$$;

create trigger games_snapshot_random_generated_path
before insert on public.games
for each row
execute function public.snapshot_random_generated_path();

create or replace function public.set_random_room_path(
  p_room_id uuid,
  p_expected_version bigint,
  p_start_article_key text,
  p_start_article_title text,
  p_target_article_key text,
  p_target_article_title text,
  p_generated_path jsonb,
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
  normalized_start_key text := normalize(trim(p_start_article_key), NFC);
  normalized_start_title text := normalize(trim(p_start_article_title), NFC);
  normalized_target_key text := normalize(trim(p_target_article_key), NFC);
  normalized_target_title text := normalize(trim(p_target_article_title), NFC);
  result jsonb;
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;
  if char_length(normalized_start_key) not between 1 and 300
    or char_length(normalized_start_title) not between 1 and 300
    or char_length(normalized_target_key) not between 1 and 300
    or char_length(normalized_target_title) not between 1 and 300
    or normalized_start_key = normalized_target_key
  then
    raise exception using errcode = '22023', message = 'INVALID_RANDOM_PATH';
  end if;
  if jsonb_typeof(p_generated_path) <> 'array'
    or jsonb_array_length(p_generated_path) < 2
    or p_generated_path -> 0 ->> 'key' <> normalized_start_key
    or p_generated_path -> -1 ->> 'key' <> normalized_target_key
  then
    raise exception using errcode = '22023', message = 'INVALID_RANDOM_PATH';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(caller_id::text || ':' || p_idempotency_key::text, 0)
  );

  request_digest := encode(
    digest(
      jsonb_build_object(
        'roomId', p_room_id,
        'expectedVersion', p_expected_version,
        'startArticleKey', normalized_start_key,
        'targetArticleKey', normalized_target_key,
        'generatedPath', p_generated_path
      )::text,
      'sha256'
    ),
    'hex'
  );

  select * into existing_receipt
  from public.command_receipts
  where auth_user_id = caller_id and idempotency_key = p_idempotency_key;

  if found then
    if existing_receipt.command_type <> 'set_random_room_path'
      or existing_receipt.request_hash <> request_digest
    then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return existing_receipt.response;
  end if;

  select * into target_room
  from public.rooms
  where id = p_room_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ROOM_NOT_FOUND';
  end if;
  if target_room.status <> 'waiting' then
    raise exception using errcode = '55000', message = 'ROOM_NOT_CONFIGURABLE';
  end if;
  if target_room.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'VERSION_CONFLICT';
  end if;
  if target_room.draft_random_generation_count >= 10 then
    raise exception using errcode = '55000', message = 'RANDOM_REROLL_LIMIT';
  end if;
  if not exists (
    select 1 from public.player_identities identity
    where identity.player_id = target_room.host_player_id
      and identity.auth_user_id = caller_id
      and identity.kind = 'web'
      and identity.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'HOST_REQUIRED';
  end if;

  update public.rooms
  set
    draft_start_article_key = normalized_start_key,
    draft_start_article_title = normalized_start_title,
    draft_target_article_key = normalized_target_key,
    draft_target_article_title = normalized_target_title,
    draft_article_source = 'random',
    draft_random_path = p_generated_path,
    draft_random_generation_count = draft_random_generation_count + 1,
    version = version + 1
  where id = p_room_id
  returning * into target_room;

  result := jsonb_build_object(
    'room', jsonb_build_object(
      'id', target_room.id,
      'inviteCode', trim(target_room.invite_code),
      'status', target_room.status,
      'maxPlayers', target_room.max_players,
      'hostPlayerId', target_room.host_player_id,
      'version', target_room.version
    )
  );

  insert into public.command_receipts (
    idempotency_key, auth_user_id, command_type, request_hash, response
  ) values (
    p_idempotency_key, caller_id, 'set_random_room_path', request_digest, result
  );

  return result;
end;
$$;

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
    digest(jsonb_build_object('roomId', p_room_id, 'expectedVersion', p_expected_version)::text, 'sha256'),
    'hex'
  );
  select * into existing_receipt from public.command_receipts
  where auth_user_id = caller_id and idempotency_key = p_idempotency_key;
  if found then
    if existing_receipt.command_type <> 'prepare_next_game'
      or existing_receipt.request_hash <> request_digest
    then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return existing_receipt.response;
  end if;
  select * into target_room from public.rooms where id = p_room_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ROOM_NOT_FOUND';
  end if;
  if target_room.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'VERSION_CONFLICT';
  end if;
  if not exists (
    select 1 from public.player_identities
    where player_id = target_room.host_player_id and auth_user_id = caller_id
      and kind = 'web' and revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'HOST_REQUIRED';
  end if;
  if target_room.status <> 'finished' then
    raise exception using errcode = '55000', message = 'NEXT_GAME_NOT_AVAILABLE';
  end if;

  update public.players set ready_at = null
  where room_id = p_room_id and connection_status <> 'left';
  update public.rooms set
    status = 'waiting',
    current_game_id = null,
    draft_random_path = null,
    draft_random_generation_count = 0,
    version = version + 1
  where id = p_room_id
  returning * into target_room;

  result := jsonb_build_object(
    'roomId', target_room.id,
    'status', target_room.status,
    'roomVersion', target_room.version
  );
  insert into public.command_receipts (
    idempotency_key, auth_user_id, command_type, request_hash, response
  ) values (
    p_idempotency_key, caller_id, 'prepare_next_game', request_digest, result
  );
  return result;
end;
$$;

revoke all on function public.snapshot_random_generated_path() from public, anon, authenticated;
revoke all on function public.set_random_room_path(uuid, bigint, text, text, text, text, jsonb, uuid)
  from public, anon;
grant execute on function public.set_random_room_path(uuid, bigint, text, text, text, text, jsonb, uuid)
  to authenticated;
