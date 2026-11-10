-- =====================================================================
-- VoltaCerta — 0004: Storage para logos dos estabelecimentos
-- Caminho obrigatório: {organization_id}/<arquivo>
-- Leitura pública (logo aparece no painel); escrita só owner/admin.
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('org-logos', 'org-logos', true)
on conflict (id) do nothing;

create policy "org logos insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'org-logos'
    and public.has_org_role(((storage.foldername(name))[1])::uuid, array['owner', 'admin']::public.member_role[]));

create policy "org logos update" on storage.objects for update to authenticated
  using (bucket_id = 'org-logos'
    and public.has_org_role(((storage.foldername(name))[1])::uuid, array['owner', 'admin']::public.member_role[]));

create policy "org logos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'org-logos'
    and public.has_org_role(((storage.foldername(name))[1])::uuid, array['owner', 'admin']::public.member_role[]));
