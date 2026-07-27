do $migration$
declare
  current_body text;
  corrected_body text;
  old_update constant text := $old$    update public.games
    set
      status = 'finished',
      finished_at = coalesce(finished_at, abandoned_time)
    where id = p_game_id;$old$;
  new_update constant text := $new$    update public.games
    set
      status = case
        when status = 'countdown' then 'cancelled'
        else 'finished'
      end,
      finished_at = case
        when status = 'countdown' then null
        else coalesce(finished_at, abandoned_time)
      end
    where id = p_game_id;$new$;
begin
  select procedure.prosrc
  into current_body
  from pg_proc procedure
  where procedure.oid = 'public.abandon_run(uuid,uuid,uuid)'::regprocedure;

  if current_body is null then
    raise exception 'abandon_run function was not found';
  end if;

  corrected_body := replace(current_body, old_update, new_update);

  execute format(
    $definition$
      create or replace function public.abandon_run(
        p_game_id uuid,
        p_run_id uuid,
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
