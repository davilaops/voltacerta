-- =====================================================================
-- VoltaCerta — 0005: planos configuráveis, pagamentos, Super Admin,
-- suspensão de estabelecimentos, bloqueio de usuários e endurecimento.
--
-- ADITIVA: não remove tabelas nem dados. Preserva organizações e
-- usuários existentes (backfill onde necessário).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Papel "staff" passa a se chamar "employee" (renomeação sem perda)
-- ---------------------------------------------------------------------
alter type public.member_role rename value 'staff' to 'employee';

-- ---------------------------------------------------------------------
-- 2. Planos centralizados (preços, limites e recursos em um só lugar)
-- ---------------------------------------------------------------------
create table public.plans (
  id public.plan_tier primary key,
  name text not null,
  price_cents int not null check (price_cents >= 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  customer_limit int check (customer_limit is null or customer_limit > 0),
  features jsonb not null default '{}'::jsonb,
  highlights text[] not null default '{}',
  sort_order int not null default 0,
  highlight boolean not null default false,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create trigger plans_updated_at before update on public.plans
  for each row execute function public.set_updated_at();

insert into public.plans (id, name, price_cents, customer_limit, features, highlights, sort_order, highlight) values
  ('inicial', 'Inicial', 3990, 100,
   '{"reports_full": false, "history_advanced": false, "reports_advanced": false}',
   array['Cadastro de produtos', 'Previsão de recompra', 'WhatsApp por link', 'Dashboard básico'], 1, false),
  ('profissional', 'Profissional', 6990, 500,
   '{"reports_full": true, "history_advanced": true, "reports_advanced": false}',
   array['Todas as funcionalidades', 'Relatórios completos', 'Histórico avançado'], 2, true),
  ('premium', 'Premium', 27990, null,
   '{"reports_full": true, "history_advanced": true, "reports_advanced": true}',
   array['Todas as funcionalidades', 'Relatórios avançados', 'Recursos futuros de automação'], 3, false);

alter table public.plans enable row level security;
-- Preços são públicos (landing page); escrita apenas via RPC de Super Admin.
create policy plans_public_read on public.plans for select to anon, authenticated using (active);
grant select on public.plans to anon;
revoke insert, update, delete on public.plans from anon, authenticated;

-- Limites e recursos agora leem a tabela de planos (fonte única)
create or replace function public.plan_customer_limit(p_plan public.plan_tier)
returns int language sql stable security definer set search_path = '' as $$
  select customer_limit from public.plans where id = p_plan;
$$;

create or replace function public.plan_allows(p_org uuid, p_feature text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select (p.features ->> p_feature)::boolean
      from public.subscriptions s join public.plans p on p.id = s.plan
     where s.organization_id = p_org
  ), false);
$$;

-- ---------------------------------------------------------------------
-- 3. Assinaturas: datas de início
-- ---------------------------------------------------------------------
alter table public.subscriptions
  add column trial_started_at timestamptz,
  add column current_period_start timestamptz;
update public.subscriptions set trial_started_at = created_at where trial_started_at is null and trial_ends_at is not null;

-- ---------------------------------------------------------------------
-- 4. Pagamentos (histórico de cobranças). Escrita só pelo backend
--    (service role / webhook). Nunca pelo navegador.
-- ---------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete set null,
  provider text not null,
  provider_payment_id text not null,
  payment_event_id uuid references public.payment_events (id) on delete set null,
  plan public.plan_tier,
  amount_cents int not null check (amount_cents >= 0),
  currency text not null default 'BRL',
  status text not null check (status in ('pending', 'paid', 'failed', 'refunded', 'canceled')),
  paid_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_payment_id)
);
create index payments_org_idx on public.payments (organization_id, created_at desc);
create index payments_paid_idx on public.payments (paid_at) where status = 'paid';
alter table public.payments enable row level security;
create policy payments_select on public.payments for select to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));

-- ---------------------------------------------------------------------
-- 5. Super Admin, bloqueio de usuários e suspensão de estabelecimentos
-- ---------------------------------------------------------------------
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by text not null default 'cli'
);
alter table public.platform_admins enable row level security; -- sem políticas: invisível ao cliente

