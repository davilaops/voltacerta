-- =====================================================================
-- VoltaCerta — 0003: regras de negócio no servidor
-- Motor de previsão, RPCs atômicas, indicadores, relatórios e equipe.
-- Todas as RPCs SECURITY DEFINER validam a associação do usuário à
-- organização (nunca confiam no organization_id enviado pelo cliente).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Guardas
-- ---------------------------------------------------------------------
create or replace function public._assert_member(p_org uuid, p_roles public.member_role[] default null)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if p_roles is null then
    if not public.is_org_member(p_org) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  elsif not public.has_org_role(p_org, p_roles) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
end $$;

create or replace function public._assert_writable(p_org uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.org_can_write(p_org) then
    raise exception 'SUBSCRIPTION_INACTIVE' using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Modelos padrão de mensagem
-- ---------------------------------------------------------------------
create or replace function public._seed_default_templates(p_org uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.message_templates (organization_id, name, kind, body, is_default) values
  (p_org, 'Reposição', 'reposicao',
   'Olá, {nome}! Tudo bem? Estamos passando para saber se você está precisando repor {produto} para seu pet. Podemos separar para você!', true),
  (p_org, 'Cliente atrasado', 'atrasado',
   'Olá, {nome}! Sentimos sua falta por aqui. Está precisando de algum produto para seu pet? Estamos à disposição para ajudar!', true),
  (p_org, 'Recompra', 'recompra',
   'Olá, {nome}! Está chegando o período de reposição de {produto}. Se precisar, podemos deixar seu pedido preparado!', true);
$$;

create or replace function public.restore_default_templates(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._assert_member(p_org, array['owner', 'admin']::public.member_role[]);
  delete from public.message_templates where organization_id = p_org and is_default;
  perform public._seed_default_templates(p_org);
end $$;

-- ---------------------------------------------------------------------
-- Onboarding: cria organização + vínculo owner + trial + modelos
-- ---------------------------------------------------------------------
create or replace function public.create_organization(
  p_name text, p_owner_name text default null, p_phone text default null,
  p_city text default null, p_state text default null, p_business_type text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if (select count(*) from public.organization_members where user_id = v_uid and role = 'owner') >= 3 then
    raise exception 'ORG_LIMIT_REACHED' using errcode = 'P0001';
  end if;
  insert into public.organizations (name, owner_name, phone, city, state, business_type)
  values (trim(p_name), nullif(trim(p_owner_name), ''), nullif(trim(p_phone), ''), nullif(trim(p_city), ''),
          nullif(upper(trim(p_state)), ''), nullif(p_business_type, ''))
  returning id into v_org;
  insert into public.organization_members (organization_id, user_id, role) values (v_org, v_uid, 'owner');
  -- Trial de 14 dias com recursos do plano Profissional. Nenhum pagamento é simulado.
  insert into public.subscriptions (organization_id, plan, status, trial_ends_at)
  values (v_org, 'profissional', 'trialing', now() + interval '14 days');
  perform public._seed_default_templates(v_org);
  if nullif(trim(p_owner_name), '') is not null then
    update public.profiles set full_name = trim(p_owner_name) where id = v_uid and full_name is null;
  end if;
  return v_org;
end $$;

-- Aceita convites pendentes para o e-mail do usuário autenticado
create or replace function public.accept_pending_invitations()
returns int language plpgsql security definer set search_path = '' as $$
declare v_email text; v_count int := 0; r record;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is null then return 0; end if;
  for r in select * from public.organization_invitations where email = v_email and accepted_at is null loop
    insert into public.organization_members (organization_id, user_id, role)
    values (r.organization_id, auth.uid(), r.role) on conflict do nothing;
    update public.organization_invitations set accepted_at = now() where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function public.update_member_role(p_org uuid, p_user uuid, p_role public.member_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._assert_member(p_org, array['owner']::public.member_role[]);
  if p_role = 'owner' or p_user = auth.uid() then raise exception 'INVALID_ROLE_CHANGE' using errcode = 'P0001'; end if;
  update public.organization_members set role = p_role where organization_id = p_org and user_id = p_user and role <> 'owner';
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

create or replace function public.remove_member(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._assert_member(p_org, array['owner', 'admin']::public.member_role[]);
  if p_user = auth.uid() then raise exception 'INVALID_ROLE_CHANGE' using errcode = 'P0001'; end if;
  delete from public.organization_members
   where organization_id = p_org and user_id = p_user and role <> 'owner'
     and (role = 'staff' or public.has_org_role(p_org, array['owner']::public.member_role[]));
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
end $$;

-- ---------------------------------------------------------------------
-- MOTOR DE PREVISÃO
--
-- 1. base_unit = duração média do produto (ou padrão do estabelecimento)
-- 2. Histórico: intervalos entre compras consecutivas do mesmo produto
--    pelo mesmo cliente, normalizados pela quantidade da compra anterior
--    (dias por unidade). Cada intervalo é limitado a [0,4x ; 2,5x] da base
--    para descartar outliers.
-- 3. Se houver >= history_min_intervals intervalos, usa a MEDIANA dos
--    últimos 6, com peso w = min(max_weight, n / (n + 3)). Poucos
--    registros => peso baixo => previsão estável.
-- 4. dias = round(((1-w)*base + w*hist) * quantidade), entre 1 e 730.
-- ---------------------------------------------------------------------
create or replace function public.compute_expected_days(
  p_org uuid, p_customer uuid, p_product uuid, p_quantity numeric, p_purchase_date date
) returns table (expected_days int, base_days int, history_days numeric, history_samples int)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_base numeric; v_min int; v_maxw numeric; v_hist numeric; v_n int; v_w numeric; v_unit numeric;
begin
  select coalesce(p.avg_duration_days, o.default_duration_days), o.history_min_intervals, o.history_max_weight
    into v_base, v_min, v_maxw
    from public.products p join public.organizations o on o.id = p.organization_id
   where p.id = p_product and p.organization_id = p_org;
  if v_base is null then raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002'; end if;

  with buys as (
    select pu.purchase_date as d, sum(pi.quantity) as q
      from public.purchase_items pi join public.purchases pu on pu.id = pi.purchase_id
     where pi.organization_id = p_org and pu.customer_id = p_customer and pi.product_id = p_product
       and pu.purchase_date <= p_purchase_date
     group by pu.purchase_date
  ), intervals as (
    select d, (lead(d) over (order by d) - d)::numeric / nullif(q, 0) as per_unit from buys
  ), recent as (
    select least(greatest(per_unit, v_base * 0.4), v_base * 2.5) as v
      from intervals where per_unit is not null and per_unit > 0
     order by d desc limit 6
  )
  select percentile_cont(0.5) within group (order by v), count(*) into v_hist, v_n from recent;

  if v_n >= v_min and v_hist is not null then
    v_w := least(v_maxw, v_n::numeric / (v_n + 3));
    v_unit := (1 - v_w) * v_base + v_w * v_hist;
  else
    v_unit := v_base;
  end if;

  expected_days := least(730, greatest(1, round(v_unit * p_quantity)))::int;
  base_days := round(v_base * p_quantity)::int;
  history_days := case when v_n >= v_min then round(v_hist::numeric, 2) end;
  history_samples := coalesce(v_n, 0);
  return next;
end $$;

-- Aplica a compra de um produto às previsões do cliente (uso interno)
create or replace function public._apply_purchase_to_predictions(
  p_org uuid, p_customer uuid, p_product uuid, p_purchase uuid, p_date date,
  p_quantity numeric, p_amount numeric
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_latest date; v_pred public.replenishment_predictions; v_recovered boolean; v_attr int; v_tz text;
  v_calc record; v_price numeric;
begin
  -- Compra retroativa anterior à mais recente: entra no histórico, mas não
  -- altera a previsão vigente.
  select max(pu.purchase_date) into v_latest
    from public.purchase_items pi join public.purchases pu on pu.id = pi.purchase_id
   where pi.organization_id = p_org and pu.customer_id = p_customer and pi.product_id = p_product
     and pu.id <> p_purchase;
  if v_latest is not null and v_latest > p_date then return; end if;

  select attribution_days, timezone into v_attr, v_tz from public.organizations where id = p_org;

  select * into v_pred from public.replenishment_predictions
   where organization_id = p_org and customer_id = p_customer and product_id = p_product
     and status in ('open', 'contacted')
   for update;

  if found then
    -- Venda recuperada = houve contato registrado com o cliente dentro da
    -- janela de atribuição antes (ou no dia) da compra.
    select exists (
      select 1 from public.contact_logs cl
       where cl.organization_id = p_org and cl.customer_id = p_customer
         and (cl.contacted_at at time zone v_tz)::date between p_date - v_attr and p_date
    ) into v_recovered;
    update public.replenishment_predictions
       set status = 'completed', completed_at = now(), completed_purchase_id = p_purchase,
           recovered = v_recovered, recovered_amount = case when v_recovered then p_amount else 0 end
     where id = v_pred.id;
  end if;

  select * into v_calc from public.compute_expected_days(p_org, p_customer, p_product, p_quantity, p_date);
  select price into v_price from public.products where id = p_product;

  insert into public.replenishment_predictions (
    organization_id, customer_id, product_id, source_purchase_id, expected_date, quantity,
    expected_days, base_days, history_days, history_samples, potential_value)
  values (p_org, p_customer, p_product, p_purchase, p_date + v_calc.expected_days, p_quantity,
          v_calc.expected_days, v_calc.base_days, v_calc.history_days, v_calc.history_samples,
          round(coalesce(v_price, 0) * p_quantity, 2));
end $$;

-- ---------------------------------------------------------------------
-- Registro de compra (atômico e idempotente)
-- p_items: [{ "product_id": uuid, "quantity": n, "unit_price": n?, "discount": n? }]
-- ---------------------------------------------------------------------
create or replace function public.create_purchase(
  p_org uuid, p_customer uuid, p_purchase_date date, p_items jsonb,
  p_discount numeric default 0, p_notes text default null, p_request_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid; v_today date; v_item jsonb; v_product public.products; v_qty numeric; v_price numeric;
  v_idisc numeric; v_subtotal numeric := 0; v_total numeric; r record;
begin
  perform public._assert_member(p_org);
  perform public._assert_writable(p_org);

  if p_request_id is not null then
    select id into v_id from public.purchases where organization_id = p_org and client_request_id = p_request_id;
    if v_id is not null then return v_id; end if;
  end if;

  if not exists (select 1 from public.customers where id = p_customer and organization_id = p_org) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_today := public.org_today(p_org);
  if p_purchase_date is null or p_purchase_date > v_today or p_purchase_date < date '2000-01-01' then
    raise exception 'INVALID_DATE' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 50 then
    raise exception 'INVALID_ITEMS' using errcode = '22023';
  end if;
  if coalesce(p_discount, 0) < 0 then raise exception 'INVALID_DISCOUNT' using errcode = '22023'; end if;

  insert into public.purchases (organization_id, customer_id, purchase_date, subtotal, discount, total, notes,
                                client_request_id, created_by)
  values (p_org, p_customer, p_purchase_date, 0, 0, 0, nullif(trim(p_notes), ''), p_request_id, auth.uid())
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from public.products
     where id = (v_item ->> 'product_id')::uuid and organization_id = p_org;
    if not found then raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002'; end if;
    v_qty := (v_item ->> 'quantity')::numeric;
    v_price := coalesce((v_item ->> 'unit_price')::numeric, v_product.price);
    v_idisc := coalesce((v_item ->> 'discount')::numeric, 0);
    if v_qty is null or v_qty <= 0 or v_qty > 10000 or v_price < 0 or v_idisc < 0 or v_idisc > v_qty * v_price then
      raise exception 'INVALID_ITEMS' using errcode = '22023';
    end if;
    insert into public.purchase_items (organization_id, purchase_id, product_id, quantity, unit_price, discount, total)
    values (p_org, v_id, v_product.id, v_qty, v_price, v_idisc, round(v_qty * v_price - v_idisc, 2));
    v_subtotal := v_subtotal + round(v_qty * v_price - v_idisc, 2);
  end loop;

  if coalesce(p_discount, 0) > v_subtotal then raise exception 'INVALID_DISCOUNT' using errcode = '22023'; end if;
  v_total := v_subtotal - coalesce(p_discount, 0);
  update public.purchases set subtotal = v_subtotal, discount = coalesce(p_discount, 0), total = v_total where id = v_id;

  -- Uma previsão por produto (itens repetidos do mesmo produto são somados).
  -- Desconto geral é rateado proporcionalmente no valor recuperado.
  for r in
    select product_id, sum(quantity) as qty, sum(total) as amount
      from public.purchase_items where purchase_id = v_id group by product_id
  loop
    perform public._apply_purchase_to_predictions(
      p_org, p_customer, r.product_id, v_id, p_purchase_date, r.qty,
      case when v_subtotal > 0 then round(r.amount * v_total / v_subtotal, 2) else 0 end);
  end loop;

  return v_id;
end $$;

-- Exclusão de compra: remove previsões geradas e reabre as encerradas por ela
create or replace function public.delete_purchase(p_purchase uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.purchases where id = p_purchase;
  if v_org is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform public._assert_member(v_org, array['owner', 'admin']::public.member_role[]);
  delete from public.replenishment_predictions where source_purchase_id = p_purchase;
  update public.replenishment_predictions
     set status = case when contacted_at is not null then 'contacted'::public.prediction_status else 'open'::public.prediction_status end,
         completed_at = null, completed_purchase_id = null, recovered = false, recovered_amount = 0
   where completed_purchase_id = p_purchase and status = 'completed';
  delete from public.purchases where id = p_purchase;
end $$;

-- ---------------------------------------------------------------------
-- Status manual de previsão (ignorar / reabrir)
-- ---------------------------------------------------------------------
create or replace function public.set_prediction_status(p_prediction uuid, p_status public.prediction_status, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pred public.replenishment_predictions;
begin
  select * into v_pred from public.replenishment_predictions where id = p_prediction;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform public._assert_member(v_pred.organization_id);
  perform public._assert_writable(v_pred.organization_id);
  if p_status = 'ignored' and v_pred.status in ('open', 'contacted') then
    update public.replenishment_predictions set status = 'ignored', ignored_reason = nullif(trim(p_reason), '') where id = p_prediction;
  elsif p_status = 'open' and v_pred.status = 'ignored' then
    update public.replenishment_predictions
       set status = case when contacted_at is not null then 'contacted'::public.prediction_status else 'open'::public.prediction_status end,
           ignored_reason = null
     where id = p_prediction;
  else
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Registro de contato (somente após confirmação do usuário)
-- ---------------------------------------------------------------------
create or replace function public.log_contact(
  p_org uuid, p_customer uuid, p_result public.contact_result,
  p_prediction uuid default null, p_template uuid default null, p_message text default null,
  p_follow_up date default null, p_notes text default null, p_channel text default 'whatsapp_link'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_dnc boolean;
begin
  perform public._assert_member(p_org);
  perform public._assert_writable(p_org);
  select do_not_contact into v_dnc from public.customers where id = p_customer and organization_id = p_org;
  if not found then raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_dnc then raise exception 'CUSTOMER_OPTED_OUT' using errcode = 'P0001'; end if;
  if p_prediction is not null and not exists (
    select 1 from public.replenishment_predictions
     where id = p_prediction and organization_id = p_org and customer_id = p_customer) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_template is not null and not exists (
    select 1 from public.message_templates where id = p_template and organization_id = p_org) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Rate limit: evita disparos em massa / cliques repetidos
  if (select count(*) from public.contact_logs where user_id = auth.uid() and contacted_at > now() - interval '1 minute') >= 20 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
  if p_follow_up is not null and p_follow_up < public.org_today(p_org) then
    raise exception 'INVALID_DATE' using errcode = '22023';
  end if;

  insert into public.contact_logs (organization_id, customer_id, prediction_id, template_id, channel, message,
                                   result, follow_up_date, notes, user_id)
  values (p_org, p_customer, p_prediction, p_template, p_channel, left(p_message, 2000), p_result,
          p_follow_up, nullif(trim(p_notes), ''), auth.uid())
  returning id into v_id;

  update public.replenishment_predictions set status = 'contacted', contacted_at = now()
   where organization_id = p_org and customer_id = p_customer and status = 'open'
     and (id = p_prediction or (p_prediction is null and expected_date <= public.org_today(p_org) + (
       select soon_days from public.organizations where id = p_org)));
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Views (security_invoker => respeitam RLS do usuário)
-- ---------------------------------------------------------------------
create or replace view public.v_predictions with (security_invoker = true) as
select
  p.*,
  c.full_name as customer_name, c.phone as customer_phone, c.phone_normalized as customer_phone_normalized,
  c.do_not_contact as customer_do_not_contact,
  pr.name as product_name, pr.category as product_category, pr.price as product_price,
  src.purchase_date as last_purchase_date,
  pet.name as pet_name,
  (p.expected_date - t.today) as days_until,
  case p.status
    when 'open' then case
      when t.today > p.expected_date + o.overdue_after_days then 'atrasada'
      when t.today >= p.expected_date then 'hoje'
      when p.expected_date - t.today <= o.soon_days then 'proxima'
      else 'prevista' end
    when 'contacted' then 'contatada'
    when 'completed' then 'concluida'
    else 'ignorada'
  end as stage,
  (p.status in ('open', 'contacted') and t.today > p.expected_date + o.lost_after_days) as is_lost
from public.replenishment_predictions p
join public.customers c on c.id = p.customer_id
join public.products pr on pr.id = p.product_id
join public.purchases src on src.id = p.source_purchase_id
join public.organizations o on o.id = p.organization_id
cross join lateral (select (now() at time zone o.timezone)::date as today) t
left join lateral (
  select pe.name from public.pets pe where pe.customer_id = c.id order by pe.created_at limit 1
) pet on true;

create or replace view public.v_customers with (security_invoker = true) as
select
  c.*,
  coalesce(pets.names, '') as pet_names,
  coalesce(pets.cnt, 0) as pet_count,
  stats.purchases_count, stats.total_spent, stats.last_purchase_date,
  lastp.product_name as last_product_name,
  act.next_expected_date,
  case
    when stats.last_purchase_date is null then 'sem_compras'
    when act.next_expected_date is not null and act.next_expected_date <= t.today then 'precisa_contato'
    when act.next_expected_date is not null and act.next_expected_date - t.today <= o.soon_days then 'proxima'
    when act.next_expected_date is not null then 'em_dia'
    when stats.last_purchase_date < t.today - o.lost_after_days then 'inativo'
    else 'em_dia'
  end as situation
from public.customers c
join public.organizations o on o.id = c.organization_id
cross join lateral (select (now() at time zone o.timezone)::date as today) t
left join lateral (
  select string_agg(pe.name, ', ' order by pe.created_at) as names, count(*) as cnt
    from public.pets pe where pe.customer_id = c.id
) pets on true
left join lateral (
  select count(*)::int as purchases_count, coalesce(sum(pu.total), 0) as total_spent, max(pu.purchase_date) as last_purchase_date
    from public.purchases pu where pu.customer_id = c.id
) stats on true
left join lateral (
  select pr.name as product_name
    from public.purchases pu join public.purchase_items pi on pi.purchase_id = pu.id
    join public.products pr on pr.id = pi.product_id
   where pu.customer_id = c.id order by pu.purchase_date desc, pu.created_at desc limit 1
) lastp on true
left join lateral (
  select min(rp.expected_date) as next_expected_date
    from public.replenishment_predictions rp
   where rp.customer_id = c.id and rp.status in ('open', 'contacted')
) act on true;

-- ---------------------------------------------------------------------
-- Contexto da organização (plano, uso, papel)
-- ---------------------------------------------------------------------
create or replace function public.get_org_context(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public._assert_member(p_org);
  select jsonb_build_object(
    'role', (select role from public.organization_members where organization_id = p_org and user_id = auth.uid()),
    'plan', s.plan,
    'status', s.status,
    'effective_status', public.subscription_effective_status(p_org),
    'trial_ends_at', s.trial_ends_at,
    'current_period_end', s.current_period_end,
    'can_write', public.org_can_write(p_org),
    'customer_limit', public.plan_customer_limit(s.plan),
    'customer_count', (select count(*) from public.customers where organization_id = p_org),
    'features', jsonb_build_object(
      'reports_full', public.plan_allows(p_org, 'reports_full'),
      'history_advanced', public.plan_allows(p_org, 'history_advanced'),
      'reports_advanced', public.plan_allows(p_org, 'reports_advanced')),
    'today', public.org_today(p_org)
  ) into v
  from public.subscriptions s where s.organization_id = p_org;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Indicadores do dashboard (dados reais, período em datas locais)
-- ---------------------------------------------------------------------
create or replace function public.dashboard_metrics(p_org uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date; v_tz text; v_soon int; v_overdue int; v_due int; v_done int; v_result jsonb;
begin
  perform public._assert_member(p_org);
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    raise exception 'INVALID_PERIOD' using errcode = '22023';
  end if;
  select timezone, soon_days, overdue_after_days into v_tz, v_soon, v_overdue from public.organizations where id = p_org;
  v_today := public.org_today(p_org);

  -- Taxa de recompra: das previsões vencidas no período (exceto ignoradas),
  -- quantas foram concluídas com nova compra.
  select count(*) filter (where status <> 'ignored'), count(*) filter (where status = 'completed')
    into v_due, v_done
    from public.replenishment_predictions
   where organization_id = p_org and expected_date between p_from and least(p_to, v_today);

  select jsonb_build_object(
    'customers_total', (select count(*) from public.customers where organization_id = p_org),
    'customers_new', (select count(*) from public.customers where organization_id = p_org
                        and (created_at at time zone v_tz)::date between p_from and p_to),
    'predictions_upcoming', (select count(*) from public.replenishment_predictions where organization_id = p_org
                        and status = 'open' and expected_date between v_today and v_today + v_soon),
    'contact_today', (select count(distinct customer_id) from public.replenishment_predictions rp
                        join public.customers c on c.id = rp.customer_id
                       where rp.organization_id = p_org and rp.status = 'open' and rp.expected_date <= v_today
                         and not c.do_not_contact),
    'recovered_sales', (select count(*) from public.replenishment_predictions rp
                        join public.purchases pu on pu.id = rp.completed_purchase_id
                       where rp.organization_id = p_org and rp.recovered and pu.purchase_date between p_from and p_to),
    'recovered_revenue', (select coalesce(sum(rp.recovered_amount), 0) from public.replenishment_predictions rp
                        join public.purchases pu on pu.id = rp.completed_purchase_id
                       where rp.organization_id = p_org and rp.recovered and pu.purchase_date between p_from and p_to),
    'repurchase_rate', case when v_due > 0 then round(v_done * 100.0 / v_due, 1) else null end,
    'repurchase_due', v_due,
    'repurchase_done', v_done,
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', d.day,
        'recovered_sales', coalesce(rec.cnt, 0),
        'recovered_revenue', coalesce(rec.amount, 0),
        'customers_total', (select count(*) from public.customers c where c.organization_id = p_org
                              and (c.created_at at time zone v_tz)::date <= d.day)
      ) order by d.day), '[]'::jsonb)
      from (select gs::date as day from generate_series(p_from, p_to, interval '1 day') gs) d
      left join lateral (
        select count(*) as cnt, sum(rp.recovered_amount) as amount
          from public.replenishment_predictions rp join public.purchases pu on pu.id = rp.completed_purchase_id
         where rp.organization_id = p_org and rp.recovered and pu.purchase_date = d.day
      ) rec on true
    ),
    'pipeline', (
      select jsonb_build_object(
        'prevista', count(*) filter (where status = 'open' and expected_date > v_today + v_soon),
        'proxima', count(*) filter (where status = 'open' and expected_date > v_today and expected_date <= v_today + v_soon),
        'hoje', count(*) filter (where status = 'open' and expected_date <= v_today and v_today <= expected_date + v_overdue),
        'atrasada', count(*) filter (where status = 'open' and v_today > expected_date + v_overdue),
        'contatada', count(*) filter (where status = 'contacted'))
      from public.replenishment_predictions where organization_id = p_org and status in ('open', 'contacted')
    ),
    'situations', (
      select coalesce(jsonb_object_agg(situation, cnt), '{}'::jsonb)
        from (select situation, count(*) as cnt from public.v_customers where organization_id = p_org group by situation) s
    ),
    'activity', (
      select coalesce(jsonb_agg(a order by a.at desc), '[]'::jsonb) from (
        (select 'purchase' as type, pu.created_at as at, c.full_name as customer_name, c.id as customer_id,
                pu.total as amount, null::text as detail
           from public.purchases pu join public.customers c on c.id = pu.customer_id
          where pu.organization_id = p_org order by pu.created_at desc limit 8)
        union all
        (select 'contact', cl.contacted_at, c.full_name, c.id, null, cl.result::text
           from public.contact_logs cl join public.customers c on c.id = cl.customer_id
          where cl.organization_id = p_org order by cl.contacted_at desc limit 8)
        union all
        (select 'customer', c.created_at, c.full_name, c.id, null, null
           from public.customers c where c.organization_id = p_org order by c.created_at desc limit 8)
        order by 2 desc limit 10
      ) a
    )
  ) into v_result;
  return v_result;
end $$;

-- ---------------------------------------------------------------------
-- Relatórios comerciais (com controle de plano no servidor)
-- ---------------------------------------------------------------------
create or replace function public.get_report(p_org uuid, p_kind text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date; v_lost int; v jsonb;
begin
  perform public._assert_member(p_org);
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 731 then
    raise exception 'INVALID_PERIOD' using errcode = '22023';
  end if;
  if p_kind not in ('sales_by_period', 'recovered_revenue') and not public.plan_allows(p_org, 'reports_full') then
    raise exception 'PLAN_FEATURE_UNAVAILABLE' using errcode = 'P0001';
  end if;
  v_today := public.org_today(p_org);
  select lost_after_days into v_lost from public.organizations where id = p_org;

  case p_kind
  when 'sales_by_period' then
    select coalesce(jsonb_agg(r order by r.date), '[]'::jsonb) into v from (
      select pu.purchase_date as date, count(*) as purchases, sum(pu.total) as revenue,
             count(distinct pu.customer_id) as customers
        from public.purchases pu where pu.organization_id = p_org and pu.purchase_date between p_from and p_to
       group by pu.purchase_date) r;
  when 'top_products' then
    select coalesce(jsonb_agg(r order by r.revenue desc), '[]'::jsonb) into v from (
      select pr.name as product, pr.category, sum(pi.quantity) as quantity, sum(pi.total) as revenue,
             count(distinct pu.id) as purchases
        from public.purchase_items pi join public.purchases pu on pu.id = pi.purchase_id
        join public.products pr on pr.id = pi.product_id
       where pi.organization_id = p_org and pu.purchase_date between p_from and p_to
       group by pr.id, pr.name, pr.category order by sum(pi.total) desc limit 50) r;
  when 'top_customers' then
    select coalesce(jsonb_agg(r order by r.purchases desc, r.revenue desc), '[]'::jsonb) into v from (
      select c.full_name as customer, c.phone, count(*) as purchases, sum(pu.total) as revenue,
             max(pu.purchase_date) as last_purchase
        from public.purchases pu join public.customers c on c.id = pu.customer_id
       where pu.organization_id = p_org and pu.purchase_date between p_from and p_to
       group by c.id, c.full_name, c.phone order by count(*) desc, sum(pu.total) desc limit 50) r;
  when 'inactive_customers' then
    -- Compraram antes do período e não compraram durante ele
    select coalesce(jsonb_agg(r order by r.last_purchase), '[]'::jsonb) into v from (
      select c.full_name as customer, c.phone, max(pu.purchase_date) as last_purchase,
             (v_today - max(pu.purchase_date)) as days_inactive, sum(pu.total) as lifetime_revenue
        from public.customers c join public.purchases pu on pu.customer_id = c.id
       where c.organization_id = p_org
       group by c.id, c.full_name, c.phone
      having max(pu.purchase_date) < p_from) r;
  when 'completed_repurchases' then
    select coalesce(jsonb_agg(r order by r.purchase_date desc), '[]'::jsonb) into v from (
      select c.full_name as customer, pr.name as product, rp.expected_date, pu.purchase_date,
             (pu.purchase_date - rp.expected_date) as days_vs_expected, rp.recovered, pu.total as purchase_total
        from public.replenishment_predictions rp
        join public.purchases pu on pu.id = rp.completed_purchase_id
        join public.customers c on c.id = rp.customer_id join public.products pr on pr.id = rp.product_id
       where rp.organization_id = p_org and rp.status = 'completed' and pu.purchase_date between p_from and p_to) r;
  when 'lost_opportunities' then
    select coalesce(jsonb_agg(r order by r.expected_date), '[]'::jsonb) into v from (
      select c.full_name as customer, c.phone, pr.name as product, rp.expected_date,
             (v_today - rp.expected_date) as days_overdue, rp.potential_value,
             case when rp.status = 'ignored' then 'ignorada' else 'sem recompra' end as reason
        from public.replenishment_predictions rp
        join public.customers c on c.id = rp.customer_id join public.products pr on pr.id = rp.product_id
       where rp.organization_id = p_org and rp.expected_date between p_from and p_to
         and (rp.status = 'ignored' or (rp.status in ('open', 'contacted') and v_today > rp.expected_date + v_lost))) r;
  when 'recovered_revenue' then
    select coalesce(jsonb_agg(r order by r.purchase_date desc), '[]'::jsonb) into v from (
      select pu.purchase_date, c.full_name as customer, pr.name as product, rp.recovered_amount as amount
        from public.replenishment_predictions rp
        join public.purchases pu on pu.id = rp.completed_purchase_id
        join public.customers c on c.id = rp.customer_id join public.products pr on pr.id = rp.product_id
       where rp.organization_id = p_org and rp.recovered and pu.purchase_date between p_from and p_to) r;
  when 'recovery_rate' then
    select jsonb_build_array(jsonb_build_object(
      'predictions_due', count(*) filter (where status <> 'ignored'),
      'contacted', count(*) filter (where contacted_at is not null),
      'completed', count(*) filter (where status = 'completed'),
      'recovered', count(*) filter (where recovered),
      'repurchase_rate', round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status <> 'ignored'), 0), 1),
      'recovery_rate', round(100.0 * count(*) filter (where recovered) / nullif(count(*) filter (where contacted_at is not null), 0), 1)
    )) into v
      from public.replenishment_predictions
     where organization_id = p_org and expected_date between p_from and least(p_to, v_today);
  else
    raise exception 'INVALID_REPORT' using errcode = '22023';
  end case;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- LGPD: exportação dos dados de um cliente
-- ---------------------------------------------------------------------
create or replace function public.export_customer_data(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.customers where id = p_customer;
  if v_org is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform public._assert_member(v_org);
  return jsonb_build_object(
    'exported_at', now(),
    'customer', (select to_jsonb(c) - 'organization_id' - 'created_by' from public.customers c where c.id = p_customer),
    'pets', (select coalesce(jsonb_agg(to_jsonb(p) - 'organization_id'), '[]'::jsonb) from public.pets p where p.customer_id = p_customer),
    'purchases', (select coalesce(jsonb_agg(jsonb_build_object(
        'date', pu.purchase_date, 'total', pu.total,
        'items', (select jsonb_agg(jsonb_build_object('product', pr.name, 'quantity', pi.quantity, 'unit_price', pi.unit_price))
                    from public.purchase_items pi join public.products pr on pr.id = pi.product_id where pi.purchase_id = pu.id)
      ) order by pu.purchase_date), '[]'::jsonb) from public.purchases pu where pu.customer_id = p_customer),
    'contacts', (select coalesce(jsonb_agg(jsonb_build_object('at', cl.contacted_at, 'channel', cl.channel,
        'message', cl.message, 'result', cl.result) order by cl.contacted_at), '[]'::jsonb)
      from public.contact_logs cl where cl.customer_id = p_customer)
  );
end $$;

-- ---------------------------------------------------------------------
-- Permissões de execução
-- ---------------------------------------------------------------------
revoke execute on function public._assert_member(uuid, public.member_role[]) from public, anon, authenticated;
revoke execute on function public._assert_writable(uuid) from public, anon, authenticated;
revoke execute on function public._seed_default_templates(uuid) from public, anon, authenticated;
revoke execute on function public._apply_purchase_to_predictions(uuid, uuid, uuid, uuid, date, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.compute_expected_days(uuid, uuid, uuid, numeric, date) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.audit_row() from public, anon, authenticated;
revoke execute on function public.enforce_customer_limit() from public, anon, authenticated;

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;
