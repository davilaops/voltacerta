-- =====================================================================
-- VoltaCerta — 0002: dados comerciais (clientes, pets, produtos,
-- compras, previsões, contatos, modelos de mensagem, auditoria).
-- Chaves estrangeiras compostas (id, organization_id) impedem que um
-- registro aponte para dados de outra organização.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 2 and 120),
  phone text check (char_length(phone) <= 30),
  phone_normalized text,
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  notes text check (char_length(notes) <= 2000),
  -- LGPD: consentimento e oposição ao contato comercial
  marketing_consent boolean not null default false,
  consent_updated_at timestamptz,
  do_not_contact boolean not null default false,
  do_not_contact_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index customers_org_phone_uq on public.customers (organization_id, phone_normalized)
  where phone_normalized is not null;
create index customers_org_name_idx on public.customers (organization_id, lower(full_name));
create index customers_org_created_idx on public.customers (organization_id, created_at);

create or replace function public.customers_before_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.full_name := trim(new.full_name);
  new.email := nullif(lower(trim(new.email)), '');
  new.phone := nullif(trim(new.phone), '');
  new.phone_normalized := public.normalize_phone(new.phone);
  if new.phone is not null and new.phone_normalized is null then
    raise exception 'INVALID_PHONE' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    if new.marketing_consent then new.consent_updated_at := now(); end if;
    if new.do_not_contact then new.do_not_contact_at := now(); end if;
  else
    new.organization_id := old.organization_id; -- tenant é imutável
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if new.marketing_consent is distinct from old.marketing_consent then new.consent_updated_at := now(); end if;
    if new.do_not_contact is distinct from old.do_not_contact then
      new.do_not_contact_at := case when new.do_not_contact then now() else null end;
    end if;
  end if;
  return new;
end $$;
create trigger customers_before_write before insert or update on public.customers
  for each row execute function public.customers_before_write();
create trigger customers_updated_at before update on public.customers
  for each row execute function public.set_updated_at();

-- Limite de clientes por plano (aplicado no banco)
create or replace function public.enforce_customer_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_plan public.plan_tier; v_limit int; v_count int;
begin
  select plan into v_plan from public.subscriptions where organization_id = new.organization_id;
  v_limit := public.plan_customer_limit(coalesce(v_plan, 'inicial'));
  if v_limit is null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('customers:' || new.organization_id::text));
  select count(*) into v_count from public.customers where organization_id = new.organization_id;
  if v_count >= v_limit then
    raise exception 'PLAN_LIMIT_CUSTOMERS' using errcode = 'P0001',
      detail = format('Seu plano permite até %s clientes.', v_limit);
  end if;
  return new;
end $$;
create trigger customers_plan_limit before insert on public.customers
  for each row execute function public.enforce_customer_limit();

-- ---------------------------------------------------------------------
-- Pets
-- ---------------------------------------------------------------------
create table public.pets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 80),
  species text not null default 'cao' check (species in ('cao', 'gato', 'ave', 'roedor', 'peixe', 'reptil', 'outro')),
  breed text check (char_length(breed) <= 80),
  birth_date date check (birth_date > date '1980-01-01'),
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade,
  unique (id, organization_id)
);
create index pets_customer_idx on public.pets (customer_id);

-- ---------------------------------------------------------------------
-- Produtos
-- ---------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 120),
  category public.product_category not null default 'outros',
  brand text check (char_length(brand) <= 80),
  sku text check (char_length(sku) <= 60),
  price numeric(12,2) not null default 0 check (price >= 0),
  cost numeric(12,2) check (cost >= 0),
  size_value numeric(10,3) check (size_value > 0),
  unit text not null default 'un' check (unit in ('kg', 'g', 'l', 'ml', 'un', 'cx', 'pct')),
  description text check (char_length(description) <= 1000),
  avg_duration_days int check (avg_duration_days between 1 and 365),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index products_org_sku_uq on public.products (organization_id, lower(sku)) where sku is not null;
create index products_org_name_idx on public.products (organization_id, lower(name));
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();

create or replace function public.products_lock_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.organization_id := old.organization_id;
  new.sku := nullif(trim(new.sku), '');
  return new;
end $$;
create trigger products_lock_tenant before update on public.products
  for each row execute function public.products_lock_tenant();

