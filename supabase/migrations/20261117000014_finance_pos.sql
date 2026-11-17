-- =====================================================================
-- VoltaCerta — 0014: financeiro (contas a pagar/receber, fluxo de caixa),
-- caixa (PDV) e cobrança de atendimentos e pacotes.
-- Aditiva:
-- * purchases.customer_id passa a aceitar nulo (venda de balcão sem
--   cliente identificado). Vendas com cliente seguem alimentando as
--   previsões de recompra exatamente como antes.
-- * Toda venda gera lançamento(s) de receita em finance_entries. As vendas
--   já existentes recebem um lançamento "pago / não informado" na data da
--   compra (backfill), para o relatório financeiro refletir o histórico.
-- =====================================================================

alter table public.purchases alter column customer_id drop not null;
alter table public.purchases
  add column channel text not null default 'registro' check (channel in ('registro', 'pdv', 'agenda', 'pacote')),
  add column cash_session_id uuid;

-- ---------------------------------------------------------------------
-- Itens de serviço em uma venda (banho avulso, atendimento da agenda, pacote)
-- ---------------------------------------------------------------------
create table public.purchase_services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  purchase_id uuid not null,
  service_id uuid not null,
  appointment_id uuid references public.appointments (id) on delete set null,
  customer_package_id uuid references public.customer_packages (id) on delete set null,
  description text check (char_length(description) <= 160),
  quantity numeric(10,2) not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  total numeric(12,2) not null check (total >= 0),
  foreign key (purchase_id, organization_id) references public.purchases (id, organization_id) on delete cascade,
  foreign key (service_id, organization_id) references public.services (id, organization_id)
);
create index purchase_services_purchase_idx on public.purchase_services (purchase_id);
create index purchase_services_appt_idx on public.purchase_services (appointment_id) where appointment_id is not null;

-- ---------------------------------------------------------------------
-- Caixa
-- ---------------------------------------------------------------------
create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'closed')),
  opening_amount numeric(12,2) not null default 0 check (opening_amount >= 0),
  opened_by uuid references auth.users (id) on delete set null,
  opened_at timestamptz not null default now(),
  expected_amount numeric(12,2),
  counted_amount numeric(12,2) check (counted_amount >= 0),
  closed_by uuid references auth.users (id) on delete set null,
  closed_at timestamptz,
  notes text check (char_length(notes) <= 500),
  unique (id, organization_id)
);
create unique index cash_sessions_open_uq on public.cash_sessions (organization_id) where status = 'open';
create index cash_sessions_org_idx on public.cash_sessions (organization_id, opened_at desc);

alter table public.purchases
  add constraint purchases_cash_session_fk foreign key (cash_session_id) references public.cash_sessions (id) on delete set null;

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  session_id uuid not null,
  kind text not null check (kind in ('suprimento', 'sangria')),
  amount numeric(12,2) not null check (amount > 0),
  notes text check (char_length(notes) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (session_id, organization_id) references public.cash_sessions (id, organization_id) on delete cascade
);
create index cash_movements_session_idx on public.cash_movements (session_id);

-- ---------------------------------------------------------------------
-- Lançamentos financeiros (receitas e despesas)
-- ---------------------------------------------------------------------
create table public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('income', 'expense')),
  category text not null check (category in (
    'venda_produtos', 'servicos', 'pacotes', 'outras_receitas',
    'fornecedores', 'aluguel', 'salarios', 'energia_agua', 'internet_telefone', 'impostos',
    'marketing', 'manutencao', 'taxas_cartao', 'outras_despesas')),
  description text not null check (char_length(trim(description)) between 2 and 160),
  amount numeric(12,2) not null check (amount > 0 and amount <= 10000000),
  due_date date not null,
  paid_at date,
  status text not null default 'pending' check (status in ('pending', 'paid', 'canceled')),
  payment_method text check (payment_method in (
    'dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'boleto', 'fiado', 'transferencia', 'outro', 'nao_informado')),
  customer_id uuid,
  supplier text check (char_length(supplier) <= 120),
  purchase_id uuid references public.purchases (id) on delete set null,
  cash_session_id uuid references public.cash_sessions (id) on delete set null,
  notes text check (char_length(notes) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'paid') = (paid_at is not null)),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete set null (customer_id)
);
create index finance_entries_org_due_idx on public.finance_entries (organization_id, status, due_date);
create index finance_entries_org_paid_idx on public.finance_entries (organization_id, paid_at) where status = 'paid';
create index finance_entries_purchase_idx on public.finance_entries (purchase_id) where purchase_id is not null;
create index finance_entries_session_idx on public.finance_entries (cash_session_id) where cash_session_id is not null;
create trigger finance_entries_updated_at before update on public.finance_entries
  for each row execute function public.set_updated_at();
