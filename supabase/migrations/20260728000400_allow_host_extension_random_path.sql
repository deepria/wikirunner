do $migration$
declare
  current_body text;
  corrected_body text;
begin
  select procedure.prosrc
  into current_body
  from pg_proc procedure
  where procedure.oid =
    'public.set_random_room_path(uuid,bigint,text,text,text,text,jsonb,uuid)'::regprocedure;

  if current_body is null then
    raise exception 'set_random_room_path function was not found';
  end if;

  corrected_body := replace(
    current_body,
    $old$and identity.kind = 'web'$old$,
    $new$and identity.kind in ('web', 'extension')$new$
  );
  if corrected_body = current_body then
    raise exception 'host identity rule was not found';
  end if;

  execute format(
    $definition$
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
      as %L
    $definition$,
    corrected_body
  );
end;
$migration$;
