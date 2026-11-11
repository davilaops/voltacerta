-- Teste de fumaça no banco REMOTO, sem deixar rastro.
-- Tudo roda dentro de um único bloco DO que termina com RAISE EXCEPTION:
-- o PostgreSQL desfaz TODAS as alterações (usuários, organizações, clientes,
-- compras, logs). O resultado sai na mensagem de erro "SMOKE_RESULT: {...}".
--
-- Uso: npx supabase db query --remote=<ref> --yes --file scripts/remote-smoke-test.sql
do $$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  org_a uuid; org_b uuid;
  cust_a uuid; cust_b uuid; prod_a uuid; purch uuid; n int;
  r jsonb := '{}'::jsonb;
  v jsonb;
begin
  -- 1. "Cadastro": inserir em auth.users dispara o trigger que cria o perfil
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', ua, 'authenticated', 'authenticated', 'smoke-a@teste.invalid', now(), '{"full_name":"Smoke A"}', '{"provider":"email"}', now(), now()),
         ('00000000-0000-0000-0000-000000000000', ub, 'authenticated', 'authenticated', 'smoke-b@teste.invalid', now(), '{"full_name":"Smoke B"}', '{"provider":"email"}', now(), now());
  r := r || jsonb_build_object('signup_profile_created', (select count(*) from public.profiles where id in (ua, ub)) = 2);

  -- 2. Usuário A (como o PostgREST faz: papel authenticated + claims do JWT)
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  org_a := public.create_organization('Smoke Loja A', 'Smoke A', '11999990000', 'São Paulo', 'SP', 'pet_shop');
  r := r || jsonb_build_object(
    'onboarding_member_owner', (select role::text from public.organization_members where organization_id = org_a and user_id = ua) = 'owner',
    'onboarding_trial', (select status::text from public.subscriptions where organization_id = org_a) = 'trialing',
    'onboarding_templates', (select count(*) from public.message_templates where organization_id = org_a) > 0,
    'onboarding_idempotent', public.create_organization('Smoke Loja A') = org_a);

  -- 3. CRUD real do usuário A
  insert into public.customers (organization_id, full_name, phone) values (org_a, 'Cliente Smoke', '11988887777') returning id into cust_a;
  insert into public.products (organization_id, name, category, price, avg_duration_days) values (org_a, 'Ração Smoke 10kg', 'racoes', 150, 30) returning id into prod_a;
  update public.customers set full_name = 'Cliente Smoke Editado' where id = cust_a;
  update public.products set active = false where id = prod_a;
  update public.products set active = true where id = prod_a;
  purch := public.create_purchase(org_a, cust_a, current_date - 25, jsonb_build_array(jsonb_build_object('product_id', prod_a, 'quantity', 1)));
  r := r || jsonb_build_object(
    'crud_customer_edit', (select full_name from public.customers where id = cust_a) = 'Cliente Smoke Editado',
    'crud_product_toggle', (select active from public.products where id = prod_a),
    'purchase_total', (select total from public.purchases where id = purch),
    'prediction_created', (select count(*) from public.v_predictions where customer_id = cust_a) = 1,
    'prediction_due', (select expected_date from public.v_predictions where customer_id = cust_a) = current_date + 5);
  perform public.log_contact(org_a, cust_a, 'respondeu');
  r := r || jsonb_build_object('contact_logged', (select count(*) from public.contact_logs where customer_id = cust_a) = 1);
  v := public.dashboard_metrics(org_a, current_date - 30, current_date);
  r := r || jsonb_build_object('dashboard_ok', v is not null);
  perform public.delete_purchase(purch);
  r := r || jsonb_build_object('purchase_deleted', (select count(*) from public.purchases where id = purch) = 0);

  -- 4. Usuário B com sua própria organização
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  org_b := public.create_organization('Smoke Loja B');
  insert into public.customers (organization_id, full_name) values (org_b, 'Cliente da Loja B') returning id into cust_b;

  -- 5. Isolamento: B tenta ler/alterar/apagar dados de A, enviando org_a/ids de A
  r := r || jsonb_build_object(
    'iso_b_sees_a_customers', (select count(*) from public.customers where organization_id = org_a),
    'iso_b_sees_a_products', (select count(*) from public.products where organization_id = org_a),
    'iso_b_sees_a_org', (select count(*) from public.organizations where id = org_a),
    'iso_b_sees_a_contacts', (select count(*) from public.contact_logs where organization_id = org_a),
    'iso_b_sees_a_audit', (select count(*) from public.audit_logs where organization_id = org_a),
    'iso_b_sees_own', (select count(*) from public.customers));
  update public.customers set full_name = 'Hackeado' where id = cust_a; get diagnostics n = row_count;
  r := r || jsonb_build_object('iso_b_update_a_rows', n);
  delete from public.customers where id = cust_a; get diagnostics n = row_count;
  r := r || jsonb_build_object('iso_b_delete_a_rows', n);
  begin
    insert into public.customers (organization_id, full_name) values (org_a, 'Intruso');
    r := r || jsonb_build_object('iso_b_insert_into_a', 'ALLOWED');
  exception when others then r := r || jsonb_build_object('iso_b_insert_into_a', 'blocked: ' || sqlerrm); end;
  begin
    perform public.create_purchase(org_a, cust_a, current_date, jsonb_build_array(jsonb_build_object('product_id', prod_a, 'quantity', 1)));
    r := r || jsonb_build_object('iso_b_rpc_purchase_in_a', 'ALLOWED');
  exception when others then r := r || jsonb_build_object('iso_b_rpc_purchase_in_a', 'blocked: ' || sqlerrm); end;
  begin
    perform public.get_org_context(org_a);
    r := r || jsonb_build_object('iso_b_rpc_context_a', 'ALLOWED');
  exception when others then r := r || jsonb_build_object('iso_b_rpc_context_a', 'blocked: ' || sqlerrm); end;
  begin
    perform public.admin_list_organizations();
    r := r || jsonb_build_object('iso_b_admin_rpc', 'ALLOWED');
  exception when others then r := r || jsonb_build_object('iso_b_admin_rpc', 'blocked: ' || sqlerrm); end;

  -- 6. A confirma que os dados dele continuam intactos
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  r := r || jsonb_build_object(
    'a_data_intact', (select full_name from public.customers where id = cust_a) = 'Cliente Smoke Editado',
    'a_sees_b', (select count(*) from public.customers where organization_id = org_b));
  delete from public.customers where id = cust_a; get diagnostics n = row_count;
  r := r || jsonb_build_object('crud_customer_delete', n = 1);

  -- 7. Anônimo (sem login)
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    perform count(*) from public.customers;
    r := r || jsonb_build_object('anon_customers', 'ALLOWED');
  exception when others then r := r || jsonb_build_object('anon_customers', 'blocked: ' || sqlerrm); end;
  begin
    perform public.get_org_context(org_a);
    r := r || jsonb_build_object('anon_rpc', 'ALLOWED');
  exception when others then r := r || jsonb_build_object('anon_rpc', 'blocked: ' || sqlerrm); end;
  r := r || jsonb_build_object('anon_plans', (select count(*) from public.plans));

  -- Desfaz tudo
  -- mensagens de erro encurtadas: o resultado precisa caber em ~1000 caracteres
  raise exception 'SMOKE_RESULT: %', (select jsonb_object_agg(key, case when jsonb_typeof(value) = 'string' then to_jsonb(left(value #>> '{}', 12)) else value end) from jsonb_each(r))::text;
end $$;