alter table public.profiles
  add column blocked_at timestamptz,
  add column blocked_reason text check (char_length(blocked_reason) <= 500),
  add column blocked_by uuid references auth.users (id) on delete set null;

alter table public.organizations
  add column suspended_at timestamptz,
  add column suspended_reason text check (char_length(suspended_reason) <= 500),
  add column suspended_by uuid references auth.users (id) on delete set null;

create table public.admin_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_email text,
  action text not null,
  target_type text not null check (target_type in ('organization', 'user', 'subscription', 'plan', 'platform')),
  target_id text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_audit_logs_created_idx on public.admin_audit_logs (created_at desc);
create index admin_audit_logs_target_idx on public.admin_audit_logs (target_type, target_id);
alter table public.admin_audit_logs enable row level security; -- leitura só via RPC de Super Admin

-- Endurecimento: impede que o cliente altere colunas privilegiadas.
-- (antes, o UPDATE de perfil/organização liberava qualquer coluna)
revoke update on public.profiles from authenticated, anon;
grant update (full_name) on public.profiles to authenticated;
revoke update on public.organizations from authenticated, anon;
grant update (name, owner_name, phone, address, city, state, business_type, logo_path, timezone,
              soon_days, overdue_after_days, lost_after_days, default_duration_days,
              history_min_intervals, history_max_weight, attribution_days, onboarding_completed)
  on public.organizations to authenticated;

-- Usuário bloqueado perde acesso imediatamente a todos os dados (validado no banco)
create or replace function public.is_user_blocked(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select blocked_at is not null from public.profiles where id = p_user), false);
$$;

create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not public.is_user_blocked(auth.uid()) and exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(p_org uuid, p_roles public.member_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select not public.is_user_blocked(auth.uid()) and exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = auth.uid() and m.role = any (p_roles)
  );
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
     and not public.is_user_blocked(auth.uid())
     and exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

-- Estabelecimento suspenso: somente leitura
create or replace function public.org_can_write(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.subscription_effective_status(p_org) in ('trialing', 'active', 'past_due')
     and not exists (select 1 from public.organizations where id = p_org and suspended_at is not null);
$$;

-- ---------------------------------------------------------------------
-- 6. Equipe: renomeação de papel refletida nas regras
-- ---------------------------------------------------------------------
create or replace function public.remove_member(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._assert_member(p_org, array['owner', 'admin']::public.member_role[]);
  if p_user = auth.uid() then raise exception 'INVALID_ROLE_CHANGE' using errcode = 'P0001'; end if;
  delete from public.organization_members
   where organization_id = p_org and user_id = p_user and role <> 'owner'
     and (role = 'employee' or public.has_org_role(p_org, array['owner']::public.member_role[]));
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. Criação de organização idempotente (sem duplicatas em falhas/
--    cliques repetidos). Um segundo estabelecimento só com p_additional.
-- ---------------------------------------------------------------------
drop function public.create_organization(text, text, text, text, text, text);

create function public.create_organization(
  p_name text, p_owner_name text default null, p_phone text default null,
  p_city text default null, p_state text default null, p_business_type text default null,
  p_additional boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_uid uuid := auth.uid(); v_pending uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if public.is_user_blocked(v_uid) then raise exception 'USER_BLOCKED' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('create_org:' || v_uid::text));

  -- Retoma onboarding interrompido em vez de criar outra organização
  select o.id into v_pending
    from public.organizations o join public.organization_members m on m.organization_id = o.id
   where m.user_id = v_uid and m.role = 'owner' and not o.onboarding_completed
   order by o.created_at limit 1;
  if v_pending is not null then
    update public.organizations
       set name = trim(p_name), owner_name = nullif(trim(p_owner_name), ''), phone = nullif(trim(p_phone), ''),
           city = nullif(trim(p_city), ''), state = nullif(upper(trim(p_state)), ''), business_type = nullif(p_business_type, '')
     where id = v_pending;
    return v_pending;
  end if;

  if not p_additional and exists (select 1 from public.organization_members where user_id = v_uid and role = 'owner') then
    raise exception 'ORG_ALREADY_EXISTS' using errcode = 'P0001';
  end if;
  if (select count(*) from public.organization_members where user_id = v_uid and role = 'owner') >= 3 then
    raise exception 'ORG_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  insert into public.organizations (name, owner_name, phone, city, state, business_type)
  values (trim(p_name), nullif(trim(p_owner_name), ''), nullif(trim(p_phone), ''), nullif(trim(p_city), ''),
          nullif(upper(trim(p_state)), ''), nullif(p_business_type, ''))
  returning id into v_org;
  insert into public.organization_members (organization_id, user_id, role) values (v_org, v_uid, 'owner');
  -- Trial de 14 dias com recursos do Profissional. Nenhum pagamento é simulado.
  insert into public.subscriptions (organization_id, plan, status, trial_started_at, trial_ends_at)
  values (v_org, 'profissional', 'trialing', now(), now() + interval '14 days');
  perform public._seed_default_templates(v_org);
  if nullif(trim(p_owner_name), '') is not null then
    update public.profiles set full_name = trim(p_owner_name) where id = v_uid and full_name is null;
  end if;
  return v_org;
end $$;

-- ---------------------------------------------------------------------
-- 8. Contexto da organização inclui suspensão
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
    'trial_started_at', s.trial_started_at,
    'trial_ends_at', s.trial_ends_at,
    'current_period_end', s.current_period_end,
    'can_write', public.org_can_write(p_org),
    'suspended', o.suspended_at is not null,
    'suspended_reason', o.suspended_reason,
    'customer_limit', public.plan_customer_limit(s.plan),
    'customer_count', (select count(*) from public.customers where organization_id = p_org),
    'features', jsonb_build_object(
      'reports_full', public.plan_allows(p_org, 'reports_full'),
      'history_advanced', public.plan_allows(p_org, 'history_advanced'),
      'reports_advanced', public.plan_allows(p_org, 'reports_advanced')),
    'today', public.org_today(p_org)
  ) into v
  from public.subscriptions s join public.organizations o on o.id = s.organization_id
  where s.organization_id = p_org;
  return v;
end $$;

-- Situação da conta do usuário atual (usada pelo app e pelo painel admin)
create or replace function public.get_account_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'authenticated', auth.uid() is not null,
    'blocked', public.is_user_blocked(auth.uid()),
    'blocked_reason', (select blocked_reason from public.profiles where id = auth.uid()),
    'super_admin', public.is_super_admin()
  );
