-- =====================================================================
-- VoltaCerta — 0001: esquema base multi-tenant
-- Tabelas, tipos, funções auxiliares de autorização e políticas RLS.
-- Toda tabela com dados privados tem RLS habilitado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.member_role as enum ('owner', 'admin', 'staff');
create type public.plan_tier as enum ('inicial', 'profissional', 'premium');
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'canceled', 'expired');
create type public.prediction_status as enum ('open', 'contacted', 'completed', 'ignored');
create type public.contact_result as enum ('respondeu', 'nao_respondeu', 'comprou', 'sem_interesse', 'retornar_depois');
create type public.product_category as enum ('racoes', 'petiscos', 'areia', 'medicamentos', 'higiene', 'acessorios', 'outros');

-- ---------------------------------------------------------------------
-- Utilitários genéricos
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Normaliza telefone brasileiro para dígitos com DDI 55.
-- '(11) 98888-7777' -> '5511988887777'. Retorna null se inválido/vazio.
create or replace function public.normalize_phone(p text)
returns text language plpgsql immutable set search_path = '' as $$
declare d text;
begin
  if p is null then return null; end if;
  d := regexp_replace(p, '\D', '', 'g');
  if d = '' then return null; end if;
  d := regexp_replace(d, '^0+', '');
  if length(d) in (10, 11) then d := '55' || d; end if;
  if length(d) < 10 or length(d) > 15 then return null; end if;
  return d;
end $$;

-- ---------------------------------------------------------------------
-- Perfis (1:1 com auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (char_length(full_name) <= 120),
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Organizações (tenants) e configurações de recompra
-- ---------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  owner_name text check (char_length(owner_name) <= 120),
  phone text check (char_length(phone) <= 30),
  address text check (char_length(address) <= 200),
  city text check (char_length(city) <= 80),
  state text check (state ~ '^[A-Z]{2}$'),
  business_type text check (business_type in ('pet_shop', 'loja_racao', 'veterinario', 'delivery', 'rede', 'outro')),
  logo_path text,
  timezone text not null default 'America/Sao_Paulo',
  -- Motor de previsão (configurável por estabelecimento)
  soon_days int not null default 7 check (soon_days between 1 and 60),
  overdue_after_days int not null default 0 check (overdue_after_days between 0 and 30),
  lost_after_days int not null default 30 check (lost_after_days between 7 and 365),
  default_duration_days int not null default 30 check (default_duration_days between 1 and 365),
  history_min_intervals int not null default 2 check (history_min_intervals between 1 and 10),
  history_max_weight numeric(3,2) not null default 0.70 check (history_max_weight between 0 and 1),
  attribution_days int not null default 30 check (attribution_days between 1 and 120),
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.member_role not null default 'staff' check (role <> 'owner'),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create unique index organization_invitations_pending_uq
  on public.organization_invitations (organization_id, email) where accepted_at is null;
create index organization_invitations_email_idx on public.organization_invitations (email) where accepted_at is null;

-- ---------------------------------------------------------------------
-- Assinaturas e eventos de pagamento
-- Usuários só LEEM. Escrita apenas via service role (Edge Functions).
-- ---------------------------------------------------------------------
create table public.subscriptions (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  plan public.plan_tier not null default 'profissional',
  status public.subscription_status not null default 'trialing',
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  canceled_at timestamptz,
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();
create unique index subscriptions_provider_sub_uq on public.subscriptions (provider, provider_subscription_id)
  where provider_subscription_id is not null;

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text not null,
  organization_id uuid references public.organizations (id) on delete set null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  unique (provider, event_id)
);

-- ---------------------------------------------------------------------
-- Funções de autorização (SECURITY DEFINER para evitar recursão de RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(p_org uuid, p_roles public.member_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = auth.uid() and m.role = any (p_roles)
  );
$$;

create or replace function public.shares_org_with(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members a
    join public.organization_members b on b.organization_id = a.organization_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

-- Data local do estabelecimento (fuso horário brasileiro por padrão)
create or replace function public.org_today(p_org uuid)
returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce(
    (select o.timezone from public.organizations o where o.id = p_org), 'America/Sao_Paulo'))::date;
$$;

-- Status efetivo (trial vencido => expired; período pago vencido há >7 dias => expired)
create or replace function public.subscription_effective_status(p_org uuid)
returns public.subscription_status language sql stable security definer set search_path = '' as $$
  select case
    when s.organization_id is null then 'expired'::public.subscription_status
    when s.status = 'trialing' and s.trial_ends_at < now() then 'expired'::public.subscription_status
    when s.status = 'canceled' and s.current_period_end is not null and s.current_period_end > now()
      then 'active'::public.subscription_status
    else s.status
  end
  from (select 1) x
  left join public.subscriptions s on s.organization_id = p_org;
$$;

create or replace function public.org_can_write(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.subscription_effective_status(p_org) in ('trialing', 'active', 'past_due');
$$;

create or replace function public.plan_customer_limit(p_plan public.plan_tier)
returns int language sql immutable set search_path = '' as $$
  select case p_plan when 'inicial' then 100 when 'profissional' then 500 else null end;
$$;

-- Recursos por plano. Verificado no backend (RPCs/RLS), não só na interface.
create or replace function public.plan_allows(p_org uuid, p_feature text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case p_feature
      when 'reports_full' then s.plan in ('profissional', 'premium')
      when 'history_advanced' then s.plan in ('profissional', 'premium')
      when 'reports_advanced' then s.plan = 'premium'
      else false
    end
    from public.subscriptions s where s.organization_id = p_org
  ), false);
$$;

-- ---------------------------------------------------------------------
-- RLS: perfis / organizações / membros / convites / assinaturas
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payment_events enable row level security; -- sem políticas: só service role

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_org_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy organizations_select on public.organizations for select to authenticated
  using (public.is_org_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (public.has_org_role(id, array['owner', 'admin']::public.member_role[]))
  with check (public.has_org_role(id, array['owner', 'admin']::public.member_role[]));

create policy members_select on public.organization_members for select to authenticated
  using (public.is_org_member(organization_id));

create policy invitations_select on public.organization_invitations for select to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));
create policy invitations_insert on public.organization_invitations for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[])
              and invited_by = auth.uid() and accepted_at is null);
create policy invitations_delete on public.organization_invitations for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));

create policy subscriptions_select on public.subscriptions for select to authenticated
  using (public.is_org_member(organization_id));
