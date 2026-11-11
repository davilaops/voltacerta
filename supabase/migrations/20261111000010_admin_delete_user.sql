-- 0010 — Super Admin: excluir usuário (definitivo).
--
-- Regras:
--   * só Super Admin; justificativa obrigatória; e-mail digitado como confirmação;
--   * não exclui a si mesmo nem outro Super Admin;
--   * não exclui PROPRIETÁRIO de estabelecimento (exclua o estabelecimento antes),
--     para nunca deixar um estabelecimento sem dono;
--   * vínculos como admin/funcionário são removidos (cascade); registros criados pelo
--     usuário (compras, contatos etc.) são mantidos sem autor (on delete set null);
--   * a exclusão em auth.users remove também identidades, sessões e o perfil.

create or replace function public.admin_delete_user(p_user uuid, p_reason text, p_confirm_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_email text;
  v_created timestamptz;
  v_details jsonb;
begin
  perform public._assert_super_admin();
  v_reason := public._require_reason(p_reason);
  select email, created_at into v_email, v_created from auth.users where id = p_user for update;
  if v_email is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_user = auth.uid() then raise exception 'CANNOT_DELETE_SELF' using errcode = 'P0001'; end if;
  if exists (select 1 from public.platform_admins where user_id = p_user) then
    raise exception 'CANNOT_DELETE_ADMIN' using errcode = 'P0001';
  end if;
  if p_confirm_email is null or lower(trim(p_confirm_email)) <> lower(v_email) then
    raise exception 'CONFIRMATION_MISMATCH' using errcode = '22023';
  end if;
  if exists (select 1 from public.organization_members where user_id = p_user and role = 'owner') then
    raise exception 'USER_OWNS_ORGANIZATION' using errcode = 'P0001';
  end if;

  v_details := jsonb_build_object(
    'email', v_email,
    'full_name', (select full_name from public.profiles where id = p_user),
    'created_at', v_created,
    'organizations', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'role', m.role)), '[]'::jsonb)
                        from public.organization_members m join public.organizations o on o.id = m.organization_id
                       where m.user_id = p_user));

  delete from auth.users where id = p_user;
  perform public._admin_log('delete_user', 'user', p_user::text, v_reason, v_details);
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.admin_delete_user(uuid, text, text) from public, anon;
grant execute on function public.admin_delete_user(uuid, text, text) to authenticated, service_role;