$$;

-- ---------------------------------------------------------------------
-- 9. RPCs do painel Super Admin (autorização validada no banco)
-- ---------------------------------------------------------------------
create or replace function public._assert_super_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
end $$;

create or replace function public._admin_log(p_action text, p_target_type text, p_target_id text, p_reason text, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.admin_audit_logs (actor_id, actor_email, action, target_type, target_id, reason, details)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), p_action, p_target_type, p_target_id, p_reason, p_details);
$$;

create or replace function public._require_reason(p_reason text)
returns text language plpgsql immutable set search_path = '' as $$
begin
  if p_reason is null or char_length(trim(p_reason)) < 5 then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  return left(trim(p_reason), 500);
end $$;

create or replace function public.admin_overview(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._assert_super_admin();
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    raise exception 'INVALID_PERIOD' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'organizations_total', (select count(*) from public.organizations),
    'organizations_suspended', (select count(*) from public.organizations where suspended_at is not null),
    'users_total', (select count(*) from auth.users),
    'users_blocked', (select count(*) from public.profiles where blocked_at is not null),
    'subscriptions_active', (select count(*) from public.subscriptions s where public.subscription_effective_status(s.organization_id) = 'active'),
    'trials_active', (select count(*) from public.subscriptions s where public.subscription_effective_status(s.organization_id) = 'trialing'),
    'trials_ended', (select count(*) from public.subscriptions s where s.status in ('trialing', 'expired') and public.subscription_effective_status(s.organization_id) = 'expired'),
    'subscriptions_past_due', (select count(*) from public.subscriptions where status = 'past_due'),
    'subscriptions_canceled', (select count(*) from public.subscriptions where status = 'canceled'),
    -- Receita efetivamente RECEBIDA nos últimos 30 dias (pagamentos confirmados)
    'mrr_received_cents', (select coalesce(sum(amount_cents), 0) from public.payments where status = 'paid' and paid_at >= now() - interval '30 days'),
    'signups', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', d.day,
        'organizations', (select count(*) from public.organizations o where (o.created_at at time zone 'America/Sao_Paulo')::date = d.day),
        'users', (select count(*) from auth.users u where (u.created_at at time zone 'America/Sao_Paulo')::date = d.day)
      ) order by d.day), '[]'::jsonb)
      from (select gs::date as day from generate_series(p_from, p_to, interval '1 day') gs) d
    )
  );
