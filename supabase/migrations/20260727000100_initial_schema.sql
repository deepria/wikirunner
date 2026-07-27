create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create type public.room_status as enum (
  'waiting',
  'countdown',
  'running',
  'finished',
  'closed'
);
create type public.game_status as enum ('countdown', 'running', 'finished', 'cancelled');
create type public.run_status as enum (
  'waiting',
  'running',
  'finished',
  'abandoned',
  'flagged',
  'disqualified'
);
create type public.connection_status as enum ('online', 'offline', 'left');
create type public.identity_kind as enum ('web', 'extension');
create type public.article_source as enum ('host', 'pool', 'random');
create type public.navigation_event_type as enum (
  'link',
  'back',
  'forward',
  'reload',
  'direct',
  'tab_resume'
);
create type public.event_validation_status as enum (
  'accepted',
  'accepted_with_warning',
  'rejected'
);
create type public.violation_status as enum ('clear', 'warned', 'reviewed');
create type public.violation_type as enum (
  'unmatched_navigation',
  'direct_target',
  'search_attempt',
  'external_link',
  'new_tab',
  'wrong_tab',
  'sequence_gap',
  'chain_mismatch',
  'invalid_scope'
);
create type public.violation_severity as enum ('info', 'warning', 'high');
create type public.violation_resolution as enum ('pending', 'accepted', 'disqualified');

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  invite_code char(6) not null,
  host_player_id uuid not null,
  status public.room_status not null default 'waiting',
  max_players smallint not null default 4 check (max_players between 2 and 12),
  current_game_id uuid,
  draft_start_article_key text,
  draft_start_article_title text,
  draft_target_article_key text,
  draft_target_article_title text,
  draft_article_source public.article_source not null default 'host',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  version bigint not null default 1 check (version > 0),
  constraint rooms_invite_code_format check (invite_code ~ '^[A-Z0-9]{6}$'),
  constraint rooms_draft_articles_differ check (
    draft_start_article_key is null
    or draft_target_article_key is null
    or draft_start_article_key <> draft_target_article_key
  ),
  constraint rooms_draft_articles_complete check (
    (
      draft_start_article_key is null
      and draft_start_article_title is null
      and draft_target_article_key is null
      and draft_target_article_title is null
    )
    or (
      draft_start_article_key is not null
      and draft_start_article_title is not null
      and draft_target_article_key is not null
      and draft_target_article_title is not null
    )
  )
);

create unique index rooms_active_invite_code_unique
  on public.rooms (invite_code)
  where status <> 'closed';
create index rooms_expires_at_idx on public.rooms (expires_at);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  nickname extensions.citext not null,
  ready_at timestamptz,
  connection_status public.connection_status not null default 'online',
  extension_connected_at timestamptz,
  last_seen_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  constraint players_nickname_length check (char_length(trim(nickname::text)) between 1 and 20),
  constraint players_nickname_no_control check (nickname::text !~ '[[:cntrl:]]'),
  unique (room_id, nickname)
);
create index players_room_id_idx on public.players (room_id);

alter table public.rooms
  add constraint rooms_host_player_fk
  foreign key (host_player_id)
  references public.players(id)
  deferrable initially deferred;

create table public.player_identities (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  kind public.identity_kind not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (auth_user_id, player_id, kind)
);
create unique index player_identities_active_player_kind_unique
  on public.player_identities (player_id, kind)
  where revoked_at is null;
create unique index player_identities_active_extension_user_unique
  on public.player_identities (auth_user_id)
  where kind = 'extension' and revoked_at is null;
create index player_identities_auth_user_id_idx
  on public.player_identities (auth_user_id)
  where revoked_at is null;

create table public.pairing_codes (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  attempt_count smallint not null default 0 check (attempt_count between 0 and 5),
  created_at timestamptz not null default now(),
  constraint pairing_codes_hash_present check (char_length(code_hash) >= 32)
);
create unique index pairing_codes_code_hash_unique on public.pairing_codes (code_hash);
create index pairing_codes_active_player_idx
  on public.pairing_codes (player_id, expires_at)
  where used_at is null and revoked_at is null;

create table public.games (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_no integer not null check (round_no > 0),
  status public.game_status not null default 'countdown',
  start_article_key text not null,
  start_article_title text not null,
  target_article_key text not null,
  target_article_title text not null,
  article_source public.article_source not null,
  scheduled_at timestamptz not null,
  started_at timestamptz,
  finished_at timestamptz,
  rules_version integer not null default 1 check (rules_version > 0),
  created_at timestamptz not null default now(),
  unique (room_id, round_no),
  constraint games_articles_differ check (start_article_key <> target_article_key),
  constraint games_finish_after_schedule check (
    finished_at is null or finished_at >= scheduled_at
  )
);
create index games_room_id_idx on public.games (room_id);

