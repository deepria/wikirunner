-- A disconnected extension identity remains as an audit record. Reusing the
-- same anonymous extension session must reactivate that record instead of
-- inserting a duplicate (auth_user_id, player_id, kind) tuple.
create or replace function public.redeem_pairing_code(
  p_code_hash text,
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
  target_code public.pairing_codes%rowtype;
  target_player public.players%rowtype;
  result jsonb;
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;
  if p_code_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'INVALID_PAIRING_CODE';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(caller_id::text || ':' || p_idempotency_key::text, 0)
  );
  request_digest := encode(digest(p_code_hash, 'sha256'), 'hex');

  select * into existing_receipt
  from public.command_receipts
  where auth_user_id = caller_id and idempotency_key = p_idempotency_key;
  if found then
    if existing_receipt.command_type <> 'redeem_pairing_code'
      or existing_receipt.request_hash <> request_digest then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return existing_receipt.response;
  end if;

  select * into target_code from public.pairing_codes where code_hash = p_code_hash for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PAIRING_CODE_INVALID';
  end if;
  select * into target_player from public.players where id = target_code.player_id for update;

  if target_code.used_at is not null then
    if exists (
      select 1 from public.player_identities
      where auth_user_id = caller_id and player_id = target_player.id
        and kind = 'extension' and revoked_at is null
    ) then
      return jsonb_build_object(
        'roomId', target_player.room_id,
        'playerId', target_player.id,
        'pairedAt', target_code.used_at
      );
    end if;
    raise exception using errcode = '55000', message = 'PAIRING_CODE_USED';
  end if;
  if target_code.revoked_at is not null or target_code.expires_at <= now() then
    raise exception using errcode = '55000', message = 'PAIRING_CODE_EXPIRED';
  end if;
  if not exists (
    select 1 from public.rooms where id = target_player.room_id and status = 'waiting'
  ) then
    raise exception using errcode = '55000', message = 'ROOM_NOT_JOINABLE';
  end if;

  update public.players set extension_connected_at = null
  where id in (
    select player_id from public.player_identities
    where auth_user_id = caller_id and kind = 'extension' and revoked_at is null
  );

  update public.player_identities
  set revoked_at = now()
  where (auth_user_id = caller_id or player_id = target_player.id)
    and kind = 'extension' and revoked_at is null;

  -- The table deliberately retains revoked identities. Restore a matching
  -- record when it exists, otherwise create the first identity for this pair.
  update public.player_identities
  set revoked_at = null, created_at = now()
  where auth_user_id = caller_id
    and player_id = target_player.id
    and kind = 'extension'
    and revoked_at is not null;

  if not found then
    insert into public.player_identities (auth_user_id, player_id, kind)
    values (caller_id, target_player.id, 'extension');
  end if;

  update public.players set extension_connected_at = now()
  where id = target_player.id returning * into target_player;
  update public.pairing_codes set used_at = now()
  where id = target_code.id returning * into target_code;

  result := jsonb_build_object(
    'roomId', target_player.room_id,
    'playerId', target_player.id,
    'pairedAt', target_code.used_at
  );
  insert into public.command_receipts (
    idempotency_key, auth_user_id, command_type, request_hash, response
  ) values (
    p_idempotency_key, caller_id, 'redeem_pairing_code', request_digest, result
  );
  return result;
end;
$$;
