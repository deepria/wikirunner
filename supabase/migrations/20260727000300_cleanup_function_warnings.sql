do $migration$
declare
  function_body text;
  corrected_body text;
begin
  select procedure.prosrc
  into function_body
  from pg_proc procedure
  where procedure.oid = 'public.generate_invite_code()'::regprocedure;

  corrected_body := replace(function_body, E'  index_value integer;\n', '');

  execute format(
    $definition$
      create or replace function public.generate_invite_code()
      returns char(6)
      language plpgsql
      volatile
      security definer
      set search_path = public, extensions, pg_temp
      as %L
    $definition$,
    corrected_body
  );

  select procedure.prosrc
  into function_body
  from pg_proc procedure
  where procedure.oid = 'public.create_room(text,smallint,uuid)'::regprocedure;

  corrected_body := replace(function_body, E'  attempt integer;\n', '');

  execute format(
    $definition$
      create or replace function public.create_room(
        p_nickname text,
        p_max_players smallint,
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

  select procedure.prosrc
  into function_body
  from pg_proc procedure
  where procedure.oid =
    'public.issue_pairing_code(uuid,text,timestamptz,uuid)'::regprocedure;

  corrected_body := replace(
    function_body,
    E'  target_player public.players%rowtype;\n',
    ''
  );
  corrected_body := replace(
    corrected_body,
    E'  select player.*\n  into target_player\n  from public.players player',
    E'  perform 1\n  from public.players player'
  );

  execute format(
    $definition$
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
      as %L
    $definition$,
    corrected_body
  );
end;
$migration$;
