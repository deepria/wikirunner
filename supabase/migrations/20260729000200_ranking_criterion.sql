create type public.ranking_criterion as enum ('moves', 'time');

alter table public.rooms
  add column draft_ranking_criterion public.ranking_criterion not null default 'time';

alter table public.games
  add column ranking_criterion public.ranking_criterion not null default 'time';

alter function public.update_room_settings(uuid, bigint, smallint, text, text, text, text, public.article_source, uuid)
  rename to update_room_settings_base;

create or replace function public.update_room_settings(
  p_room_id uuid, p_expected_version bigint, p_max_players smallint,
  p_start_article_key text, p_start_article_title text,
  p_target_article_key text, p_target_article_title text,
  p_article_source public.article_source, p_idempotency_key uuid,
  p_ranking_criterion public.ranking_criterion default 'time'
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
  result := public.update_room_settings_base(p_room_id, p_expected_version, p_max_players,
    p_start_article_key, p_start_article_title, p_target_article_key, p_target_article_title,
    p_article_source, p_idempotency_key);
  update public.rooms set draft_ranking_criterion = p_ranking_criterion
  where id = p_room_id and status = 'waiting';
  return result || jsonb_build_object('rankingCriterion', p_ranking_criterion);
end;
$$;

create or replace function public.copy_room_ranking_criterion()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select draft_ranking_criterion into new.ranking_criterion from public.rooms where id = new.room_id;
  return new;
end;
$$;

create trigger games_copy_room_ranking_criterion
before insert on public.games for each row execute function public.copy_room_ranking_criterion();

create or replace function public.rank_finished_runs(p_game_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare criterion public.ranking_criterion;
begin
  select ranking_criterion into criterion from public.games where id = p_game_id;
  with ranked as (
    select id, row_number() over (
      order by
        case when criterion = 'moves' then move_count end nulls last,
        case when criterion = 'moves' then duration_ms end nulls last,
        case when criterion = 'time' then duration_ms end nulls last,
        case when criterion = 'time' then move_count end nulls last,
        finished_at, id
    )::integer as calculated_rank
    from public.runs where game_id = p_game_id and status = 'finished'
  ) update public.runs run set rank = ranked.calculated_rank from ranked where run.id = ranked.id;
end;
$$;

create or replace function public.refresh_game_ranking()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'finished' and old.status is distinct from 'finished' then
    perform public.rank_finished_runs(new.game_id);
  end if;
  return new;
end;
$$;

create trigger runs_refresh_game_ranking
after update of status on public.runs
for each row execute function public.refresh_game_ranking();