end $$;

create or replace function public.admin_list_organizations(p_search text default null, p_status text default null, p_limit int default 25, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_rows jsonb; v_total int; v_search text := nullif(trim(p_search), '');
begin
  perform public._assert_super_admin();
  with base as (
    select o.id, o.name, o.city, o.state, o.created_at, o.suspended_at, o.suspended_reason,
           s.plan, s.status, public.subscription_effective_status(o.id) as effective_status,
           s.trial_ends_at, s.current_period_end,
           (select count(*) from public.organization_members m where m.organization_id = o.id) as members,
           (select count(*) from public.customers c where c.organization_id = o.id) as customers,
           (select u.email from public.organization_members m join auth.users u on u.id = m.user_id
             where m.organization_id = o.id and m.role = 'owner' limit 1) as owner_email
      from public.organizations o left join public.subscriptions s on s.organization_id = o.id
  ), filtered as (
    select * from base
     where (v_search is null or name ilike '%' || v_search || '%' or owner_email ilike '%' || v_search || '%' or city ilike '%' || v_search || '%')
       and (p_status is null or p_status = ''
            or (p_status = 'suspended' and suspended_at is not null)
            or (p_status <> 'suspended' and effective_status::text = p_status))
  )
  select (select count(*) from filtered),
         coalesce((select jsonb_agg(f order by f.created_at desc) from (select * from filtered order by created_at desc limit least(p_limit, 100) offset greatest(p_offset, 0)) f), '[]'::jsonb)
    into v_total, v_rows;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

create or replace function public.admin_get_organization(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public._assert_super_admin();
  select jsonb_build_object(
    'organization', to_jsonb(o) - 'logo_path',
    'subscription', (select to_jsonb(s) || jsonb_build_object('effective_status', public.subscription_effective_status(o.id)) from public.subscriptions s where s.organization_id = o.id),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role, 'email', u.email, 'full_name', p.full_name,
                    'created_at', m.created_at, 'blocked_at', p.blocked_at) order by m.created_at), '[]'::jsonb)
                  from public.organization_members m join auth.users u on u.id = m.user_id left join public.profiles p on p.id = m.user_id
                 where m.organization_id = o.id),
    'counts', jsonb_build_object(
       'customers', (select count(*) from public.customers where organization_id = o.id),
       'products', (select count(*) from public.products where organization_id = o.id),
       'purchases', (select count(*) from public.purchases where organization_id = o.id),
       'contacts', (select count(*) from public.contact_logs where organization_id = o.id)),
    'payments', (select coalesce(jsonb_agg(to_jsonb(pm) order by pm.created_at desc), '[]'::jsonb) from (select * from public.payments where organization_id = o.id order by created_at desc limit 50) pm),
    'audit', (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
                from (select * from public.admin_audit_logs where target_id = o.id::text order by created_at desc limit 30) a)
  ) into v
  from public.organizations o where o.id = p_org;
  if v is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return v;
end $$;

