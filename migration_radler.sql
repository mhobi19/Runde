insert into public.categories (key, label, ref_ml) values ('radler', 'Radler', 2500)
on conflict (key) do update set label = excluded.label, ref_ml = excluded.ref_ml;
