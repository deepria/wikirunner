do $migration$
declare
  current_body text;
  corrected_body text;
  old_assignment constant text := $old$      status = case
        when status = 'countdown' then 'cancelled'
        else 'finished'
      end,$old$;
  new_assignment constant text := $new$      status = (
        case
          when status = 'countdown' then 'cancelled'
          else 'finished'
        end
      )::public.game_status,$new$;
begin
  select procedure.prosrc
  into current_body
  from pg_proc procedure
  where procedure.oid = 'public.abandon_run(uuid,uuid,uuid)'::regprocedure;

  if current_body is null then
    raise exception 'abandon_run function was not found';
  end if;

  corrected_body := replace(current_body, old_assignment, new_assignment);
  if corrected_body = current_body
    and position(new_assignment in current_body) = 0
  then
    raise exception 'abandon_run status assignment was not found';
  end if;

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
