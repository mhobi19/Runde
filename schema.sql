-- =====================================================================
-- Runde – Datenbank-Setup für Supabase
-- Einmal im Supabase SQL-Editor ausführen (New query -> einfügen -> Run).
-- Das Skript darf mehrfach laufen, ohne etwas kaputt zu machen.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tabellen
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 24),
  created_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 40),
  invite_code text not null unique,
  daily_limit numeric default 15 check (daily_limit is null or daily_limit > 0),
  alcohol_limit_g numeric default 100 check (alcohol_limit_g is null or alcohol_limit_g > 0),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.categories (
  key text primary key,
  label text not null,
  ref_ml integer not null check (ref_ml > 0)
);

insert into public.categories (key, label, ref_ml) values
  ('bier', 'Bier', 500),
  ('wein', 'Wein', 200),
  ('sekt', 'Sekt', 100),
  ('spirituose', 'Spirituose', 40),
  ('cocktail', 'Cocktail', 300)
on conflict (key) do update set label = excluded.label, ref_ml = excluded.ref_ml;

create table if not exists public.drinks (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  category text not null references public.categories (key),
  name text not null check (char_length(name) between 1 and 40),
  abv numeric(4, 1) not null check (abv >= 0.5 and abv <= 96),
  volume_ml integer not null check (volume_ml between 10 and 2000),
  alcohol_g numeric(8, 3) not null check (alcohol_g > 0),
  points_raw numeric(6, 1) not null check (points_raw >= 0),
  points numeric(6, 1) not null check (points >= 0),
  party_day date not null,
  photo_path text not null,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  created_at timestamptz not null default now()
);

create index if not exists drinks_group_day_idx on public.drinks (group_id, party_day);
create index if not exists drinks_group_created_idx on public.drinks (group_id, created_at desc);
create index if not exists drinks_user_day_idx on public.drinks (user_id, party_day);

create table if not exists public.drink_flags (
  drink_id uuid not null references public.drinks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (drink_id, user_id)
);

-- ---------------------------------------------------------------------
-- 2. Hilfsfunktionen für die Zugriffsregeln
-- ---------------------------------------------------------------------

create or replace function public.is_member(gid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid()
  );
$$;

create or replace function public.is_member_txt(gid text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_members
    where group_id::text = gid and user_id = auth.uid()
  );
$$;

create or replace function public.shares_group_with(uid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.group_members a
    join public.group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = uid
  );
$$;

create or replace function public.is_member_drink(did uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.drinks d
    join public.group_members m on m.group_id = d.group_id
    where d.id = did and m.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------
-- 3. Profil automatisch beim Registrieren anlegen
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  v_name := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1), ''));
  if char_length(v_name) < 2 then
    v_name := 'Gast ' || substr(new.id::text, 1, 4);
  end if;
  v_name := left(v_name, 24);
  insert into public.profiles (id, display_name) values (new.id, v_name)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 4. Zugriffsregeln (Row Level Security)
--    Gelesen wird nur innerhalb der eigenen Gruppen.
--    Geschrieben wird ausschließlich über die Funktionen weiter unten.
-- ---------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.categories enable row level security;
alter table public.drinks enable row level security;
alter table public.drink_flags enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_group_with(id));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select to authenticated
  using (public.is_member(id));

drop policy if exists members_select on public.group_members;
create policy members_select on public.group_members for select to authenticated
  using (public.is_member(group_id));

drop policy if exists members_delete_self on public.group_members;
create policy members_delete_self on public.group_members for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories for select to authenticated
  using (true);

drop policy if exists drinks_select on public.drinks;
create policy drinks_select on public.drinks for select to authenticated
  using (public.is_member(group_id));

drop policy if exists flags_select on public.drink_flags;
create policy flags_select on public.drink_flags for select to authenticated
  using (public.is_member_drink(drink_id));

-- ---------------------------------------------------------------------
-- 5. Funktionen, die die App aufruft
-- ---------------------------------------------------------------------

create or replace function public.make_invite_code()
returns text
language plpgsql as $$
declare
  v_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  i int;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    end loop;
    exit when not exists (select 1 from public.groups where invite_code = v_code);
  end loop;
  return v_code;
end;
$$;