create trigger audit_finance_entries after insert or update or delete on public.finance_entries
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- RLS: financeiro é restrito a proprietário/administrador. Caixa é
-- visível a toda a equipe (quem opera o PDV).
-- ---------------------------------------------------------------------
alter table public.purchase_services enable row level security;
alter table public.cash_sessions enable row level security;
alter table public.cash_movements enable row level security;
alter table public.finance_entries enable row level security;

create policy purchase_services_select on public.purchase_services for select to authenticated
  using (public.is_org_member(organization_id));
create policy cash_sessions_select on public.cash_sessions for select to authenticated
  using (public.is_org_member(organization_id));
create policy cash_movements_select on public.cash_movements for select to authenticated
  using (public.is_org_member(organization_id));
create policy finance_entries_select on public.finance_entries for select to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));

-- ---------------------------------------------------------------------
-- Núcleo de venda (uso interno): produtos + serviços em uma transação.
-- p_items:    [{ product_id, quantity, unit_price?, discount? }]
-- p_services: [{ service_id, quantity?, unit_price?, discount?, appointment_id?, customer_package_id?, description? }]
-- ---------------------------------------------------------------------
create or replace function public._create_sale(
  p_org uuid, p_customer uuid, p_date date, p_items jsonb, p_services jsonb,
  p_discount numeric, p_notes text, p_request_id uuid, p_channel text, p_cash_session uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid; v_item jsonb; v_product public.products; v_service public.services; v_qty numeric; v_price numeric;
  v_idisc numeric; v_subtotal numeric := 0; v_total numeric; r record; v_items jsonb; v_services jsonb;
begin
  v_items := coalesce(p_items, '[]'::jsonb);
  v_services := coalesce(p_services, '[]'::jsonb);
  if jsonb_typeof(v_items) <> 'array' or jsonb_typeof(v_services) <> 'array'
     or jsonb_array_length(v_items) + jsonb_array_length(v_services) = 0
     or jsonb_array_length(v_items) + jsonb_array_length(v_services) > 50 then
    raise exception 'INVALID_ITEMS' using errcode = '22023';
  end if;
  if p_customer is not null and not exists (select 1 from public.customers where id = p_customer and organization_id = p_org) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_date is null or p_date > public.org_today(p_org) or p_date < date '2000-01-01' then
    raise exception 'INVALID_DATE' using errcode = '22023';
  end if;
  if coalesce(p_discount, 0) < 0 then raise exception 'INVALID_DISCOUNT' using errcode = '22023'; end if;

  insert into public.purchases (organization_id, customer_id, purchase_date, subtotal, discount, total, notes,
                                client_request_id, created_by, channel, cash_session_id)
  values (p_org, p_customer, p_date, 0, 0, 0, nullif(trim(p_notes), ''), p_request_id, auth.uid(), p_channel, p_cash_session)
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(v_items) loop
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

  for v_item in select * from jsonb_array_elements(v_services) loop
    select * into v_service from public.services
     where id = (v_item ->> 'service_id')::uuid and organization_id = p_org;
    if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;
    v_qty := coalesce((v_item ->> 'quantity')::numeric, 1);
    v_price := coalesce((v_item ->> 'unit_price')::numeric, v_service.price);
    v_idisc := coalesce((v_item ->> 'discount')::numeric, 0);
    if v_qty <= 0 or v_qty > 1000 or v_price < 0 or v_idisc < 0 or v_idisc > v_qty * v_price then
      raise exception 'INVALID_ITEMS' using errcode = '22023';
    end if;
    if (v_item ->> 'appointment_id') is not null and not exists (
      select 1 from public.appointments where id = (v_item ->> 'appointment_id')::uuid and organization_id = p_org) then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    if (v_item ->> 'customer_package_id') is not null and not exists (
      select 1 from public.customer_packages where id = (v_item ->> 'customer_package_id')::uuid and organization_id = p_org) then
      raise exception 'PACKAGE_NOT_FOUND' using errcode = 'P0002';
    end if;
    insert into public.purchase_services (organization_id, purchase_id, service_id, appointment_id, customer_package_id,
                                          description, quantity, unit_price, discount, total)
    values (p_org, v_id, v_service.id, (v_item ->> 'appointment_id')::uuid, (v_item ->> 'customer_package_id')::uuid,
            coalesce(nullif(trim(v_item ->> 'description'), ''), v_service.name), v_qty, v_price, v_idisc,
            round(v_qty * v_price - v_idisc, 2));
    v_subtotal := v_subtotal + round(v_qty * v_price - v_idisc, 2);
  end loop;

  if coalesce(p_discount, 0) > v_subtotal then raise exception 'INVALID_DISCOUNT' using errcode = '22023'; end if;
  v_total := v_subtotal - coalesce(p_discount, 0);
  update public.purchases set subtotal = v_subtotal, discount = coalesce(p_discount, 0), total = v_total where id = v_id;

  -- Previsões de recompra: somente produtos de clientes identificados
  if p_customer is not null then
    for r in
      select product_id, sum(quantity) as qty, sum(total) as amount
        from public.purchase_items where purchase_id = v_id group by product_id
    loop
      perform public._apply_purchase_to_predictions(
        p_org, p_customer, r.product_id, v_id, p_date, r.qty,
        case when v_subtotal > 0 then round(r.amount * v_total / v_subtotal, 2) else 0 end);
    end loop;
  end if;
  return v_id;
end $$;

-- Lançamentos de receita de uma venda (uso interno).
-- p_payments: [{ method, amount }]. null => um lançamento "não informado", pago na data.
-- "fiado" vira conta a receber (pendente) com vencimento em p_due_date.
create or replace function public._record_sale_payments(
  p_org uuid, p_purchase uuid, p_customer uuid, p_category text, p_description text,
  p_total numeric, p_payments jsonb, p_date date, p_due_date date
) returns void language plpgsql security definer set search_path = '' as $$
declare v_pay jsonb; v_sum numeric := 0; v_method text; v_amount numeric; v_session uuid;
begin
  if p_total <= 0 then return; end if;
  if p_payments is null or jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 then
    insert into public.finance_entries (organization_id, kind, category, description, amount, due_date, paid_at, status,
                                        payment_method, customer_id, purchase_id, created_by)
    values (p_org, 'income', p_category, p_description, p_total, p_date, p_date, 'paid', 'nao_informado',
            p_customer, p_purchase, auth.uid());
    return;
  end if;
  if jsonb_array_length(p_payments) > 5 then raise exception 'INVALID_PAYMENT' using errcode = '22023'; end if;
  select id into v_session from public.cash_sessions where organization_id = p_org and status = 'open';

  for v_pay in select * from jsonb_array_elements(p_payments) loop
    v_method := v_pay ->> 'method';
    v_amount := round((v_pay ->> 'amount')::numeric, 2);
    if v_method is null or v_method not in ('dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'boleto', 'fiado', 'transferencia', 'outro')
       or v_amount is null or v_amount <= 0 then
      raise exception 'INVALID_PAYMENT' using errcode = '22023';
    end if;
    if v_method = 'fiado' and p_customer is null then
      raise exception 'FIADO_REQUIRES_CUSTOMER' using errcode = 'P0001';
    end if;
    v_sum := v_sum + v_amount;
    insert into public.finance_entries (organization_id, kind, category, description, amount, due_date, paid_at, status,
                                        payment_method, customer_id, purchase_id, cash_session_id, created_by)
    values (p_org, 'income', p_category, p_description, v_amount,
            case when v_method = 'fiado' then coalesce(p_due_date, p_date + 30) else p_date end,
            case when v_method = 'fiado' then null else p_date end,
            case when v_method = 'fiado' then 'pending' else 'paid' end,
            v_method, p_customer, p_purchase,
            case when v_method = 'dinheiro' then v_session end, auth.uid());
  end loop;
  if abs(v_sum - p_total) > 0.01 then raise exception 'PAYMENT_MISMATCH' using errcode = '22023'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Registro de compra (mesma assinatura e comportamento de antes) +
-- lançamento financeiro automático.
-- ---------------------------------------------------------------------
create or replace function public.create_purchase(
  p_org uuid, p_customer uuid, p_purchase_date date, p_items jsonb,
  p_discount numeric default 0, p_notes text default null, p_request_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_total numeric;
begin
  perform public._assert_member(p_org);
  perform public._assert_writable(p_org);
  if p_request_id is not null then
    select id into v_id from public.purchases where organization_id = p_org and client_request_id = p_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  if p_customer is null then raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'INVALID_ITEMS' using errcode = '22023';
  end if;
  v_id := public._create_sale(p_org, p_customer, p_purchase_date, p_items, '[]'::jsonb, p_discount, p_notes,
                              p_request_id, 'registro', null);
  select total into v_total from public.purchases where id = v_id;
  perform public._record_sale_payments(p_org, v_id, p_customer, 'venda_produtos', 'Venda de produtos',
                                       v_total, null, p_purchase_date, null);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- PDV: venda no balcão (produtos e/ou serviços), cliente opcional,
-- pagamento dividido em até 5 formas. Exige caixa aberto.
-- ---------------------------------------------------------------------
create or replace function public.pdv_checkout(
  p_org uuid, p_customer uuid, p_items jsonb, p_services jsonb, p_discount numeric,
  p_payments jsonb, p_notes text default null, p_request_id uuid default null, p_due_date date default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_session uuid; v_total numeric; v_today date; v_cat text;
begin
  perform public._assert_member(p_org);
  perform public._assert_writable(p_org);
  if p_request_id is not null then
    select id into v_id from public.purchases where organization_id = p_org and client_request_id = p_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  select id into v_session from public.cash_sessions where organization_id = p_org and status = 'open';
  if v_session is null then raise exception 'CASH_SESSION_REQUIRED' using errcode = 'P0001'; end if;
  if p_payments is null or jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 then
    raise exception 'INVALID_PAYMENT' using errcode = '22023';
  end if;
  v_today := public.org_today(p_org);
  if p_due_date is not null and p_due_date < v_today then raise exception 'INVALID_DATE' using errcode = '22023'; end if;

  v_id := public._create_sale(p_org, p_customer, v_today, p_items, p_services, p_discount, p_notes,
                              p_request_id, 'pdv', v_session);
  select total into v_total from public.purchases where id = v_id;
  v_cat := case when coalesce(jsonb_array_length(p_items), 0) = 0 then 'servicos' else 'venda_produtos' end;
  perform public._record_sale_payments(p_org, v_id, p_customer, v_cat, 'Venda no caixa',
                                       v_total, p_payments, v_today, p_due_date);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Concluir atendimento: consome sessão do pacote OU gera a venda do
-- serviço com as formas de pagamento informadas.
-- ---------------------------------------------------------------------
create or replace function public.complete_appointment(
  p_id uuid, p_payments jsonb default null, p_request_id uuid default null, p_due_date date default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v public.appointments; v_pkg public.customer_packages; v_date date; v_tz text; v_sale uuid; v_total numeric;
begin
  select * into v from public.appointments where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform public._assert_member(v.organization_id);
  perform public._assert_writable(v.organization_id);
  if v.status not in ('scheduled', 'confirmed', 'in_progress') then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001';
  end if;
  if v.customer_id is null then raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002'; end if;
  select timezone into v_tz from public.organizations where id = v.organization_id;
  v_date := (v.starts_at at time zone v_tz)::date;
  if v_date > public.org_today(v.organization_id) then raise exception 'INVALID_DATE' using errcode = '22023'; end if;

  if v.customer_package_id is not null then
    select * into v_pkg from public.customer_packages where id = v.customer_package_id for update;
    if v_pkg.status <> 'active' or v_pkg.sessions_used >= v_pkg.sessions_total or v_pkg.expires_at < v_date then
      raise exception 'PACKAGE_UNAVAILABLE' using errcode = 'P0001';
    end if;
    update public.customer_packages set
      sessions_used = sessions_used + 1,
      status = case when sessions_used + 1 >= sessions_total then 'finished' else 'active' end
    where id = v_pkg.id;
  elsif v.price > 0 then
    v_sale := public._create_sale(v.organization_id, v.customer_id, v_date, '[]'::jsonb,
      jsonb_build_array(jsonb_build_object('service_id', v.service_id, 'quantity', 1, 'unit_price', v.price,
                                           'appointment_id', v.id)),
      0, null, p_request_id, 'agenda',
      (select id from public.cash_sessions where organization_id = v.organization_id and status = 'open'));
    select total into v_total from public.purchases where id = v_sale;
    perform public._record_sale_payments(v.organization_id, v_sale, v.customer_id, 'servicos', 'Atendimento',
                                         v_total, p_payments, v_date, p_due_date);
  end if;

  update public.appointments set status = 'done', completed_at = now() where id = p_id;
  return v_sale;
end $$;

-- ---------------------------------------------------------------------
-- Venda de pacote ao cliente
-- ---------------------------------------------------------------------
create or replace function public.sell_package(
  p_org uuid, p_customer uuid, p_pet uuid, p_package uuid, p_payments jsonb,
  p_request_id uuid default null, p_due_date date default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_pkg public.service_packages; v_cp uuid; v_sale uuid; v_today date; v_existing uuid;
begin
  perform public._assert_member(p_org);
  perform public._assert_writable(p_org);
  if p_request_id is not null then
    select ps.customer_package_id into v_existing
      from public.purchases pu join public.purchase_services ps on ps.purchase_id = pu.id
     where pu.organization_id = p_org and pu.client_request_id = p_request_id limit 1;
    if v_existing is not null then return v_existing; end if;
  end if;
  select * into v_pkg from public.service_packages where id = p_package and organization_id = p_org and active;
  if not found then raise exception 'PACKAGE_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_customer is null or not exists (select 1 from public.customers where id = p_customer and organization_id = p_org) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_pet is not null and not exists (select 1 from public.pets where id = p_pet and organization_id = p_org and customer_id = p_customer) then
    raise exception 'PET_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_today := public.org_today(p_org);

  insert into public.customer_packages (organization_id, customer_id, pet_id, package_id, service_id, name,
                                        sessions_total, price_paid, purchased_at, expires_at, created_by)
  values (p_org, p_customer, p_pet, v_pkg.id, v_pkg.service_id, v_pkg.name, v_pkg.sessions, v_pkg.price,
          v_today, v_today + v_pkg.validity_days, auth.uid())
  returning id into v_cp;

  if v_pkg.price > 0 then
    v_sale := public._create_sale(p_org, p_customer, v_today, '[]'::jsonb,
      jsonb_build_array(jsonb_build_object('service_id', v_pkg.service_id, 'quantity', 1, 'unit_price', v_pkg.price,
                                           'customer_package_id', v_cp, 'description', 'Pacote: ' || v_pkg.name)),
      0, null, p_request_id, 'pacote',
      (select id from public.cash_sessions where organization_id = p_org and status = 'open'));
    perform public._record_sale_payments(p_org, v_sale, p_customer, 'pacotes', 'Pacote: ' || v_pkg.name,
                                         v_pkg.price, p_payments, v_today, p_due_date);
  end if;
  return v_cp;
end $$;

create or replace function public.cancel_customer_package(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.customer_packages;
begin
  select * into v from public.customer_packages where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform public._assert_member(v.organization_id, array['owner', 'admin']::public.member_role[]);
  if v.status <> 'active' then raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001'; end if;
  update public.customer_packages set status = 'canceled' where id = p_id;
  -- Agendamentos futuros que usariam o pacote passam a ser cobrados normalmente
  update public.appointments a set customer_package_id = null, price = s.price
    from public.services s
   where a.customer_package_id = p_id and s.id = a.service_id and a.status in ('requested', 'scheduled', 'confirmed');
end $$;

-- ---------------------------------------------------------------------
-- Exclusão de venda (correção): devolve estoque, remove lançamentos,
-- reabre o atendimento cobrado e cancela pacote ainda não utilizado.
-- ---------------------------------------------------------------------
create or replace function public.delete_purchase(p_purchase uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; r record;
begin
  select organization_id into v_org from public.purchases where id = p_purchase;
  if v_org is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform public._assert_member(v_org, array['owner', 'admin']::public.member_role[]);

  if exists (
    select 1 from public.purchase_services ps join public.customer_packages cp on cp.id = ps.customer_package_id
     where ps.purchase_id = p_purchase and cp.sessions_used > 0 and cp.status <> 'canceled') then
    raise exception 'PACKAGE_IN_USE' using errcode = 'P0001';
  end if;

  for r in
    select product_id, -sum(quantity) as qty from public.stock_movements
     where purchase_id = p_purchase and kind in ('venda', 'estorno_venda')
     group by product_id having sum(quantity) <> 0
  loop
    perform public._stock_apply(v_org, r.product_id, 'estorno_venda', r.qty, null, null, 'Compra excluída');
  end loop;

  update public.appointments a set status = 'confirmed', completed_at = null
    from public.purchase_services ps
   where ps.purchase_id = p_purchase and ps.appointment_id = a.id and a.status = 'done';
  update public.customer_packages cp set status = 'canceled'
    from public.purchase_services ps
   where ps.purchase_id = p_purchase and ps.customer_package_id = cp.id and cp.status = 'active';

  delete from public.finance_entries where purchase_id = p_purchase;
  delete from public.replenishment_predictions where source_purchase_id = p_purchase;
  update public.replenishment_predictions
     set status = case when contacted_at is not null then 'contacted'::public.prediction_status else 'open'::public.prediction_status end,
         completed_at = null, completed_purchase_id = null, recovered = false, recovered_amount = 0
   where completed_purchase_id = p_purchase and status = 'completed';
  delete from public.purchases where id = p_purchase;
end $$;

-- ---------------------------------------------------------------------
-- Caixa: abrir, suprimento/sangria, fechar, resumo
-- ---------------------------------------------------------------------
create or replace function public.open_cash_session(p_org uuid, p_opening numeric default 0, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public._assert_member(p_org);
  perform public._assert_writable(p_org);
  if p_opening is null or p_opening < 0 or p_opening > 1000000 then raise exception 'INVALID_AMOUNT' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('cash:' || p_org::text));
  if exists (select 1 from public.cash_sessions where organization_id = p_org and status = 'open') then
    raise exception 'CASH_SESSION_ALREADY_OPEN' using errcode = 'P0001';
  end if;
  insert into public.cash_sessions (organization_id, opening_amount, opened_by, notes)
  values (p_org, round(p_opening, 2), auth.uid(), nullif(trim(p_notes), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.cash_movement(p_org uuid, p_kind text, p_amount numeric, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_session uuid; v_id uuid;
begin
  perform public._assert_member(p_org);
  perform public._assert_writable(p_org);
  select id into v_session from public.cash_sessions where organization_id = p_org and status = 'open';
  if v_session is null then raise exception 'CASH_SESSION_REQUIRED' using errcode = 'P0001'; end if;
  if p_kind not in ('suprimento', 'sangria') or p_amount is null or p_amount <= 0 or p_amount > 1000000 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  insert into public.cash_movements (organization_id, session_id, kind, amount, notes, created_by)
  values (p_org, v_session, p_kind, round(p_amount, 2), nullif(trim(p_notes), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public._cash_expected(p_session uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select s.opening_amount
       + coalesce((select sum(amount) from public.finance_entries
                    where cash_session_id = s.id and status = 'paid' and payment_method = 'dinheiro' and kind = 'income'), 0)
       - coalesce((select sum(amount) from public.finance_entries
                    where cash_session_id = s.id and status = 'paid' and payment_method = 'dinheiro' and kind = 'expense'), 0)
       + coalesce((select sum(amount) from public.cash_movements where session_id = s.id and kind = 'suprimento'), 0)
       - coalesce((select sum(amount) from public.cash_movements where session_id = s.id and kind = 'sangria'), 0)
    from public.cash_sessions s where s.id = p_session;
$$;

create or replace function public.close_cash_session(p_org uuid, p_counted numeric, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session public.cash_sessions; v_expected numeric;
begin
  perform public._assert_member(p_org);
  select * into v_session from public.cash_sessions where organization_id = p_org and status = 'open' for update;
  if not found then raise exception 'CASH_SESSION_REQUIRED' using errcode = 'P0001'; end if;
  if p_counted is null or p_counted < 0 or p_counted > 10000000 then raise exception 'INVALID_AMOUNT' using errcode = '22023'; end if;
  v_expected := public._cash_expected(v_session.id);
  update public.cash_sessions set status = 'closed', expected_amount = v_expected, counted_amount = round(p_counted, 2),
         closed_by = auth.uid(), closed_at = now(),
         notes = coalesce(nullif(trim(p_notes), ''), notes)
   where id = v_session.id;
  return jsonb_build_object('expected', v_expected, 'counted', round(p_counted, 2), 'difference', round(p_counted - v_expected, 2));
end $$;

-- Resumo de uma sessão (aberta por padrão) com totais por forma de pagamento
create or replace function public.cash_session_summary(p_org uuid, p_session uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_session public.cash_sessions;
begin
  perform public._assert_member(p_org);
  if p_session is null then
    select * into v_session from public.cash_sessions where organization_id = p_org and status = 'open';
  else
    select * into v_session from public.cash_sessions where organization_id = p_org and id = p_session;
  end if;
  if v_session.id is null then return null; end if;
  return jsonb_build_object(
    'session', to_jsonb(v_session),
    'expected_cash', public._cash_expected(v_session.id),
    'sales_count', (select count(*) from public.purchases where cash_session_id = v_session.id),
    'sales_total', (select coalesce(sum(total), 0) from public.purchases where cash_session_id = v_session.id),
    'by_method', (select coalesce(jsonb_object_agg(m, t), '{}'::jsonb) from (
        select fe.payment_method as m, sum(fe.amount) as t
          from public.finance_entries fe join public.purchases pu on pu.id = fe.purchase_id
         where pu.cash_session_id = v_session.id and fe.kind = 'income' and fe.status <> 'canceled'
         group by fe.payment_method) x),
    'movements', (select coalesce(jsonb_agg(to_jsonb(cm) order by cm.created_at), '[]'::jsonb)
                    from public.cash_movements cm where cm.session_id = v_session.id),
    'settled_cash', (select coalesce(sum(amount), 0) from public.finance_entries
                      where cash_session_id = v_session.id and status = 'paid' and payment_method = 'dinheiro'
                        and kind = 'income' and (purchase_id is null or purchase_id not in (
                          select id from public.purchases where cash_session_id = v_session.id)))
  );
end $$;

-- ---------------------------------------------------------------------
-- Financeiro: lançamentos manuais, baixa de contas, cancelamento
-- ---------------------------------------------------------------------
create or replace function public.save_finance_entry(
  p_org uuid, p_id uuid, p_kind text, p_category text, p_description text, p_amount numeric,
  p_due_date date, p_paid boolean, p_paid_at date default null, p_method text default null,
  p_customer uuid default null, p_supplier text default null, p_notes text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_old public.finance_entries; v_paid_at date; v_session uuid;
begin
  perform public._assert_member(p_org, array['owner', 'admin']::public.member_role[]);
  perform public._assert_writable(p_org);
  if p_kind not in ('income', 'expense') then raise exception 'INVALID_ENTRY' using errcode = '22023'; end if;
  if (p_kind = 'income' and p_category not in ('venda_produtos', 'servicos', 'pacotes', 'outras_receitas'))
     or (p_kind = 'expense' and p_category in ('venda_produtos', 'servicos', 'pacotes', 'outras_receitas')) then
    raise exception 'INVALID_ENTRY' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_due_date is null then raise exception 'INVALID_ENTRY' using errcode = '22023'; end if;
  if p_customer is not null and not exists (select 1 from public.customers where id = p_customer and organization_id = p_org) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_method = 'fiado' then raise exception 'INVALID_PAYMENT' using errcode = '22023'; end if;
  v_paid_at := case when p_paid then coalesce(p_paid_at, public.org_today(p_org)) end;
  if v_paid_at is not null and v_paid_at > public.org_today(p_org) then raise exception 'INVALID_DATE' using errcode = '22023'; end if;
  if p_paid and p_method = 'dinheiro' and v_paid_at = public.org_today(p_org) then
    select id into v_session from public.cash_sessions where organization_id = p_org and status = 'open';
  end if;

  if p_id is null then
    insert into public.finance_entries (organization_id, kind, category, description, amount, due_date, paid_at, status,
                                        payment_method, customer_id, supplier, cash_session_id, notes, created_by)
    values (p_org, p_kind, p_category, trim(p_description), round(p_amount, 2), p_due_date, v_paid_at,
            case when p_paid then 'paid' else 'pending' end, p_method, p_customer, nullif(trim(p_supplier), ''),
            v_session, nullif(trim(p_notes), ''), auth.uid())
    returning id into v_id;
  else
    select * into v_old from public.finance_entries where id = p_id and organization_id = p_org for update;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if v_old.purchase_id is not null or v_old.status = 'canceled' then raise exception 'ENTRY_LOCKED' using errcode = 'P0001'; end if;
    update public.finance_entries set kind = p_kind, category = p_category, description = trim(p_description),
           amount = round(p_amount, 2), due_date = p_due_date, paid_at = v_paid_at,
           status = case when p_paid then 'paid' else 'pending' end, payment_method = p_method,
           customer_id = p_customer, supplier = nullif(trim(p_supplier), ''),
           cash_session_id = case when p_paid and p_method = 'dinheiro' then coalesce(v_old.cash_session_id, v_session) end,
           notes = nullif(trim(p_notes), '')
     where id = p_id;
    v_id := p_id;
  end if;
  return v_id;
end $$;

-- Baixa de conta a pagar/receber (inclusive fiado de vendas)
create or replace function public.settle_finance_entry(p_id uuid, p_method text, p_paid_at date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.finance_entries; v_paid date; v_session uuid;
begin
  select * into v from public.finance_entries where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform public._assert_member(v.organization_id, array['owner', 'admin']::public.member_role[]);
  perform public._assert_writable(v.organization_id);
  if v.status <> 'pending' then raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001'; end if;
  if p_method is null or p_method not in ('dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'boleto', 'transferencia', 'outro') then
    raise exception 'INVALID_PAYMENT' using errcode = '22023';
  end if;
  v_paid := coalesce(p_paid_at, public.org_today(v.organization_id));
  if v_paid > public.org_today(v.organization_id) then raise exception 'INVALID_DATE' using errcode = '22023'; end if;
  if p_method = 'dinheiro' and v_paid = public.org_today(v.organization_id) then
    select id into v_session from public.cash_sessions where organization_id = v.organization_id and status = 'open';
  end if;
  update public.finance_entries set status = 'paid', paid_at = v_paid, payment_method = p_method, cash_session_id = v_session
   where id = p_id;
end $$;

create or replace function public.cancel_finance_entry(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.finance_entries;
begin
  select * into v from public.finance_entries where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform public._assert_member(v.organization_id, array['owner', 'admin']::public.member_role[]);
  if v.purchase_id is not null then raise exception 'ENTRY_LOCKED' using errcode = 'P0001'; end if;
  if v.status = 'canceled' then raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001'; end if;
  update public.finance_entries set status = 'canceled', paid_at = null where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Relatório financeiro do período
-- ---------------------------------------------------------------------
create or replace function public.finance_report(p_org uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date; v_rev numeric; v_count int; v_prod numeric; v_serv numeric; v_cmv numeric;
begin
  perform public._assert_member(p_org, array['owner', 'admin']::public.member_role[]);
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 731 then
    raise exception 'INVALID_PERIOD' using errcode = '22023';
  end if;
  v_today := public.org_today(p_org);
  select coalesce(sum(total), 0), count(*) into v_rev, v_count
    from public.purchases where organization_id = p_org and purchase_date between p_from and p_to;
  select coalesce(sum(pi.total), 0), coalesce(sum(pi.quantity * coalesce(pr.cost, 0)), 0) into v_prod, v_cmv
    from public.purchase_items pi join public.purchases pu on pu.id = pi.purchase_id
    join public.products pr on pr.id = pi.product_id
   where pi.organization_id = p_org and pu.purchase_date between p_from and p_to;
  select coalesce(sum(ps.total), 0) into v_serv
    from public.purchase_services ps join public.purchases pu on pu.id = ps.purchase_id
   where ps.organization_id = p_org and pu.purchase_date between p_from and p_to;

  return jsonb_build_object(
    'revenue', v_rev,
    'sales_count', v_count,
    'avg_ticket', case when v_count > 0 then round(v_rev / v_count, 2) else 0 end,
    'products_revenue', v_prod,
    'services_revenue', v_serv,
    'discounts', (select coalesce(sum(discount), 0) from public.purchases
                   where organization_id = p_org and purchase_date between p_from and p_to),
    'products_cost', round(v_cmv, 2),
    'products_cost_missing', (select count(distinct pi.product_id) from public.purchase_items pi
                               join public.purchases pu on pu.id = pi.purchase_id
                               join public.products pr on pr.id = pi.product_id
                              where pi.organization_id = p_org and pu.purchase_date between p_from and p_to and pr.cost is null),
    'gross_profit', round(v_rev - v_cmv, 2),
    'received', (select coalesce(sum(amount), 0) from public.finance_entries
                  where organization_id = p_org and kind = 'income' and status = 'paid' and paid_at between p_from and p_to),
    'paid_expenses', (select coalesce(sum(amount), 0) from public.finance_entries
                  where organization_id = p_org and kind = 'expense' and status = 'paid' and paid_at between p_from and p_to),
    'receivable_open', (select coalesce(sum(amount), 0) from public.finance_entries
                  where organization_id = p_org and kind = 'income' and status = 'pending'),
    'receivable_overdue', (select coalesce(sum(amount), 0) from public.finance_entries
                  where organization_id = p_org and kind = 'income' and status = 'pending' and due_date < v_today),
    'payable_open', (select coalesce(sum(amount), 0) from public.finance_entries
                  where organization_id = p_org and kind = 'expense' and status = 'pending'),
    'payable_overdue', (select coalesce(sum(amount), 0) from public.finance_entries
                  where organization_id = p_org and kind = 'expense' and status = 'pending' and due_date < v_today),
    'payable_next7', (select coalesce(sum(amount), 0) from public.finance_entries
                  where organization_id = p_org and kind = 'expense' and status = 'pending' and due_date between v_today and v_today + 7),
    'by_method', (select coalesce(jsonb_object_agg(m, t), '{}'::jsonb) from (
        select coalesce(payment_method, 'nao_informado') as m, sum(amount) as t from public.finance_entries
         where organization_id = p_org and kind = 'income' and status = 'paid' and paid_at between p_from and p_to
         group by 1) x),
    'expenses_by_category', (select coalesce(jsonb_object_agg(c, t), '{}'::jsonb) from (
        select category as c, sum(amount) as t from public.finance_entries
         where organization_id = p_org and kind = 'expense' and status = 'paid' and paid_at between p_from and p_to
         group by 1) x),
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', d.day,
        'revenue', coalesce((select sum(total) from public.purchases where organization_id = p_org and purchase_date = d.day), 0),
        'received', coalesce((select sum(amount) from public.finance_entries where organization_id = p_org
                               and kind = 'income' and status = 'paid' and paid_at = d.day), 0),
        'expenses', coalesce((select sum(amount) from public.finance_entries where organization_id = p_org
                               and kind = 'expense' and status = 'paid' and paid_at = d.day), 0)
      ) order by d.day), '[]'::jsonb)
      from (select gs::date as day from generate_series(p_from, p_to, interval '1 day') gs) d
    )
  );
end $$;

-- ---------------------------------------------------------------------
-- Backfill: lançamentos das vendas já registradas (pago / não informado)
-- ---------------------------------------------------------------------
insert into public.finance_entries (organization_id, kind, category, description, amount, due_date, paid_at, status,
                                    payment_method, customer_id, purchase_id, created_by)
select pu.organization_id, 'income', 'venda_produtos', 'Venda de produtos', pu.total, pu.purchase_date, pu.purchase_date,
       'paid', 'nao_informado', pu.customer_id, pu.id, pu.created_by
  from public.purchases pu
 where pu.total > 0
   and not exists (select 1 from public.finance_entries fe where fe.purchase_id = pu.id);

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
revoke execute on function public._create_sale(uuid, uuid, date, jsonb, jsonb, numeric, text, uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public._record_sale_payments(uuid, uuid, uuid, text, text, numeric, jsonb, date, date) from public, anon, authenticated;
revoke execute on function public._cash_expected(uuid) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'public.create_purchase(uuid, uuid, date, jsonb, numeric, text, uuid)',
    'public.pdv_checkout(uuid, uuid, jsonb, jsonb, numeric, jsonb, text, uuid, date)',
    'public.complete_appointment(uuid, jsonb, uuid, date)',
    'public.sell_package(uuid, uuid, uuid, uuid, jsonb, uuid, date)',
    'public.cancel_customer_package(uuid)',
    'public.delete_purchase(uuid)',
    'public.open_cash_session(uuid, numeric, text)',
    'public.cash_movement(uuid, text, numeric, text)',
    'public.close_cash_session(uuid, numeric, text)',
    'public.cash_session_summary(uuid, uuid)',
    'public.save_finance_entry(uuid, uuid, text, text, text, numeric, date, boolean, date, text, uuid, text, text)',
    'public.settle_finance_entry(uuid, text, date)',
    'public.cancel_finance_entry(uuid)',
    'public.finance_report(uuid, date, date)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