create or replace function public.admin_suspend_organization(p_org uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_reason text;
begin
  perform public._assert_super_admin();
  v_reason := public._require_reason(p_reason);
  update public.organizations set suspended_at = now(), suspended_reason = v_reason, suspended_by = auth.uid()
   where id = p_org and suspended_at is null;
  if not found then raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001'; end if;
  perform public._admin_log('suspend_organization', 'organization', p_org::text, v_reason);
end $$;

create or replace function public.admin_reactivate_organization(p_org uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_reason text;
begin
  perform public._assert_super_admin();
  v_reason := public._require_reason(p_reason);
  update public.organizations set suspended_at = null, suspended_reason = null, suspended_by = null
   where id = p_org and suspended_at is not null;
  if not found then raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001'; end if;
  perform public._admin_log('reactivate_organization', 'organization', p_org::text, v_reason);
end $$;

-- Concede/estende trial. Nunca rebaixa assinatura paga ativa.
create or replace function public.admin_grant_trial(p_org uuid, p_days int, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_reason text; v_old public.subscriptions;
begin
  perform public._assert_super_admin();
  v_reason := public._require_reason(p_reason);
  if p_days is null or p_days < 1 or p_days > 90 then raise exception 'INVALID_DAYS' using errcode = '22023'; end if;
  select * into v_old from public.subscriptions where organization_id = p_org for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_old.status = 'active' then raise exception 'SUBSCRIPTION_ALREADY_ACTIVE' using errcode = 'P0001'; end if;
  update public.subscriptions
     set status = 'trialing', trial_started_at = now(), trial_ends_at = now() + make_interval(days => p_days)
   where organization_id = p_org;
  perform public._admin_log('grant_trial', 'subscription', p_org::text, v_reason,
    jsonb_build_object('days', p_days, 'previous_status', v_old.status, 'previous_trial_ends_at', v_old.trial_ends_at));
end $$;

-- Altera somente o PLANO (limites/recursos). Não altera status nem marca como pago.
create or replace function public.admin_change_plan(p_org uuid, p_plan public.plan_tier, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_reason text; v_old public.plan_tier;
begin
  perform public._assert_super_admin();
  v_reason := public._require_reason(p_reason);
  select plan into v_old from public.subscriptions where organization_id = p_org for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_old = p_plan then return; end if;
  update public.subscriptions set plan = p_plan where organization_id = p_org;
  perform public._admin_log('change_plan', 'subscription', p_org::text, v_reason, jsonb_build_object('from', v_old, 'to', p_plan));
end $$;

create or replace function public.admin_list_users(p_search text default null, p_limit int default 25, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_rows jsonb; v_total int; v_search text := nullif(trim(p_search), '');
begin
  perform public._assert_super_admin();
  with base as (
    select u.id, u.email, u.created_at, u.last_sign_in_at, u.email_confirmed_at, p.full_name, p.blocked_at, p.blocked_reason,
           exists (select 1 from public.platform_admins a where a.user_id = u.id) as super_admin,
           (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'role', m.role)), '[]'::jsonb)
              from public.organization_members m join public.organizations o on o.id = m.organization_id where m.user_id = u.id) as organizations
      from auth.users u left join public.profiles p on p.id = u.id
  ), filtered as (
    select * from base where v_search is null or email ilike '%' || v_search || '%' or full_name ilike '%' || v_search || '%'
  )
  select (select count(*) from filtered),
         coalesce((select jsonb_agg(f order by f.created_at desc) from (select * from filtered order by created_at desc limit least(p_limit, 100) offset greatest(p_offset, 0)) f), '[]'::jsonb)
    into v_total, v_rows;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

create or replace function public.admin_block_user(p_user uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_reason text;
begin
  perform public._assert_super_admin();
  v_reason := public._require_reason(p_reason);
  if p_user = auth.uid() then raise exception 'CANNOT_BLOCK_SELF' using errcode = 'P0001'; end if;
  if exists (select 1 from public.platform_admins where user_id = p_user) then
    raise exception 'CANNOT_BLOCK_ADMIN' using errcode = 'P0001';
  end if;
  update public.profiles set blocked_at = now(), blocked_reason = v_reason, blocked_by = auth.uid()
   where id = p_user and blocked_at is null;
  if not found then raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001'; end if;
  perform public._admin_log('block_user', 'user', p_user::text, v_reason);
end $$;

create or replace function public.admin_unblock_user(p_user uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_reason text;
begin
  perform public._assert_super_admin();
  v_reason := public._require_reason(p_reason);
  update public.profiles set blocked_at = null, blocked_reason = null, blocked_by = null
   where id = p_user and blocked_at is not null;
  if not found then raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001'; end if;
  perform public._admin_log('unblock_user', 'user', p_user::text, v_reason);
end $$;

create or replace function public.admin_list_payments(p_org uuid default null, p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._assert_super_admin();
  return jsonb_build_object(
    'total', (select count(*) from public.payments where p_org is null or organization_id = p_org),
    'rows', (select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb) from (
      select pm.*, o.name as organization_name from public.payments pm left join public.organizations o on o.id = pm.organization_id
       where p_org is null or pm.organization_id = p_org
       order by pm.created_at desc limit least(p_limit, 200) offset greatest(p_offset, 0)) r));
end $$;

create or replace function public.admin_list_audit(p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._assert_super_admin();
  return jsonb_build_object(
    'total', (select count(*) from public.admin_audit_logs),
    'rows', (select coalesce(jsonb_agg(a order by a.created_at desc), '[]'::jsonb)
               from (select * from public.admin_audit_logs order by created_at desc limit least(p_limit, 200) offset greatest(p_offset, 0)) a));
end $$;

-- Edição de plano (preço/limite) centralizada, auditada
create or replace function public.admin_update_plan(p_plan public.plan_tier, p_price_cents int, p_customer_limit int, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_reason text; v_old public.plans;
begin
  perform public._assert_super_admin();
  v_reason := public._require_reason(p_reason);
  if p_price_cents is null or p_price_cents < 0 or p_price_cents > 10000000 then raise exception 'INVALID_PRICE' using errcode = '22023'; end if;
  if p_customer_limit is not null and p_customer_limit < 1 then raise exception 'INVALID_LIMIT' using errcode = '22023'; end if;
  select * into v_old from public.plans where id = p_plan for update;
  update public.plans set price_cents = p_price_cents, customer_limit = p_customer_limit where id = p_plan;
  perform public._admin_log('update_plan', 'plan', p_plan::text, v_reason,
    jsonb_build_object('price_cents', jsonb_build_object('from', v_old.price_cents, 'to', p_price_cents),
                       'customer_limit', jsonb_build_object('from', v_old.customer_limit, 'to', p_customer_limit)));
end $$;

-- ---------------------------------------------------------------------
-- 10. Promoção do primeiro Super Admin — SOMENTE pelo backend.
--     Executável apenas por postgres/service_role (CLI ou Edge Function),
--     nunca pelo navegador. Ver scripts/promote-super-admin.mjs.
-- ---------------------------------------------------------------------
create or replace function public.promote_super_admin(p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_already boolean;
begin
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then raise exception 'USER_NOT_FOUND: %', p_email using errcode = 'P0002'; end if;
  select exists (select 1 from public.platform_admins where user_id = v_user) into v_already;
  insert into public.platform_admins (user_id, granted_by) values (v_user, 'cli') on conflict (user_id) do nothing;
  -- Espelha o papel no app_metadata (só o backend altera app_metadata)
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role": "super_admin"}'::jsonb
   where id = v_user;
  insert into public.admin_audit_logs (actor_id, actor_email, action, target_type, target_id, reason, details)
  values (null, 'system:cli', 'promote_super_admin', 'user', v_user::text, 'Promoção via procedimento de backend',
          jsonb_build_object('email', lower(trim(p_email)), 'already_admin', v_already));
  return jsonb_build_object('user_id', v_user, 'email', lower(trim(p_email)), 'already_admin', v_already, 'super_admin', true);
end $$;

create or replace function public.revoke_super_admin(p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then raise exception 'USER_NOT_FOUND: %', p_email using errcode = 'P0002'; end if;
  delete from public.platform_admins where user_id = v_user;
  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'role' where id = v_user;
  insert into public.admin_audit_logs (actor_id, actor_email, action, target_type, target_id, reason)
  values (null, 'system:cli', 'revoke_super_admin', 'user', v_user::text, 'Revogação via procedimento de backend');
  return jsonb_build_object('user_id', v_user, 'super_admin', false);
end $$;

-- ---------------------------------------------------------------------
-- 11. Permissões de execução
-- ---------------------------------------------------------------------
revoke execute on function public.promote_super_admin(text) from public, anon, authenticated;
revoke execute on function public.revoke_super_admin(text) from public, anon, authenticated;
revoke execute on function public._assert_super_admin() from public, anon, authenticated;
revoke execute on function public._admin_log(text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public._require_reason(text) from public, anon, authenticated;
revoke execute on all functions in schema public from anon;
revoke all on public.payments, public.platform_admins, public.admin_audit_logs from anon;
