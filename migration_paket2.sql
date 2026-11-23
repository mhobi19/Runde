-- Runde Paket 2: Limits frei einstellbar (auch "kein Limit")
-- Einmal im Supabase SQL-Editor ausfuehren. Darf mehrfach laufen.

do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.groups'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) ilike '%daily_limit%' or pg_get_constraintdef(oid) ilike '%alcohol_limit_g%')
  loop
    execute format('alter table public.groups drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.groups alter column daily_limit drop not null;
alter table public.groups alter column alcohol_limit_g drop not null;
alter table public.groups add constraint groups_daily_limit_check check (daily_limit is null or daily_limit > 0);
alter table public.groups add constraint groups_alcohol_limit_g_check check (alcohol_limit_g is null or alcohol_limit_g > 0);

create or replace function public.set_limits(p_group uuid, p_points numeric, p_grams numeric)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;
  if not exists (
    select 1 from public.group_members
    where group_id = p_group and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Nur Admins dürfen die Limits ändern';
  end if;
  if p_points is not null and (p_points <= 0 or p_points > 100000) then
    raise exception 'Punkte-Limit: eine Zahl größer 0 oder leer für kein Limit';
  end if;
  if p_grams is not null and (p_grams <= 0 or p_grams > 100000) then
    raise exception 'Alkohol-Obergrenze: eine Zahl größer 0 oder leer für kein Limit';
  end if;
  update public.groups
  set daily_limit = p_points, alcohol_limit_g = p_grams
  where id = p_group;
end;
$$;

create or replace function public.log_drink(
  p_group uuid,
  p_category text,
  p_name text,
  p_abv numeric,
  p_volume_ml integer,
  p_party_day date,
  p_photo_path text,
  p_lat double precision default null,
  p_lng double precision default null
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
  v_today date := (now() at time zone 'utc')::date;
begin
  if v_uid is null then
    raise exception 'Nicht angemeldet';
  end if;
  if not public.is_member(p_group) then
    raise exception 'Du bist nicht in dieser Gruppe';
  end if;
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
    points_raw, points, party_day, photo_path, lat, lng
  ) values (
    p_group, v_uid, p_category, v_name, v_abv, p_volume_ml, v_g,
    v_raw, v_award, p_party_day, p_photo_path, p_lat, p_lng
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

-- ---------------------------------------------------------------------
-- Paket 2b: Admin-Rechte (Rauswerfen, Gruppe löschen, Austreten, neuer Code)
-- Nur der Admin darf das. Geprüft wird auf dem Server, nicht in der App.
-- ---------------------------------------------------------------------

create or replace function public.is_admin_txt(gid text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_members
    where group_id::text = gid and user_id = auth.uid() and role = 'admin'
  );
$$;

drop policy if exists members_delete_self on public.group_members;
revoke delete on public.group_members from authenticated;

drop policy if exists runde_photos_delete on storage.objects;
create policy runde_photos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'drink-photos'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or public.is_admin_txt((storage.foldername(name))[1])
    )
  );

create or replace function public.kick_member(p_group uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;
  if not exists (
    select 1 from public.group_members
    where group_id = p_group and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Nur der Admin darf Mitglieder entfernen';
  end if;
  if p_user = auth.uid() then
    raise exception 'Du kannst dich nicht selbst entfernen. Lösche stattdessen die Gruppe.';
  end if;
  if not exists (select 1 from public.group_members where group_id = p_group and user_id = p_user) then
    raise exception 'Diese Person ist nicht in der Gruppe';
  end if;
  delete from public.drinks where group_id = p_group and user_id = p_user;
  delete from public.group_members where group_id = p_group and user_id = p_user;
end;
$$;

create or replace function public.leave_group(p_group uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;
  select role into v_role from public.group_members
  where group_id = p_group and user_id = auth.uid();
  if v_role is null then
    raise exception 'Du bist nicht in dieser Gruppe';
  end if;
  if v_role = 'admin' then
    raise exception 'Der Admin kann nicht austreten. Lösche die Gruppe, wenn sie nicht mehr gebraucht wird.';
  end if;
  delete from public.drinks where group_id = p_group and user_id = auth.uid();
  delete from public.group_members where group_id = p_group and user_id = auth.uid();
end;
$$;

create or replace function public.delete_group(p_group uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;
  if not exists (
    select 1 from public.group_members
    where group_id = p_group and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Nur der Admin darf die Gruppe löschen';
  end if;
  delete from public.groups where id = p_group;
end;
$$;

create or replace function public.reset_invite_code(p_group uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;
  if not exists (
    select 1 from public.group_members
    where group_id = p_group and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Nur der Admin darf den Code erneuern';
  end if;
  v_code := public.make_invite_code();
  update public.groups set invite_code = v_code where id = p_group;
  return v_code;
end;
$$;

revoke all on function public.kick_member(uuid, uuid) from public, anon;
revoke all on function public.leave_group(uuid) from public, anon;
revoke all on function public.delete_group(uuid) from public, anon;
revoke all on function public.reset_invite_code(uuid) from public, anon;
revoke all on function public.is_admin_txt(text) from public, anon;
grant execute on function public.kick_member(uuid, uuid) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.delete_group(uuid) to authenticated;
grant execute on function public.reset_invite_code(uuid) to authenticated;
grant execute on function public.is_admin_txt(text) to authenticated;

-- Neue Kategorie Radler: 0,5 l Radler (2,5 %) = 0,1 Punkte
insert into public.categories (key, label, ref_ml) values ('radler', 'Radler', 2500)
on conflict (key) do update set label = excluded.label, ref_ml = excluded.ref_ml;
