-- 0006 — Endurecimento de permissões das funções (aditiva, sem tocar em dados).
--
-- Auditoria (Supabase Advisors, lint 0028): 37 funções SECURITY DEFINER do
-- schema public estavam executáveis pelo papel `anon` via /rest/v1/rpc/*.
-- As migrations anteriores revogavam de `anon`, mas o PostgreSQL concede
-- EXECUTE a PUBLIC por padrão em toda função nova — e `anon` herda de PUBLIC.
-- Os corpos já exigiam auth.uid() (UNAUTHENTICATED), então não havia
-- vazamento, mas a superfície pública precisa ser zero.
--
-- Regra aplicada: nenhuma função do schema public é executável por PUBLIC
-- ou `anon`. Quem já tinha permissão (authenticated / service_role) mantém,
-- agora por grant explícito. Funções que já estavam restritas
-- (promote_super_admin, _assert_*, triggers etc.) continuam restritas.

do $$
declare
  f record;
  auth_ok boolean;
  svc_ok boolean;
begin
  for f in
    select p.oid, p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f', 'p')
  loop
    -- has_function_privilege considera PUBLIC: registra o estado antes de revogar
    auth_ok := has_function_privilege('authenticated', f.oid, 'EXECUTE');
    svc_ok := has_function_privilege('service_role', f.oid, 'EXECUTE');
    execute format('revoke execute on function %s from public, anon', f.sig);
    if auth_ok then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    if svc_ok then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end $$;

-- Funções criadas no futuro por este papel não nascem executáveis por PUBLIC/anon.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
