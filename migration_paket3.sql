-- Paket 3: Offline-Warteschlange. log_drink bekommt die Aufnahmezeit (p_taken_at) und erkennt doppelte Uploads.
drop function if exists public.log_drink(uuid, text, text, numeric, integer, date, text, double precision, double precision);

create or replace function public.log_drink(
  p_group uuid,
  p_category text,
  p_name text,
  p_abv numeric,
  p_volume_ml integer,
  p_party_day date,
  p_photo_path text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_taken_at timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_group public.groups%rowtype;
  v_ref integer;
  v_name text := btrim(coalesce(p_name, ''));
  v_abv numeric;
  v_raw numeric;
  v_g numeric;
  v_used_p numeric;
  v_used_g numeric;
  v_rem_p numeric;
  v_rem_g numeric;
  v_by_g numeric;
  v_award numeric;
  v_reason text := null;
  v_id uuid;
  v_created timestamptz := now();
  v_today date;
  v_dup record;
begin
  if v_uid is null then
    raise exception 'Nicht angemeldet';
  end if;
  if not public.is_member(p_group) then
    raise exception 'Du bist nicht in dieser Gruppe';
  end if;
  if p_taken_at is not null and p_taken_at > now() - interval '48 hours' and p_taken_at <= now() + interval '5 minutes' then
    v_created := least(p_taken_at, now());
  end if;
  v_today := (v_created at time zone 'utc')::date;
  select * into v_group from public.groups where id = p_group;
  select ref_ml into v_ref from public.categories where key = p_category;
  if v_ref is null then
    raise exception 'Unbekannte Kategorie';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'Name des Getränks ungültig';
  end if;
  if p_abv is null or p_abv < 0.5 or p_abv > 96 then
    raise exception 'Alkoholgehalt ungültig';
  end if;
  if p_volume_ml is null or p_volume_ml < 10 or p_volume_ml > 2000 then
    raise exception 'Menge ungültig';
  end if;
  if p_party_day is null or p_party_day < v_today - 1 or p_party_day > v_today + 1 then
    raise exception 'Datum ungültig';
  end if;
  if p_photo_path is null or p_photo_path not like (p_group::text || '/' || v_uid::text || '/%') then
    raise exception 'Foto fehlt oder ist ungültig';
  end if;
  select id, points, points_raw into v_dup from public.drinks
  where user_id = v_uid and photo_path = p_photo_path;
  if found then
    return jsonb_build_object(
      'id', v_dup.id, 'points', v_dup.points, 'points_raw', v_dup.points_raw,
      'capped', v_dup.points < v_dup.points_raw, 'reason', null, 'duplicate', true
    );
  end if;
  if (p_lat is null) <> (p_lng is null) then
    raise exception 'Standort ungültig';
  end if;
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180) then
    raise exception 'Standort ungültig';
  end if;

  v_abv := round(p_abv, 1);
  v_raw := round(v_abv * p_volume_ml / (5 * v_ref), 1);
  v_g := round(p_volume_ml * v_abv / 100 * 0.789, 3);

  perform pg_advisory_xact_lock(hashtext(v_uid::text || p_group::text || p_party_day::text));

  select coalesce(sum(points), 0), coalesce(sum(alcohol_g), 0)
  into v_used_p, v_used_g
  from public.drinks
  where group_id = p_group and user_id = v_uid and party_day = p_party_day;

  v_rem_p := case when v_group.daily_limit is null then null else greatest(0, v_group.daily_limit - v_used_p) end;
  v_rem_g := case when v_group.alcohol_limit_g is null then null else greatest(0, v_group.alcohol_limit_g - v_used_g) end;
  v_by_g := case when v_rem_g is null then null else v_raw * v_rem_g / v_g end;
  v_award := trunc(least(v_raw, v_rem_p, v_by_g), 1);

  if v_award < v_raw then
    if v_by_g is not null and (v_rem_p is null or v_by_g <= v_rem_p) then
      v_reason := 'alkohol';
    else
      v_reason := 'punkte';
    end if;
  end if;

  insert into public.drinks (
    group_id, user_id, category, name, abv, volume_ml, alcohol_g,
    points_raw, points, party_day, photo_path, lat, lng, created_at
  ) values (
    p_group, v_uid, p_category, v_name, v_abv, p_volume_ml, v_g,
    v_raw, v_award, p_party_day, p_photo_path, p_lat, p_lng, v_created
  )
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'points', v_award,
    'points_raw', v_raw,
    'capped', v_award < v_raw,
    'reason', v_reason
  );
end;
$$;


revoke all on function public.log_drink(uuid, text, text, numeric, integer, date, text, double precision, double precision, timestamptz) from public, anon;
grant execute on function public.log_drink(uuid, text, text, numeric, integer, date, text, double precision, double precision, timestamptz) to authenticated;

notify pgrst, 'reload schema';
