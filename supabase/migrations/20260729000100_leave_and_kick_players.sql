create or replace function public.leave_or_kick_player(
  p_player_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target public.players%rowtype;
  room public.rooms%rowtype;
  actor uuid;
begin
  select player_id into actor from public.player_identities
  where auth_user_id = auth.uid() and kind = 'web' and revoked_at is null;
  if actor is null then raise exception 'PLAYER_ACCESS_DENIED'; end if;
  select * into target from public.players where id = p_player_id for update;
  if not found then raise exception 'PLAYER_ACCESS_DENIED'; end if;
  select * into room from public.rooms where id = target.room_id for update;
  if room.status <> 'waiting' then raise exception 'ROOM_NOT_LEAVABLE'; end if;
  if actor <> target.id and actor <> room.host_player_id then raise exception 'PLAYER_ACCESS_DENIED'; end if;
  if target.id = room.host_player_id then raise exception 'HOST_CANNOT_LEAVE'; end if;
  update public.players set connection_status = 'left', ready_at = null where id = target.id;
  update public.player_identities set revoked_at = now()
  where player_id = target.id and revoked_at is null;
  update public.rooms set version = version + 1 where id = room.id;
  return jsonb_build_object('playerId', target.id, 'status', 'left');
end;
$$;