create or replace function public.create_group(p_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 40 then
    raise exception 'Gruppenname: 2 bis 40 Zeichen';
  end if;
  insert into public.groups (name, invite_code, created_by)
  values (v_name, public.make_invite_code(), auth.uid())
  returning id into v_id;
  insert into public.group_members (group_id, user_id, role)
  values (v_id, auth.uid(), 'admin');
  return v_id;
end;
$$;

create or replace function public.join_group(p_code text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_n integer;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;
  select id into v_id from public.groups where invite_code = v_code;
  if v_id is null then
    raise exception 'Code unbekannt';
  end if;
  select count(*) into v_n from public.group_members where group_id = v_id;
  if v_n >= 30 and not exists (
    select 1 from public.group_members where group_id = v_id and user_id = auth.uid()
  ) then
    raise exception 'Die Gruppe ist voll (maximal 30 Personen)';
  end if;
  insert into public.group_members (group_id, user_id, role)
  values (v_id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;
  return v_id;
end;
$$;

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

-- Punkte: ABV / 5 pro Standardportion der Kategorie, anteilig nach Menge.
-- Pils 0,5 l (ca. 5 %) = 1 | Wein 0,2 l (12 %) = 2,4 | Vodka 4 cl (40 %) = 8
-- Gezählt wird höchstens bis zum Punkte-Limit UND bis zur Alkohol-Obergrenze
-- des Abends (beides frei einstellbar, leer = kein Limit) (party_day, Tageswechsel 06:00 Uhr Ortszeit, kommt vom Handy).
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

create or replace function public.delete_drink(p_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_path text;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;
  delete from public.drinks
  where id = p_id
    and user_id = auth.uid()
    and created_at > now() - interval '60 minutes'
  returning photo_path into v_path;
  if v_path is null then
    raise exception 'Löschen geht nur bei eigenen Getränken in den ersten 60 Minuten';
  end if;
  return v_path;
end;
$$;

create or replace function public.flag_drink(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;
  select user_id into v_owner from public.drinks where id = p_id;
  if v_owner is null then
    raise exception 'Getränk nicht gefunden';
  end if;
  if not public.is_member_drink(p_id) then
    raise exception 'Kein Zugriff';
  end if;
  if v_owner = auth.uid() then
    raise exception 'Eigene Getränke kannst du nicht melden';
  end if;
  insert into public.drink_flags (drink_id, user_id) values (p_id, auth.uid())
  on conflict (drink_id, user_id) do nothing;
end;
$$;

create or replace function public.unflag_drink(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;
  delete from public.drink_flags where drink_id = p_id and user_id = auth.uid();
end;
$$;

-- Rangliste. Ein Getränk zählt nicht, wenn genug Gruppenmitglieder es melden:
-- Schwelle = 2 Meldungen (bei nur 2 Personen in der Gruppe: 1 Meldung).
create or replace function public.leaderboard(p_group uuid, p_from date default null)
returns table (user_id uuid, display_name text, points numeric, drinks bigint)
language sql stable security definer set search_path = public as $$
  with thr as (
    select greatest(1, least(2, count(*)::int - 1)) as t
    from public.group_members where group_id = p_group
  ),
  good as (
    select d.id, d.user_id, d.points
    from public.drinks d
    where d.group_id = p_group
      and (p_from is null or d.party_day >= p_from)
      and (select count(*) from public.drink_flags f where f.drink_id = d.id) < (select t from thr)
  )
  select m.user_id, p.display_name, coalesce(sum(g.points), 0)::numeric, count(g.id)
  from public.group_members m
  join public.profiles p on p.id = m.user_id
  left join good g on g.user_id = m.user_id
  where m.group_id = p_group and public.is_member(p_group)
  group by m.user_id, p.display_name
  order by 3 desc, 4 desc, 2;
$$;

-- ---------------------------------------------------------------------
-- 6. Wer darf welche Funktion aufrufen
-- ---------------------------------------------------------------------

revoke all on function public.make_invite_code() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;

revoke all on function public.is_member(uuid) from public, anon;
revoke all on function public.is_member_txt(text) from public, anon;
revoke all on function public.shares_group_with(uuid) from public, anon;
revoke all on function public.is_member_drink(uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_member_txt(text) to authenticated;
grant execute on function public.shares_group_with(uuid) to authenticated;
grant execute on function public.is_member_drink(uuid) to authenticated;

revoke all on function public.create_group(text) from public, anon;
revoke all on function public.join_group(text) from public, anon;
revoke all on function public.set_limits(uuid, numeric, numeric) from public, anon;
revoke all on function public.log_drink(uuid, text, text, numeric, integer, date, text, double precision, double precision) from public, anon;
revoke all on function public.delete_drink(uuid) from public, anon;
revoke all on function public.flag_drink(uuid) from public, anon;
revoke all on function public.unflag_drink(uuid) from public, anon;
revoke all on function public.leaderboard(uuid, date) from public, anon;
grant execute on function public.create_group(text) to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.set_limits(uuid, numeric, numeric) to authenticated;
grant execute on function public.log_drink(uuid, text, text, numeric, integer, date, text, double precision, double precision) to authenticated;
grant execute on function public.delete_drink(uuid) to authenticated;
grant execute on function public.flag_drink(uuid) to authenticated;
grant execute on function public.unflag_drink(uuid) to authenticated;
grant execute on function public.leaderboard(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Foto-Speicher (privat, nur Gruppenmitglieder sehen die Fotos)
--    Dateipfad: <gruppen-id>/<user-id>/<datei>.jpg
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('drink-photos', 'drink-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg'];

drop policy if exists runde_photos_insert on storage.objects;
create policy runde_photos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'drink-photos'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.is_member_txt((storage.foldername(name))[1])
  );

drop policy if exists runde_photos_select on storage.objects;
create policy runde_photos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'drink-photos'
    and public.is_member_txt((storage.foldername(name))[1])
  );

drop policy if exists runde_photos_delete on storage.objects;
create policy runde_photos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'drink-photos'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- ---------------------------------------------------------------------
-- 8. Tabellen-Rechte für angemeldete Nutzer
--    Neue Supabase-Projekte vergeben diese Rechte nicht mehr automatisch.
--    Ohne sie kommt "permission denied for table ...". Die Zugriffsregeln
--    aus Abschnitt 4 (RLS) bestimmen weiterhin, welche Zeilen sichtbar sind.
-- ---------------------------------------------------------------------

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.groups to authenticated;
grant select on public.group_members to authenticated;
grant select on public.categories to authenticated;
grant select on public.drinks to authenticated;
grant select on public.drink_flags to authenticated;

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
