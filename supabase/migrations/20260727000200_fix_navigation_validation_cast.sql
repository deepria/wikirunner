do $migration$
declare
  current_body text;
  corrected_body text;
  old_assignment constant text := $old$    event_validation := case
      when event_type_value = 'direct' then 'accepted_with_warning'
      else 'accepted'
    end;$old$;
  new_assignment constant text := $new$    event_validation := (
      case
        when event_type_value = 'direct' then 'accepted_with_warning'
        else 'accepted'
      end
    )::public.event_validation_status;$new$;
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
    raise exception 'submit_navigation_events assignment block was not found';
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