alter table public.rooms
  add constraint rooms_current_game_fk
  foreign key (current_game_id)
  references public.games(id)
  deferrable initially deferred;

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  status public.run_status not null default 'waiting',
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  move_count integer check (move_count is null or move_count >= 0),
  rank integer check (rank is null or rank > 0),
  last_sequence integer not null default 0 check (last_sequence >= 0),
  last_article_key text,
  last_event_hash text,
  violation_status public.violation_status not null default 'clear',
  version bigint not null default 1 check (version > 0),
  unique (game_id, player_id),
  constraint runs_event_hash_format check (
    last_event_hash is null or last_event_hash ~ '^[a-f0-9]{64}$'
  )
);
create index runs_game_id_idx on public.runs (game_id);
create index runs_player_id_idx on public.runs (player_id);

create table public.navigation_events (
  id uuid primary key default gen_random_uuid(),
  client_event_id uuid not null,
  run_id uuid not null references public.runs(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  event_type public.navigation_event_type not null,
  from_article_key text not null,
  to_article_key text not null,
  counts_as_move boolean not null default false,
  client_observed_at timestamptz not null,
  server_received_at timestamptz not null default now(),
  navigation_meta jsonb not null default '{}'::jsonb,
  previous_hash text,
  event_hash text not null,
  validation_status public.event_validation_status not null,
  unique (run_id, client_event_id),
  unique (run_id, sequence),
  constraint navigation_events_move_type check (
    counts_as_move = false or event_type = 'link'
  ),
  constraint navigation_events_previous_hash_format check (
    previous_hash is null or previous_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint navigation_events_hash_format check (event_hash ~ '^[a-f0-9]{64}$'),
  constraint navigation_events_meta_object check (jsonb_typeof(navigation_meta) = 'object')
);
create index navigation_events_run_received_idx
  on public.navigation_events (run_id, server_received_at);

create table public.violations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  event_id uuid references public.navigation_events(id) on delete set null,
  type public.violation_type not null,
  severity public.violation_severity not null,
  detected_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb,
  resolution public.violation_resolution not null default 'pending',
  resolved_by uuid references public.players(id),
  resolved_at timestamptz,
  resolution_note text,
  constraint violations_detail_object check (jsonb_typeof(detail) = 'object'),
  constraint violations_resolution_complete check (
    (resolution = 'pending' and resolved_by is null and resolved_at is null)
    or (resolution <> 'pending' and resolved_by is not null and resolved_at is not null)
  )
);
create index violations_run_id_idx on public.violations (run_id);

create table public.result_decisions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  revision integer not null check (revision > 0),
  decided_by uuid not null references public.players(id),
  decided_at timestamptz not null default now(),
  leaderboard jsonb not null,
  violation_decisions jsonb not null default '[]'::jsonb,
  unique (game_id, revision),
  constraint result_decisions_leaderboard_array check (jsonb_typeof(leaderboard) = 'array'),
  constraint result_decisions_violations_array check (
    jsonb_typeof(violation_decisions) = 'array'
  )
);

create table public.command_receipts (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  command_type text not null,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  unique (auth_user_id, idempotency_key)
);
create index command_receipts_created_at_idx on public.command_receipts (created_at);

alter table public.rooms replica identity full;
alter table public.players replica identity full;
alter table public.games replica identity full;
alter table public.runs replica identity full;

do $$
declare
  realtime_table text;
begin
  foreach realtime_table in array array['rooms', 'players', 'games', 'runs']
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = realtime_table
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        realtime_table
      );
    end if;
  end loop;
end;
$$;

create or replace function public.is_room_member(check_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.player_identities identity
    join public.players player on player.id = identity.player_id
    where identity.auth_user_id = (select auth.uid())
      and identity.revoked_at is null
      and player.room_id = check_room_id
      and player.connection_status <> 'left'
  );
$$;

create or replace function public.is_room_host(check_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.rooms room
    join public.player_identities identity
      on identity.player_id = room.host_player_id
    where room.id = check_room_id
      and identity.auth_user_id = (select auth.uid())
      and identity.kind = 'web'
      and identity.revoked_at is null
  );
$$;

create or replace function public.generate_invite_code()
returns char(6)
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := gen_random_bytes(6);
  generated text := '';
begin
  for index_value in 0..5 loop
    generated := generated || substr(
      alphabet,
      (get_byte(bytes, index_value) % char_length(alphabet)) + 1,
      1
    );
  end loop;
  return generated::char(6);
end;
$$;

