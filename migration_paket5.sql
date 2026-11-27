-- Paket 5: Admin kann den Gruppennamen jederzeit ändern.
-- Einmal im Supabase SQL-Editor ausfuehren. Darf mehrfach laufen.

create or replace function public.rename_group(p_group uuid, p_name text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;
  if not exists (
    select 1 from public.group_members
    where group_id = p_group and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Nur der Admin darf den Gruppennamen ändern';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 40 then
    raise exception 'Gruppenname: 2 bis 40 Zeichen';
  end if;
  update public.groups set name = v_name where id = p_group;
end;
$$;

revoke all on function public.rename_group(uuid, text) from public, anon;
grant execute on function public.rename_group(uuid, text) to authenticated;

notify pgrst, 'reload schema';