-- ---------------------------------------------------------------------
-- Compras e itens (escrita somente via RPC create_purchase / delete_purchase)
-- ---------------------------------------------------------------------
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid not null,
  purchase_date date not null,
  subtotal numeric(12,2) not null check (subtotal >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  total numeric(12,2) not null check (total >= 0),
  notes text check (char_length(notes) <= 1000),
  client_request_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade,
  unique (id, organization_id)
);
create unique index purchases_request_uq on public.purchases (organization_id, client_request_id)
  where client_request_id is not null;
create index purchases_org_date_idx on public.purchases (organization_id, purchase_date desc);
create index purchases_customer_idx on public.purchases (customer_id, purchase_date desc);

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  purchase_id uuid not null,
  product_id uuid not null,
  quantity numeric(10,2) not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0), -- preço histórico
  discount numeric(12,2) not null default 0 check (discount >= 0),
  total numeric(12,2) not null check (total >= 0),
  foreign key (purchase_id, organization_id) references public.purchases (id, organization_id) on delete cascade,
  foreign key (product_id, organization_id) references public.products (id, organization_id) on delete restrict
);
create index purchase_items_purchase_idx on public.purchase_items (purchase_id);
create index purchase_items_product_idx on public.purchase_items (organization_id, product_id);

-- ---------------------------------------------------------------------
-- Previsões de recompra (escrita somente via RPCs)
-- ---------------------------------------------------------------------
create table public.replenishment_predictions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  product_id uuid not null,
  source_purchase_id uuid not null,
  expected_date date not null,
  quantity numeric(10,2) not null,
  expected_days int not null,
  base_days int not null,
  history_days numeric(10,2),
  history_samples int not null default 0,
  potential_value numeric(12,2) not null default 0,
  status public.prediction_status not null default 'open',
  contacted_at timestamptz,
  completed_at timestamptz,
  completed_purchase_id uuid references public.purchases (id) on delete set null,
  recovered boolean not null default false,
  recovered_amount numeric(12,2) not null default 0,
  ignored_reason text check (char_length(ignored_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade,
  foreign key (product_id, organization_id) references public.products (id, organization_id) on delete restrict,
  foreign key (source_purchase_id, organization_id) references public.purchases (id, organization_id) on delete cascade,
  unique (id, organization_id)
);
-- No máximo UMA previsão ativa por cliente+produto (evita duplicidade)
create unique index predictions_active_uq on public.replenishment_predictions (organization_id, customer_id, product_id)
  where status in ('open', 'contacted');
create index predictions_org_status_date_idx on public.replenishment_predictions (organization_id, status, expected_date);
create index predictions_customer_idx on public.replenishment_predictions (customer_id);
create index predictions_completed_idx on public.replenishment_predictions (organization_id, completed_at) where status = 'completed';
create trigger predictions_updated_at before update on public.replenishment_predictions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Modelos de mensagem
-- ---------------------------------------------------------------------
create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 80),
  kind text not null default 'custom' check (kind in ('reposicao', 'atrasado', 'recompra', 'custom')),
  body text not null check (char_length(trim(body)) between 5 and 1000),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index message_templates_org_idx on public.message_templates (organization_id);
create trigger message_templates_updated_at before update on public.message_templates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Histórico de contatos (escrita somente via RPC log_contact)
-- Canal preparado para futura integração com WhatsApp Business Cloud API.
-- ---------------------------------------------------------------------
create table public.contact_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  prediction_id uuid references public.replenishment_predictions (id) on delete set null,
  template_id uuid references public.message_templates (id) on delete set null,
  channel text not null default 'whatsapp_link' check (channel in ('whatsapp_link', 'whatsapp_api', 'phone', 'in_person')),
  message text check (char_length(message) <= 2000),
  result public.contact_result not null,
  follow_up_date date,
  notes text check (char_length(notes) <= 1000),
  external_message_id text, -- reservado para a API oficial
  user_id uuid references auth.users (id) on delete set null,
  contacted_at timestamptz not null default now(),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade
);
create index contact_logs_org_date_idx on public.contact_logs (organization_id, contacted_at desc);
create index contact_logs_customer_idx on public.contact_logs (customer_id, contacted_at desc);
create index contact_logs_user_idx on public.contact_logs (user_id, contacted_at desc);

