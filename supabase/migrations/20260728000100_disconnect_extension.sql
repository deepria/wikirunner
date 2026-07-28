create or replace function public.disconnect_extension(
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
  target_player_id uuid;
  target_room_id uuid;
  target_room_status public.room_status;
  disconnected_at timestamptz;
  result jsonb;
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(caller_id::text, 0));

  request_digest := encode(
    digest(jsonb_build_object('action', 'disconnect_extension')::text, 'sha256'),
    'hex'
  );

  select *
  into existing_receipt
  from public.command_receipts
  where auth_user_id = caller_id
    and idempotency_key = p_idempotency_key;

  if found then
    if existing_receipt.command_type <> 'disconnect_extension'
      or existing_receipt.request_hash <> request_digest
    then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return existing_receipt.response;
  end if;

  select player.id, player.room_id, room.status
  into target_player_id, target_room_id, target_room_status
  from public.player_identities identity
  join public.players player on player.id = identity.player_id
  join public.rooms room on room.id = player.room_id
  where identity.auth_user_id = caller_id
    and identity.kind = 'extension'
    and identity.revoked_at is null
  for update of room, player, identity;

  if not found then
    raise exception using errcode = 'P0002', message = 'EXTENSION_NOT_CONNECTED';
  end if;
  if target_room_status in ('countdown', 'running') then
    raise exception using errcode = '55000', message = 'EXTENSION_DISCONNECT_NOT_ALLOWED';
  end if;

  disconnected_at := now();

  update public.players
  set
    extension_connected_at = null,
    ready_at = null
  where id = target_player_id;

  update public.player_identities
  set revoked_at = disconnected_at
  where auth_user_id = caller_id
    and kind = 'extension'
    and revoked_at is null;

  update public.pairing_codes
  set revoked_at = disconnected_at
  where player_id = target_player_id
    and used_at is null
    and revoked_at is null;

  result := jsonb_build_object(
    'roomId', target_room_id,
    'playerId', target_player_id,
    'disconnectedAt', disconnected_at
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
    'disconnect_extension',
    request_digest,
    result
  );

  return result;
end;
$$;

revoke all on function public.disconnect_extension(uuid) from public, anon;
grant execute on function public.disconnect_extension(uuid) to authenticated;