create or replace function public.create_room(
  p_nickname text,
  p_max_players smallint,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  normalized_nickname text := trim(p_nickname);
  request_digest text;
  existing_receipt public.command_receipts%rowtype;
  created_room_id uuid := gen_random_uuid();
  created_player_id uuid := gen_random_uuid();
  created_invite_code char(6);
  result jsonb;
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;
  if char_length(normalized_nickname) not between 1 and 20
    or normalized_nickname ~ '[[:cntrl:]]'
  then
    raise exception using errcode = '22023', message = 'INVALID_NICKNAME';
  end if;
  if p_max_players not between 2 and 12 then
    raise exception using errcode = '22023', message = 'INVALID_MAX_PLAYERS';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(caller_id::text || ':' || p_idempotency_key::text, 0)
  );

  request_digest := encode(
    digest(
      jsonb_build_object(
        'nickname', normalized_nickname,
        'maxPlayers', p_max_players
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
    if existing_receipt.command_type <> 'create_room'
      or existing_receipt.request_hash <> request_digest
    then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return existing_receipt.response;
  end if;

  for attempt in 1..10 loop
    created_invite_code := public.generate_invite_code();
    exit when not exists (
      select 1
      from public.rooms
      where invite_code = created_invite_code
        and status <> 'closed'
    );
  end loop;

  if exists (
    select 1 from public.rooms
    where invite_code = created_invite_code and status <> 'closed'
  ) then
    raise exception using errcode = 'P0001', message = 'ROOM_CODE_EXHAUSTED';
  end if;

  set constraints rooms_host_player_fk deferred;

  insert into public.rooms (
    id,
    invite_code,
    host_player_id,
    max_players
  )
  values (
    created_room_id,
    created_invite_code,
    created_player_id,
    p_max_players
  );

  insert into public.players (id, room_id, nickname)
  values (created_player_id, created_room_id, normalized_nickname);

  insert into public.player_identities (auth_user_id, player_id, kind)
  values (caller_id, created_player_id, 'web');

  result := jsonb_build_object(
    'room', jsonb_build_object(
      'id', created_room_id,
      'inviteCode', trim(created_invite_code),
      'status', 'waiting',
      'maxPlayers', p_max_players,
      'hostPlayerId', created_player_id,
      'version', 1
    ),
    'player', jsonb_build_object(
      'id', created_player_id,
      'nickname', normalized_nickname,
      'connectionStatus', 'online',
      'isHost', true
    )
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
    'create_room',
    request_digest,
    result
  );

  return result;
end;
$$;

create or replace function public.join_room(
  p_invite_code text,
  p_nickname text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  normalized_code text := upper(trim(p_invite_code));
  normalized_nickname text := trim(p_nickname);
  request_digest text;
  existing_receipt public.command_receipts%rowtype;
  target_room public.rooms%rowtype;
  created_player_id uuid := gen_random_uuid();
  result jsonb;
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;
  if normalized_code !~ '^[A-Z0-9]{6}$' then
    raise exception using errcode = '22023', message = 'INVALID_ROOM_CODE';
  end if;
  if char_length(normalized_nickname) not between 1 and 20
    or normalized_nickname ~ '[[:cntrl:]]'
  then
    raise exception using errcode = '22023', message = 'INVALID_NICKNAME';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(caller_id::text || ':' || p_idempotency_key::text, 0)
  );

  request_digest := encode(
    digest(
      jsonb_build_object(
        'inviteCode', normalized_code,
        'nickname', normalized_nickname
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
    if existing_receipt.command_type <> 'join_room'
      or existing_receipt.request_hash <> request_digest
    then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return existing_receipt.response;
  end if;

  select *
  into target_room
  from public.rooms
  where invite_code = normalized_code
    and status <> 'closed'
  for update;

  if not found or target_room.expires_at <= now() then
    raise exception using errcode = 'P0002', message = 'ROOM_NOT_FOUND';
  end if;
  if target_room.status <> 'waiting' then
    raise exception using errcode = '55000', message = 'ROOM_NOT_JOINABLE';
  end if;
  if exists (
    select 1
    from public.player_identities identity
    join public.players player on player.id = identity.player_id
    where identity.auth_user_id = caller_id
      and identity.revoked_at is null
      and player.room_id = target_room.id
      and player.connection_status <> 'left'
  ) then
    raise exception using errcode = '23505', message = 'ALREADY_IN_ROOM';
  end if;
  if (
    select count(*)
    from public.players
    where room_id = target_room.id
      and connection_status <> 'left'
  ) >= target_room.max_players then
    raise exception using errcode = '54000', message = 'ROOM_FULL';
  end if;

  insert into public.players (id, room_id, nickname)
  values (created_player_id, target_room.id, normalized_nickname);

  insert into public.player_identities (auth_user_id, player_id, kind)
  values (caller_id, created_player_id, 'web');

  result := jsonb_build_object(
    'room', jsonb_build_object(
      'id', target_room.id,
      'inviteCode', trim(target_room.invite_code),
      'status', target_room.status,
      'maxPlayers', target_room.max_players,
      'hostPlayerId', target_room.host_player_id,
      'version', target_room.version
    ),
    'player', jsonb_build_object(
      'id', created_player_id,
      'nickname', normalized_nickname,
      'connectionStatus', 'online',
      'isHost', false
    )
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
    'join_room',
    request_digest,
    result
  );

  return result;
end;
$$;

create or replace function public.update_room_settings(
  p_room_id uuid,
  p_expected_version bigint,
  p_max_players smallint,
  p_start_article_key text,
  p_start_article_title text,
  p_target_article_key text,
  p_target_article_title text,
  p_article_source public.article_source,
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
  normalized_start_title text := trim(p_start_article_title);
  normalized_target_key text := normalize(trim(p_target_article_key), NFC);
  normalized_target_title text := trim(p_target_article_title);
  active_player_count integer;
  result jsonb;
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;
  if p_max_players not between 2 and 12 then
    raise exception using errcode = '22023', message = 'INVALID_MAX_PLAYERS';
  end if;
  if char_length(normalized_start_key) not between 1 and 300
    or char_length(normalized_start_title) not between 1 and 300
    or char_length(normalized_target_key) not between 1 and 300
    or char_length(normalized_target_title) not between 1 and 300
  then
    raise exception using errcode = '22023', message = 'INVALID_ARTICLE';
  end if;
  if normalized_start_key = normalized_target_key then
    raise exception using errcode = '22023', message = 'ARTICLES_MUST_DIFFER';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(caller_id::text || ':' || p_idempotency_key::text, 0)
  );

  request_digest := encode(
    digest(
      jsonb_build_object(
        'roomId', p_room_id,
        'expectedVersion', p_expected_version,
        'maxPlayers', p_max_players,
        'startArticleKey', normalized_start_key,
        'startArticleTitle', normalized_start_title,
        'targetArticleKey', normalized_target_key,
        'targetArticleTitle', normalized_target_title,
        'articleSource', p_article_source
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
    if existing_receipt.command_type <> 'update_room_settings'
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
  if target_room.status <> 'waiting' then
    raise exception using errcode = '55000', message = 'ROOM_NOT_CONFIGURABLE';
  end if;
  if target_room.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'VERSION_CONFLICT';
  end if;
  if not exists (
    select 1
    from public.player_identities identity
    where identity.player_id = target_room.host_player_id
      and identity.auth_user_id = caller_id
      and identity.kind = 'web'
      and identity.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'HOST_REQUIRED';
  end if;

  select count(*)
  into active_player_count
  from public.players
  where room_id = p_room_id
    and connection_status <> 'left';

  if active_player_count > p_max_players then
    raise exception using errcode = '22023', message = 'MAX_PLAYERS_BELOW_CURRENT';
  end if;

  update public.rooms
  set
    max_players = p_max_players,
    draft_start_article_key = normalized_start_key,
    draft_start_article_title = normalized_start_title,
    draft_target_article_key = normalized_target_key,
    draft_target_article_title = normalized_target_title,
    draft_article_source = p_article_source,
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
    idempotency_key,
    auth_user_id,
    command_type,
    request_hash,
    response
  )
  values (
    p_idempotency_key,
    caller_id,
    'update_room_settings',
    request_digest,
    result
  );

  return result;
end;
$$;

create or replace function public.issue_pairing_code(
  p_player_id uuid,
  p_code_hash text,
  p_expires_at timestamptz,
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
  created_code_id uuid := gen_random_uuid();
  result jsonb;
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;
  if p_code_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'INVALID_PAIRING_HASH';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '10 minutes' then
    raise exception using errcode = '22023', message = 'INVALID_PAIRING_EXPIRY';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(caller_id::text || ':' || p_idempotency_key::text, 0)
  );

  request_digest := encode(
    digest(
      jsonb_build_object(
        'playerId', p_player_id,
        'codeHash', p_code_hash
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
    if existing_receipt.command_type <> 'issue_pairing_code'
      or existing_receipt.request_hash <> request_digest
    then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return existing_receipt.response;
  end if;

  perform 1
  from public.players player
  join public.rooms room on room.id = player.room_id
  join public.player_identities identity on identity.player_id = player.id
  where player.id = p_player_id
    and room.status = 'waiting'
    and identity.auth_user_id = caller_id
    and identity.kind = 'web'
    and identity.revoked_at is null
  for update of player;

  if not found then
    raise exception using errcode = '42501', message = 'PLAYER_ACCESS_DENIED';
  end if;

  update public.pairing_codes
  set revoked_at = now()
  where player_id = p_player_id
    and used_at is null
    and revoked_at is null;

  insert into public.pairing_codes (
    id,
    player_id,
    code_hash,
    expires_at
  )
  values (
    created_code_id,
    p_player_id,
    p_code_hash,
    p_expires_at
  );

  result := jsonb_build_object(
    'pairingCodeId', created_code_id,
    'playerId', p_player_id,
    'expiresAt', p_expires_at
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
    'issue_pairing_code',
    request_digest,
    result
  );

  return result;
end;
$$;

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

  select *
  into existing_receipt
  from public.command_receipts
  where auth_user_id = caller_id
    and idempotency_key = p_idempotency_key;

  if found then
    if existing_receipt.command_type <> 'redeem_pairing_code'
      or existing_receipt.request_hash <> request_digest
    then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return existing_receipt.response;
  end if;

  select *
  into target_code
  from public.pairing_codes
  where code_hash = p_code_hash
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PAIRING_CODE_INVALID';
  end if;

  select *
  into target_player
  from public.players
  where id = target_code.player_id
  for update;

  if target_code.used_at is not null then
    if exists (
      select 1
      from public.player_identities
      where auth_user_id = caller_id
        and player_id = target_player.id
        and kind = 'extension'
        and revoked_at is null
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
    select 1 from public.rooms
    where id = target_player.room_id and status = 'waiting'
  ) then
    raise exception using errcode = '55000', message = 'ROOM_NOT_JOINABLE';
  end if;

  update public.players
  set extension_connected_at = null
  where id in (
    select player_id
    from public.player_identities
    where auth_user_id = caller_id
      and kind = 'extension'
      and revoked_at is null
  );

  update public.player_identities
  set revoked_at = now()
  where (
    auth_user_id = caller_id
    or player_id = target_player.id
  )
    and kind = 'extension'
    and revoked_at is null;

  insert into public.player_identities (auth_user_id, player_id, kind)
  values (caller_id, target_player.id, 'extension');

  update public.players
  set extension_connected_at = now()
  where id = target_player.id
  returning * into target_player;

  update public.pairing_codes
  set used_at = now()
  where id = target_code.id
  returning * into target_code;

  result := jsonb_build_object(
    'roomId', target_player.room_id,
    'playerId', target_player.id,
    'pairedAt', target_code.used_at
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
    'redeem_pairing_code',
    request_digest,
    result
  );

  return result;
end;
$$;

create or replace function public.set_player_ready(
  p_player_id uuid,
  p_ready boolean,
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
  target_player public.players%rowtype;
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
      jsonb_build_object('playerId', p_player_id, 'ready', p_ready)::text,
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
    if existing_receipt.command_type <> 'set_player_ready'
      or existing_receipt.request_hash <> request_digest
    then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return existing_receipt.response;
  end if;

  select *
  into target_player
  from public.players
  where id = p_player_id
  for update;

  if not found or not exists (
    select 1
    from public.player_identities
    where player_id = p_player_id
      and auth_user_id = caller_id
      and revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'PLAYER_ACCESS_DENIED';
  end if;

  select *
  into target_room
  from public.rooms
  where id = target_player.room_id;

  if target_room.status <> 'waiting' then
    raise exception using errcode = '55000', message = 'ROOM_NOT_READYABLE';
  end if;
  if p_ready and target_player.extension_connected_at is null then
    raise exception using errcode = '55000', message = 'EXTENSION_REQUIRED';
  end if;

  update public.players
  set
    ready_at = case when p_ready then now() else null end,
    connection_status = 'online',
    last_seen_at = now()
  where id = p_player_id
  returning * into target_player;

  result := jsonb_build_object(
    'playerId', target_player.id,
    'readyAt', target_player.ready_at
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
    'set_player_ready',
    request_digest,
    result
  );

  return result;
end;
$$;

create or replace function public.start_room_countdown(
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
  created_game_id uuid := gen_random_uuid();
  created_round_no integer;
  scheduled_time timestamptz := transaction_timestamp() + interval '10 seconds';
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
    if existing_receipt.command_type <> 'start_room_countdown'
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
  if target_room.status <> 'waiting' then
    raise exception using errcode = '55000', message = 'ROOM_NOT_STARTABLE';
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
  if target_room.draft_start_article_key is null
    or target_room.draft_target_article_key is null
  then
    raise exception using errcode = '55000', message = 'ROOM_SETTINGS_REQUIRED';
  end if;
  if exists (
    select 1
    from public.players
    where room_id = p_room_id
      and connection_status <> 'left'
      and (ready_at is null or extension_connected_at is null)
  ) then
    raise exception using errcode = '55000', message = 'PLAYERS_NOT_READY';
  end if;

  select coalesce(max(round_no), 0) + 1
  into created_round_no
  from public.games
  where room_id = p_room_id;

  insert into public.games (
    id,
    room_id,
    round_no,
    status,
    start_article_key,
    start_article_title,
    target_article_key,
    target_article_title,
    article_source,
    scheduled_at
  )
  values (
    created_game_id,
    p_room_id,
    created_round_no,
    'countdown',
    target_room.draft_start_article_key,
    target_room.draft_start_article_title,
    target_room.draft_target_article_key,
    target_room.draft_target_article_title,
    target_room.draft_article_source,
    scheduled_time
  );

  insert into public.runs (
    game_id,
    player_id,
    status,
    started_at,
    last_article_key
  )
  select
    created_game_id,
    id,
    'waiting',
    scheduled_time,
    target_room.draft_start_article_key
  from public.players
  where room_id = p_room_id
    and connection_status <> 'left';

  update public.rooms
  set
    status = 'countdown',
    current_game_id = created_game_id,
    version = version + 1
  where id = p_room_id
  returning * into target_room;

  result := jsonb_build_object(
    'game', jsonb_build_object(
      'id', created_game_id,
      'roomId', p_room_id,
      'status', 'countdown',
      'scheduledAt', scheduled_time,
      'startArticle', jsonb_build_object(
        'key', target_room.draft_start_article_key,
        'title', target_room.draft_start_article_title
      ),
      'targetArticle', jsonb_build_object(
        'key', target_room.draft_target_article_key,
        'title', target_room.draft_target_article_title
      )
    ),
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
    'start_room_countdown',
    request_digest,
    result
  );

  return result;
end;
$$;

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
as $$
declare
  caller_id uuid := auth.uid();
  request_digest text;
  existing_receipt public.command_receipts%rowtype;
  target_run public.runs%rowtype;
  target_game public.games%rowtype;
  event_record jsonb;
  event_id uuid;
  event_client_id uuid;
  event_sequence integer;
  event_type_value public.navigation_event_type;
  event_from_key text;
  event_to_key text;
  event_observed_at timestamptz;
  event_previous_hash text;
  event_hash_value text;
  expected_hash text;
  event_validation public.event_validation_status;
  event_received_at timestamptz;
  event_acknowledgements jsonb := '[]'::jsonb;
  leaderboard_projection jsonb := '[]'::jsonb;
  result jsonb;
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;
  if jsonb_typeof(p_events) <> 'array'
    or jsonb_array_length(p_events) not between 1 and 20
  then
    raise exception using errcode = '22023', message = 'INVALID_EVENTS';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(caller_id::text || ':' || p_idempotency_key::text, 0)
  );

  request_digest := encode(
    digest(
      jsonb_build_object(
        'gameId', p_game_id,
        'runId', p_run_id,
        'events', p_events
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
    if existing_receipt.command_type <> 'submit_navigation_events'
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

  if transaction_timestamp() < target_game.scheduled_at then
    raise exception using errcode = '55000', message = 'GAME_NOT_STARTED';
  end if;
  if target_game.status in ('finished', 'cancelled')
    or target_run.status in ('finished', 'abandoned', 'disqualified')
  then
    raise exception using errcode = '55000', message = 'RUN_NOT_ACTIVE';
  end if;

  update public.games
  set
    status = 'running',
    started_at = coalesce(started_at, scheduled_at)
  where id = p_game_id
    and status = 'countdown';

  update public.rooms
  set
    status = 'running',
    version = version + 1
  where id = target_game.room_id
    and status = 'countdown';

  for event_record in
    select value from jsonb_array_elements(p_events)
  loop
    event_client_id := (event_record ->> 'clientEventId')::uuid;
    event_sequence := (event_record ->> 'sequence')::integer;
    event_type_value := (event_record ->> 'type')::public.navigation_event_type;
    event_from_key := normalize(trim(event_record ->> 'fromArticleKey'), NFC);
    event_to_key := normalize(trim(event_record ->> 'toArticleKey'), NFC);
    event_observed_at := (event_record ->> 'clientObservedAt')::timestamptz;
    event_previous_hash := nullif(event_record ->> 'previousHash', '');
    event_hash_value := event_record ->> 'eventHash';

    if event_sequence <> target_run.last_sequence + 1 then
      raise exception using errcode = '22023', message = 'SEQUENCE_GAP';
    end if;
    if char_length(event_from_key) not between 1 and 300
      or char_length(event_to_key) not between 1 and 300
    then
      raise exception using errcode = '22023', message = 'INVALID_ARTICLE';
    end if;
    if event_from_key is distinct from target_run.last_article_key then
      raise exception using errcode = '22023', message = 'ARTICLE_CHAIN_MISMATCH';
    end if;
    if event_previous_hash is distinct from target_run.last_event_hash then
      raise exception using errcode = '22023', message = 'HASH_CHAIN_MISMATCH';
    end if;
    if event_previous_hash is not null
      and event_previous_hash !~ '^[a-f0-9]{64}$'
    then
      raise exception using errcode = '22023', message = 'INVALID_EVENT_HASH';
    end if;

    expected_hash := encode(
      digest(
        concat_ws(
          E'\n',
          event_sequence::text,
          event_type_value::text,
          event_from_key,
          event_to_key,
          to_char(
            event_observed_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          coalesce(event_previous_hash, '')
        ),
        'sha256'
      ),
      'hex'
    );

    if event_hash_value is distinct from expected_hash then
      raise exception using errcode = '22023', message = 'EVENT_HASH_MISMATCH';
    end if;

    event_id := gen_random_uuid();
    event_received_at := statement_timestamp();
    event_validation := case
      when event_type_value = 'direct' then 'accepted_with_warning'
      else 'accepted'
    end;

    insert into public.navigation_events (
      id,
      client_event_id,
      run_id,
      sequence,
      event_type,
      from_article_key,
      to_article_key,
      counts_as_move,
      client_observed_at,
      server_received_at,
      navigation_meta,
      previous_hash,
      event_hash,
      validation_status
    )
    values (
      event_id,
      event_client_id,
      p_run_id,
      event_sequence,
      event_type_value,
      event_from_key,
      event_to_key,
      event_type_value = 'link',
      event_observed_at,
      event_received_at,
      '{}'::jsonb,
      event_previous_hash,
      event_hash_value,
      event_validation
    );

    if event_type_value = 'direct' then
      insert into public.violations (
        run_id,
        event_id,
        type,
        severity,
        detail
      )
      values (
        p_run_id,
        event_id,
        'unmatched_navigation',
        'warning',
        jsonb_build_object('sequence', event_sequence)
      );

      if event_to_key = target_game.target_article_key then
        insert into public.violations (
          run_id,
          event_id,
          type,
          severity,
          detail
        )
        values (
          p_run_id,
          event_id,
          'direct_target',
          'high',
          jsonb_build_object('sequence', event_sequence)
        );
      end if;
    end if;

    update public.runs
    set
      status = 'running',
      last_sequence = event_sequence,
      last_article_key = event_to_key,
      last_event_hash = event_hash_value,
      violation_status = case
        when event_validation = 'accepted_with_warning' then 'warned'
        else violation_status
      end,
      version = version + 1
    where id = p_run_id
    returning * into target_run;

    event_acknowledgements := event_acknowledgements || jsonb_build_array(
      jsonb_build_object(
        'clientEventId', event_client_id,
        'sequence', event_sequence,
        'validationStatus', event_validation,
        'serverReceivedAt', event_received_at
      )
    );
  end loop;

  update public.players
  set
    connection_status = 'online',
    last_seen_at = now()
  where id = target_run.player_id;

  if target_run.last_article_key = target_game.target_article_key then
    update public.runs
    set
      status = 'finished',
      finished_at = statement_timestamp(),
      duration_ms = greatest(
        0,
        floor(
          extract(epoch from (statement_timestamp() - target_game.scheduled_at)) * 1000
        )::bigint
      ),
      move_count = (
        select count(*)::integer
        from public.navigation_events navigation_event
        where navigation_event.run_id = p_run_id
          and navigation_event.counts_as_move
          and navigation_event.validation_status in ('accepted', 'accepted_with_warning')
      ),
      version = version + 1
    where id = p_run_id
      and finished_at is null
    returning * into target_run;

    with ranked as (
      select
        id,
        row_number() over (
          order by duration_ms, move_count, finished_at, id
        )::integer as calculated_rank
      from public.runs
      where game_id = p_game_id
        and status = 'finished'
    )
    update public.runs run
    set rank = ranked.calculated_rank
    from ranked
    where run.id = ranked.id;

    select *
    into target_run
    from public.runs
    where id = p_run_id;
  end if;

  if not exists (
    select 1
    from public.runs
    where game_id = p_game_id
      and status not in ('finished', 'abandoned', 'disqualified')
  ) then
    update public.games
    set
      status = 'finished',
      finished_at = statement_timestamp()
    where id = p_game_id
      and status = 'running';

    update public.rooms
    set
      status = 'finished',
      version = version + 1
    where id = target_game.room_id
      and status = 'running';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', run.id,
        'playerId', run.player_id,
        'nickname', player.nickname::text,
        'status', run.status,
        'durationMs', run.duration_ms,
        'moveCount', run.move_count,
        'rank', run.rank,
        'lastSequence', run.last_sequence,
        'lastArticleKey', run.last_article_key,
        'lastEventHash', case
          when run.id = p_run_id then run.last_event_hash
          else null
        end,
        'violationStatus', run.violation_status,
        'isCurrentPlayer', run.id = p_run_id
      )
      order by run.rank nulls last, run.finished_at nulls last, run.id
    ),
    '[]'::jsonb
  )
  into leaderboard_projection
  from public.runs run
  join public.players player on player.id = run.player_id
  where run.game_id = p_game_id;

  result := jsonb_build_object(
    'events', event_acknowledgements,
    'run', jsonb_build_object(
      'id', target_run.id,
      'playerId', target_run.player_id,
      'status', target_run.status,
      'durationMs', target_run.duration_ms,
      'moveCount', target_run.move_count,
      'rank', target_run.rank,
      'lastSequence', target_run.last_sequence,
      'lastArticleKey', target_run.last_article_key,
      'lastEventHash', target_run.last_event_hash,
      'violationStatus', target_run.violation_status
    ),
    'leaderboard', leaderboard_projection
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
    'submit_navigation_events',
    request_digest,
    result
  );

  return result;
end;
$$;

alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.player_identities enable row level security;
alter table public.pairing_codes enable row level security;
alter table public.games enable row level security;
alter table public.runs enable row level security;
alter table public.navigation_events enable row level security;
alter table public.violations enable row level security;
alter table public.result_decisions enable row level security;
alter table public.command_receipts enable row level security;

create policy rooms_member_select
  on public.rooms for select to authenticated
  using ((select public.is_room_member(id)));

create policy players_room_member_select
  on public.players for select to authenticated
  using ((select public.is_room_member(room_id)));

create policy identities_self_select
  on public.player_identities for select to authenticated
  using (auth_user_id = (select auth.uid()) and revoked_at is null);

create policy games_room_member_select
  on public.games for select to authenticated
  using ((select public.is_room_member(room_id)));

create policy runs_room_member_select
  on public.runs for select to authenticated
  using (
    exists (
      select 1
      from public.games game
      where game.id = runs.game_id
        and (select public.is_room_member(game.room_id))
    )
  );

create policy navigation_events_owner_or_host_select
  on public.navigation_events for select to authenticated
  using (
    exists (
      select 1
      from public.runs run
      join public.players player on player.id = run.player_id
      join public.player_identities identity on identity.player_id = player.id
      where run.id = navigation_events.run_id
        and identity.auth_user_id = (select auth.uid())
        and identity.revoked_at is null
    )
    or exists (
      select 1
      from public.runs run
      join public.games game on game.id = run.game_id
      where run.id = navigation_events.run_id
        and (select public.is_room_host(game.room_id))
    )
  );

create policy violations_owner_or_host_select
  on public.violations for select to authenticated
  using (
    exists (
      select 1
      from public.runs run
      join public.players player on player.id = run.player_id
      join public.player_identities identity on identity.player_id = player.id
      where run.id = violations.run_id
        and identity.auth_user_id = (select auth.uid())
        and identity.revoked_at is null
    )
    or exists (
      select 1
      from public.runs run
      join public.games game on game.id = run.game_id
      where run.id = violations.run_id
        and (select public.is_room_host(game.room_id))
    )
  );

create policy result_decisions_room_member_select
  on public.result_decisions for select to authenticated
  using (
    exists (
      select 1
      from public.games game
      where game.id = result_decisions.game_id
        and (select public.is_room_member(game.room_id))
    )
  );

create policy command_receipts_owner_select
  on public.command_receipts for select to authenticated
  using (auth_user_id = (select auth.uid()));

revoke all on table
  public.rooms,
  public.players,
  public.player_identities,
  public.pairing_codes,
  public.games,
  public.runs,
  public.navigation_events,
  public.violations,
  public.result_decisions,
  public.command_receipts
from anon;

revoke insert, update, delete on table
  public.rooms,
  public.players,
  public.player_identities,
  public.pairing_codes,
  public.games,
  public.runs,
  public.navigation_events,
  public.violations,
  public.result_decisions,
  public.command_receipts
from authenticated;

grant select on public.rooms to authenticated;
grant select on public.players to authenticated;
grant select on public.player_identities to authenticated;
grant select on public.games to authenticated;
grant select on public.runs to authenticated;
grant select on public.navigation_events to authenticated;
grant select on public.violations to authenticated;
grant select on public.result_decisions to authenticated;
grant select on public.command_receipts to authenticated;

revoke all on function public.generate_invite_code() from public, anon, authenticated;
revoke all on function public.is_room_member(uuid) from public, anon;
revoke all on function public.is_room_host(uuid) from public, anon;
revoke all on function public.create_room(text, smallint, uuid) from public, anon;
revoke all on function public.join_room(text, text, uuid) from public, anon;
revoke all on function public.update_room_settings(
  uuid,
  bigint,
  smallint,
  text,
  text,
  text,
  text,
  public.article_source,
  uuid
) from public, anon;
revoke all on function public.issue_pairing_code(uuid, text, timestamptz, uuid)
  from public, anon;
revoke all on function public.redeem_pairing_code(text, uuid) from public, anon;
revoke all on function public.set_player_ready(uuid, boolean, uuid) from public, anon;
revoke all on function public.start_room_countdown(uuid, bigint, uuid) from public, anon;
revoke all on function public.submit_navigation_events(uuid, uuid, jsonb, uuid)
  from public, anon;

grant execute on function public.is_room_member(uuid) to authenticated;
grant execute on function public.is_room_host(uuid) to authenticated;
grant execute on function public.create_room(text, smallint, uuid) to authenticated;
grant execute on function public.join_room(text, text, uuid) to authenticated;
grant execute on function public.update_room_settings(
  uuid,
  bigint,
  smallint,
  text,
  text,
  text,
  text,
  public.article_source,
  uuid
) to authenticated;
grant execute on function public.issue_pairing_code(uuid, text, timestamptz, uuid)
  to authenticated;
grant execute on function public.redeem_pairing_code(text, uuid) to authenticated;
grant execute on function public.set_player_ready(uuid, boolean, uuid) to authenticated;
grant execute on function public.start_room_countdown(uuid, bigint, uuid) to authenticated;
grant execute on function public.submit_navigation_events(uuid, uuid, jsonb, uuid)
  to authenticated;