-- ---------------------------------------------------------------------
-- Auditoria (somente leitura para owner/admin; escrita por triggers)
-- Não armazena dados pessoais: apenas ids e nomes de colunas alteradas.
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null, -- sem FK: o registro sobrevive à exclusão em cascata
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_org_idx on public.audit_logs (organization_id, created_at desc);

create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_row jsonb; v_old jsonb; v_changed text[];
begin
  if tg_op = 'DELETE' then v_row := to_jsonb(old); else v_row := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    select array_agg(key) into v_changed from jsonb_each(v_row) n
      where n.value is distinct from v_old -> n.key and key not in ('updated_at');
    if v_changed is null then return new; end if;
  end if;
  insert into public.audit_logs (organization_id, actor_id, action, entity, entity_id, details)
  values ((v_row ->> 'organization_id')::uuid, auth.uid(), lower(tg_op), tg_table_name,
          nullif(v_row ->> 'id', '')::uuid,
          case when v_changed is not null then jsonb_build_object('changed', to_jsonb(v_changed)) else '{}'::jsonb end);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger audit_customers after insert or update or delete on public.customers
  for each row execute function public.audit_row();
create trigger audit_products after insert or update or delete on public.products
  for each row execute function public.audit_row();
create trigger audit_purchases after insert or delete on public.purchases
  for each row execute function public.audit_row();
create trigger audit_templates after insert or update or delete on public.message_templates
  for each row execute function public.audit_row();

-- Solicitações de exclusão da conta/estabelecimento (LGPD)
create table public.data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  reason text check (char_length(reason) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'rejected')),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create unique index data_deletion_requests_pending_uq on public.data_deletion_requests (organization_id)
  where status in ('pending', 'processing');

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.customers enable row level security;
alter table public.pets enable row level security;
alter table public.products enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.replenishment_predictions enable row level security;
alter table public.message_templates enable row level security;
alter table public.contact_logs enable row level security;
alter table public.audit_logs enable row level security;
alter table public.data_deletion_requests enable row level security;

-- Clientes: membros leem/criam/editam; somente owner/admin excluem.
create policy customers_select on public.customers for select to authenticated
  using (public.is_org_member(organization_id));
create policy customers_insert on public.customers for insert to authenticated
  with check (public.is_org_member(organization_id) and public.org_can_write(organization_id));
create policy customers_update on public.customers for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id) and public.org_can_write(organization_id));
create policy customers_delete on public.customers for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));

create policy pets_select on public.pets for select to authenticated
  using (public.is_org_member(organization_id));
create policy pets_insert on public.pets for insert to authenticated
  with check (public.is_org_member(organization_id) and public.org_can_write(organization_id));
create policy pets_update on public.pets for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id) and public.org_can_write(organization_id));
create policy pets_delete on public.pets for delete to authenticated
  using (public.is_org_member(organization_id));

create policy products_select on public.products for select to authenticated
  using (public.is_org_member(organization_id));
create policy products_insert on public.products for insert to authenticated
  with check (public.is_org_member(organization_id) and public.org_can_write(organization_id));
create policy products_update on public.products for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id) and public.org_can_write(organization_id));
create policy products_delete on public.products for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));

-- Somente leitura direta; escrita pelas RPCs SECURITY DEFINER validadas.
create policy purchases_select on public.purchases for select to authenticated
  using (public.is_org_member(organization_id));
create policy purchase_items_select on public.purchase_items for select to authenticated
  using (public.is_org_member(organization_id));
create policy predictions_select on public.replenishment_predictions for select to authenticated
  using (public.is_org_member(organization_id));
create policy contact_logs_select on public.contact_logs for select to authenticated
  using (public.is_org_member(organization_id));

create policy templates_select on public.message_templates for select to authenticated
  using (public.is_org_member(organization_id));
create policy templates_insert on public.message_templates for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));
create policy templates_update on public.message_templates for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));
create policy templates_delete on public.message_templates for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));

create policy audit_select on public.audit_logs for select to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));

create policy deletion_requests_select on public.data_deletion_requests for select to authenticated
  using (public.has_org_role(organization_id, array['owner']::public.member_role[]));
create policy deletion_requests_insert on public.data_deletion_requests for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner']::public.member_role[]) and requested_by = auth.uid());
