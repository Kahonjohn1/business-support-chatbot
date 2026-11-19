insert into public.companies (id, name, slug)
values ('3f8a2d64-9c1e-4f5b-a7d0-6b2e1c9f4a80', 'Marque Technologies', 'marque-technologies')
on conflict (slug) do nothing;
