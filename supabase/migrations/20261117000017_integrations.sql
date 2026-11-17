-- =====================================================================
-- VoltaCerta — 0017: integrações por estabelecimento
-- * WhatsApp automático (API oficial do WhatsApp Business / Meta Cloud API)
-- * Nota fiscal (NFC-e para produtos e NFS-e para serviços via Focus NFe)
-- Credenciais (tokens) ficam em org_integrations, tabela SEM política de
-- leitura para usuários: só o service role (Edge Functions) as lê. O
-- painel grava tokens por RPC e nunca os recebe de volta.
-- =====================================================================

create table public.org_integrations (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  -- WhatsApp Cloud API
  whatsapp_enabled boolean not null default false,
  whatsapp_phone_number_id text check (whatsapp_phone_number_id ~ '^[0-9]{5,30}$'),
  whatsapp_token text check (char_length(whatsapp_token) <= 1000),
  whatsapp_templates jsonb not null default '{}'::jsonb, -- { kind: { "name": "...", "language": "pt_BR" } }
  whatsapp_auto_kinds text[] not null default '{}'
    check (whatsapp_auto_kinds <@ array['aniversario', 'pos_venda', 'lembrete_agendamento', 'retorno_servico', 'pacote_vencendo', 'recompra']),
  whatsapp_last_run_at timestamptz,
  -- Nota fiscal (Focus NFe)
  fiscal_enabled boolean not null default false,
  fiscal_environment text not null default 'homologacao' check (fiscal_environment in ('homologacao', 'producao')),
  fiscal_token text check (char_length(fiscal_token) <= 200),
  fiscal_cnpj text check (fiscal_cnpj ~ '^[0-9]{14}$'),
  fiscal_ie text check (char_length(fiscal_ie) <= 20),
  fiscal_im text check (char_length(fiscal_im) <= 20),
  fiscal_city_code text check (fiscal_city_code ~ '^[0-9]{7}$'),
  fiscal_simples boolean not null default true,
  fiscal_icms_situation text not null default '102' check (fiscal_icms_situation ~ '^[0-9]{2,3}$'),
  fiscal_service_item text not null default '05.08' check (char_length(fiscal_service_item) <= 10),
  fiscal_municipal_tax_code text check (char_length(fiscal_municipal_tax_code) <= 20),
  fiscal_iss_rate numeric(5,2) check (fiscal_iss_rate between 0 and 10),
  updated_at timestamptz not null default now()
);
create trigger org_integrations_updated_at before update on public.org_integrations
  for each row execute function public.set_updated_at();
alter table public.org_integrations enable row level security; -- sem políticas: só service role

-- Dados fiscais dos produtos e serviços (opcionais; exigidos só para emitir nota)
alter table public.products
  add column ncm text check (ncm ~ '^[0-9]{8}$'),
  add column cfop text not null default '5102' check (cfop ~ '^[0-9]{4}$'),
  add column fiscal_origin int not null default 0 check (fiscal_origin between 0 and 8);

-- Mensagens automáticas enviadas (auditoria e deduplicação)
create table public.message_dispatches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid,
  kind text not null,
  dedupe_key text not null check (char_length(dedupe_key) <= 200),
  template_name text,
  status text not null check (status in ('sent', 'failed')),
  provider_message_id text,
  error text check (char_length(error) <= 500),
  created_at timestamptz not null default now(),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete set null (customer_id)
);
create unique index message_dispatches_sent_uq on public.message_dispatches (organization_id, dedupe_key) where status = 'sent';
create index message_dispatches_org_idx on public.message_dispatches (organization_id, created_at desc);
alter table public.message_dispatches enable row level security;
create policy message_dispatches_select on public.message_dispatches for select to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));

-- Notas fiscais emitidas
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  purchase_id uuid references public.purchases (id) on delete set null,
  kind text not null check (kind in ('nfce', 'nfse')),
  ref text not null unique,
  environment text not null check (environment in ('homologacao', 'producao')),
  status text not null check (status in ('processando', 'autorizado', 'erro', 'cancelado')),
  amount numeric(12,2) not null default 0,
  numero text, serie text, chave text,
  url_pdf text, url_xml text,
  message text check (char_length(message) <= 1000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoices_org_idx on public.invoices (organization_id, created_at desc);
create index invoices_purchase_idx on public.invoices (purchase_id);
create unique index invoices_active_uq on public.invoices (purchase_id, kind) where status in ('processando', 'autorizado');
create trigger invoices_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();
alter table public.invoices enable row level security;
create policy invoices_select on public.invoices for select to authenticated
  using (public.is_org_member(organization_id));

-- ---------------------------------------------------------------------
-- Configurações (painel): leitura sem segredos e gravação
-- ---------------------------------------------------------------------
create or replace function public.get_integration_settings(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare i public.org_integrations;
begin
  perform public._assert_member(p_org, array['owner', 'admin']::public.member_role[]);
  select * into i from public.org_integrations where organization_id = p_org;
  return jsonb_build_object(
    'whatsapp_enabled', coalesce(i.whatsapp_enabled, false),
    'whatsapp_phone_number_id', i.whatsapp_phone_number_id,
    'whatsapp_has_token', i.whatsapp_token is not null,
    'whatsapp_templates', coalesce(i.whatsapp_templates, '{}'::jsonb),
    'whatsapp_auto_kinds', coalesce(to_jsonb(i.whatsapp_auto_kinds), '[]'::jsonb),
    'whatsapp_last_run_at', i.whatsapp_last_run_at,
    'fiscal_enabled', coalesce(i.fiscal_enabled, false),
    'fiscal_environment', coalesce(i.fiscal_environment, 'homologacao'),
    'fiscal_has_token', i.fiscal_token is not null,
    'fiscal_cnpj', i.fiscal_cnpj, 'fiscal_ie', i.fiscal_ie, 'fiscal_im', i.fiscal_im,
    'fiscal_city_code', i.fiscal_city_code, 'fiscal_simples', coalesce(i.fiscal_simples, true),
    'fiscal_icms_situation', coalesce(i.fiscal_icms_situation, '102'),
    'fiscal_service_item', coalesce(i.fiscal_service_item, '05.08'),
    'fiscal_municipal_tax_code', i.fiscal_municipal_tax_code,
    'fiscal_iss_rate', i.fiscal_iss_rate,
    'dispatches_30d', (select jsonb_build_object(
        'sent', count(*) filter (where status = 'sent'), 'failed', count(*) filter (where status = 'failed'))
        from public.message_dispatches where organization_id = p_org and created_at > now() - interval '30 days')
  );
end $$;

-- p_token null = mantém o atual; '' = remove
create or replace function public.save_whatsapp_settings(
  p_org uuid, p_enabled boolean, p_phone_number_id text, p_token text, p_templates jsonb, p_auto_kinds text[]
) returns void language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  perform public._assert_member(p_org, array['owner', 'admin']::public.member_role[]);
  if p_templates is null or jsonb_typeof(p_templates) <> 'object' then raise exception 'INVALID_INPUT' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_templates) loop
    if k not in ('aniversario', 'pos_venda', 'lembrete_agendamento', 'retorno_servico', 'pacote_vencendo', 'recompra')
       or coalesce(p_templates -> k ->> 'name', '') !~ '^[a-z0-9_]+$' or char_length(p_templates -> k ->> 'name') > 512
       or coalesce(p_templates -> k ->> 'language', '') !~ '^[a-z]{2}(_[A-Z]{2})?$' then
      raise exception 'INVALID_INPUT' using errcode = '22023';
    end if;
  end loop;
  insert into public.org_integrations (organization_id) values (p_org) on conflict (organization_id) do nothing;
  update public.org_integrations set
    whatsapp_phone_number_id = nullif(trim(p_phone_number_id), ''),
    whatsapp_token = case when p_token is null then whatsapp_token else nullif(trim(p_token), '') end,
    whatsapp_templates = p_templates,
    whatsapp_auto_kinds = coalesce(p_auto_kinds, '{}')
  where organization_id = p_org;
  update public.org_integrations set whatsapp_enabled = coalesce(p_enabled, false)
         and whatsapp_phone_number_id is not null and whatsapp_token is not null
   where organization_id = p_org;
  if p_enabled and not (select whatsapp_enabled from public.org_integrations where organization_id = p_org) then
    raise exception 'INTEGRATION_INCOMPLETE' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.save_fiscal_settings(
  p_org uuid, p_enabled boolean, p_environment text, p_token text, p_cnpj text, p_ie text, p_im text,
  p_city_code text, p_simples boolean, p_icms_situation text, p_service_item text,
  p_municipal_tax_code text, p_iss_rate numeric
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._assert_member(p_org, array['owner']::public.member_role[]);
  insert into public.org_integrations (organization_id) values (p_org) on conflict (organization_id) do nothing;
  update public.org_integrations set
    fiscal_environment = coalesce(p_environment, 'homologacao'),
    fiscal_token = case when p_token is null then fiscal_token else nullif(trim(p_token), '') end,
    fiscal_cnpj = nullif(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'), ''),
    fiscal_ie = nullif(trim(p_ie), ''), fiscal_im = nullif(trim(p_im), ''),
    fiscal_city_code = nullif(trim(p_city_code), ''),
    fiscal_simples = coalesce(p_simples, true),
    fiscal_icms_situation = coalesce(nullif(trim(p_icms_situation), ''), '102'),
    fiscal_service_item = coalesce(nullif(trim(p_service_item), ''), '05.08'),
    fiscal_municipal_tax_code = nullif(trim(p_municipal_tax_code), ''),
    fiscal_iss_rate = p_iss_rate
  where organization_id = p_org;
  update public.org_integrations set fiscal_enabled = coalesce(p_enabled, false)
         and fiscal_token is not null and fiscal_cnpj is not null
   where organization_id = p_org;
  if p_enabled and not (select fiscal_enabled from public.org_integrations where organization_id = p_org) then
    raise exception 'INTEGRATION_INCOMPLETE' using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- WhatsApp: mensagens pendentes de envio automático (service role)
-- Regras: só envia o que está ligado em whatsapp_auto_kinds e tem modelo
-- configurado; mensagens de relacionamento exigem consentimento
-- (marketing_consent) e respeitam a oposição; lembrete de agendamento
-- (transacional) só respeita a oposição.
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_pending(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare i public.org_integrations; v_today date; v_tz text;
begin
  select * into i from public.org_integrations where organization_id = p_org and whatsapp_enabled;
  if i.organization_id is null or not public.org_can_write(p_org) then return '[]'::jsonb; end if;
  select timezone into v_tz from public.organizations where id = p_org;
  v_today := public.org_today(p_org);
  return (
    with r as (
      select x.key as dedupe_key, x.kind, x.customer_id, x.customer_name, x.phone, x.pet_name, x.service_name,
             x.starts_at, x.due_date, null::uuid as prediction_id, null::text as product_name,
             x.marketing_consent, x.do_not_contact
        from public._reminders(p_org, 1) x
       where (x.kind = 'aniversario' and x.due_date = v_today)
          or (x.kind = 'lembrete_agendamento' and x.due_date = v_today + 1)
          or (x.kind in ('pos_venda', 'retorno_servico') and x.due_date <= v_today)
          or (x.kind = 'pacote_vencendo' and x.due_date <= v_today + 7)
      union all
      select 'recompra:' || p.id, 'recompra', p.customer_id, c.full_name, c.phone_normalized,
             (select pe.name from public.pets pe where pe.customer_id = c.id order by pe.created_at limit 1),
             null, null, p.expected_date, p.id, pr.name, c.marketing_consent, c.do_not_contact
        from public.replenishment_predictions p
        join public.customers c on c.id = p.customer_id join public.products pr on pr.id = p.product_id
       where p.organization_id = p_org and p.status = 'open' and p.expected_date = v_today
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'dedupe_key', r.dedupe_key, 'kind', r.kind, 'customer_id', r.customer_id, 'customer_name', r.customer_name,
      'phone', r.phone, 'pet_name', r.pet_name, 'service_name', r.service_name, 'product_name', r.product_name,
      'prediction_id', r.prediction_id, 'due_date', r.due_date,
      'date', to_char(coalesce(r.starts_at at time zone v_tz, r.due_date::timestamp), 'DD/MM'),
      'time', to_char(r.starts_at at time zone v_tz, 'HH24:MI'),
      'template', i.whatsapp_templates -> r.kind
    )), '[]'::jsonb)
      from r
     where r.kind = any (i.whatsapp_auto_kinds)
       and i.whatsapp_templates ? r.kind
       and r.phone is not null
       and not r.do_not_contact
       and (r.kind = 'lembrete_agendamento' or r.marketing_consent)
       and not exists (select 1 from public.message_dispatches d
                        where d.organization_id = p_org and d.dedupe_key = r.dedupe_key and d.status = 'sent')
       and (select count(*) from public.message_dispatches d
             where d.organization_id = p_org and d.dedupe_key = r.dedupe_key and d.status = 'failed') < 3
  );
end $$;

create or replace function public.whatsapp_record_dispatch(
  p_org uuid, p_customer uuid, p_kind text, p_dedupe_key text, p_template text, p_status text,
  p_provider_id text, p_error text, p_prediction uuid, p_message text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.message_dispatches (organization_id, customer_id, kind, dedupe_key, template_name, status,
                                         provider_message_id, error)
  values (p_org, p_customer, p_kind, p_dedupe_key, p_template, p_status, p_provider_id, left(p_error, 500))
  on conflict do nothing;
  if p_status = 'sent' then
    insert into public.contact_logs (organization_id, customer_id, prediction_id, channel, message, result, notes,
                                     external_message_id, reminder_key)
    values (p_org, p_customer,
            case when p_prediction is not null and exists (select 1 from public.replenishment_predictions
                   where id = p_prediction and organization_id = p_org) then p_prediction end,
            'whatsapp_api', left(p_message, 2000), 'nao_respondeu', 'Envio automático pelo WhatsApp',
            p_provider_id, case when p_kind <> 'recompra' then p_dedupe_key end);
    if p_prediction is not null then
      update public.replenishment_predictions set status = 'contacted', contacted_at = now()
       where id = p_prediction and organization_id = p_org and status = 'open';
    end if;
  end if;
end $$;

-- Lista de organizações com envio automático ligado (para o agendador)
create or replace function public.whatsapp_enabled_orgs()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select organization_id from public.org_integrations
   where whatsapp_enabled and cardinality(whatsapp_auto_kinds) > 0;
$$;

-- ---------------------------------------------------------------------
-- Nota fiscal: dados da venda para emissão (valida posse e cadastro)
-- ---------------------------------------------------------------------
create or replace function public.fiscal_prepare(p_purchase uuid, p_kind text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare pu public.purchases; v_missing jsonb;
begin
  select * into pu from public.purchases where id = p_purchase;
  if pu.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform public._assert_member(pu.organization_id);
  perform public._assert_writable(pu.organization_id);
  if p_kind not in ('nfce', 'nfse') then raise exception 'INVALID_INPUT' using errcode = '22023'; end if;
  if not exists (select 1 from public.org_integrations where organization_id = pu.organization_id and fiscal_enabled) then
    raise exception 'FISCAL_NOT_CONFIGURED' using errcode = 'P0001';
  end if;
  if p_kind = 'nfce' then
    if not exists (select 1 from public.purchase_items where purchase_id = pu.id) then
      raise exception 'FISCAL_NO_ITEMS' using errcode = 'P0001';
    end if;
    select coalesce(jsonb_agg(distinct pr.name), '[]'::jsonb) into v_missing
      from public.purchase_items pi join public.products pr on pr.id = pi.product_id
     where pi.purchase_id = pu.id and pr.ncm is null;
    if jsonb_array_length(v_missing) > 0 then
      raise exception 'FISCAL_DATA_MISSING' using errcode = 'P0001', detail = v_missing::text;
    end if;
  elsif not exists (select 1 from public.purchase_services where purchase_id = pu.id) then
    raise exception 'FISCAL_NO_ITEMS' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.invoices where purchase_id = pu.id and kind = p_kind and status in ('processando', 'autorizado')) then
    raise exception 'INVOICE_ALREADY_ISSUED' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'organization_id', pu.organization_id,
    'purchase', jsonb_build_object('id', pu.id, 'date', pu.purchase_date, 'subtotal', pu.subtotal,
                                   'discount', pu.discount, 'total', pu.total),
    'customer', (select jsonb_build_object('name', c.full_name, 'email', c.email, 'phone', c.phone_normalized)
                   from public.customers c where c.id = pu.customer_id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'code', coalesce(pr.sku, left(pr.id::text, 8)), 'name', pr.name, 'ncm', pr.ncm, 'cfop', pr.cfop,
        'origin', pr.fiscal_origin, 'unit', pr.unit, 'quantity', pi.quantity, 'unit_price', pi.unit_price,
        'gross', round(pi.quantity * pi.unit_price, 2), 'discount', pi.discount) order by pi.id), '[]'::jsonb)
        from public.purchase_items pi join public.products pr on pr.id = pi.product_id where pi.purchase_id = pu.id),
    'services', (select coalesce(jsonb_agg(jsonb_build_object(
        'description', ps.description, 'quantity', ps.quantity, 'total', ps.total) order by ps.id), '[]'::jsonb)
        from public.purchase_services ps where ps.purchase_id = pu.id),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('method', fe.payment_method, 'amount', fe.amount)), '[]'::jsonb)
        from public.finance_entries fe where fe.purchase_id = pu.id and fe.kind = 'income' and fe.status <> 'canceled')
  );
end $$;

-- Registro do resultado da emissão (service role)
create or replace function public.fiscal_record_invoice(
  p_org uuid, p_purchase uuid, p_kind text, p_ref text, p_environment text, p_status text, p_amount numeric,
  p_numero text, p_serie text, p_chave text, p_url_pdf text, p_url_xml text, p_message text, p_user uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.invoices (organization_id, purchase_id, kind, ref, environment, status, amount, numero, serie, chave,
                               url_pdf, url_xml, message, created_by)
  values (p_org, p_purchase, p_kind, p_ref, p_environment, p_status, coalesce(p_amount, 0), p_numero, p_serie, p_chave,
          p_url_pdf, p_url_xml, left(p_message, 1000), p_user)
  on conflict (ref) do update set status = excluded.status, numero = coalesce(excluded.numero, public.invoices.numero),
    serie = coalesce(excluded.serie, public.invoices.serie), chave = coalesce(excluded.chave, public.invoices.chave),
    url_pdf = coalesce(excluded.url_pdf, public.invoices.url_pdf), url_xml = coalesce(excluded.url_xml, public.invoices.url_xml),
    message = excluded.message
  returning id into v_id;
  return v_id;
end $$;

-- Dados da nota para consultar/cancelar (valida posse)
create or replace function public.fiscal_invoice_for_user(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v public.invoices;
begin
  select * into v from public.invoices where id = p_invoice;
  if v.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform public._assert_member(v.organization_id, array['owner', 'admin']::public.member_role[]);
  return to_jsonb(v);
end $$;

-- ---------------------------------------------------------------------
-- Contexto da organização: inclui quais integrações estão ativas (sem
-- segredos) para o painel mostrar os botões de nota fiscal e WhatsApp.
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
    'integrations', jsonb_build_object(
      'fiscal', coalesce((select fiscal_enabled from public.org_integrations where organization_id = p_org), false),
      'whatsapp', coalesce((select whatsapp_enabled from public.org_integrations where organization_id = p_org), false)),
    'today', public.org_today(p_org)
  ) into v
  from public.subscriptions s join public.organizations o on o.id = s.organization_id
  where s.organization_id = p_org;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Exclusão definitiva do estabelecimento (Super Admin): remove antes os
-- registros dos novos módulos que referenciam produtos e serviços.
-- ---------------------------------------------------------------------
create or replace function public.admin_delete_organization(p_org uuid, p_reason text, p_confirm_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_org public.organizations;
  v_sub public.subscriptions;
  v_details jsonb;
begin
  perform public._assert_super_admin();
  v_reason := public._require_reason(p_reason);
  select * into v_org from public.organizations where id = p_org for update;
  if v_org.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_confirm_name is null or trim(p_confirm_name) <> trim(v_org.name) then
    raise exception 'CONFIRMATION_MISMATCH' using errcode = '22023';
  end if;

  select * into v_sub from public.subscriptions where organization_id = p_org;
  if v_sub.provider_subscription_id is not null
     and v_sub.status in ('active', 'past_due')
     and coalesce(v_sub.current_period_end, now()) > now() - interval '10 days' then
    raise exception 'SUBSCRIPTION_ACTIVE' using errcode = 'P0001';
  end if;

  v_details := jsonb_build_object(
    'name', v_org.name,
    'owner_email', (select u.email from public.organization_members m join auth.users u on u.id = m.user_id
                     where m.organization_id = p_org and m.role = 'owner' limit 1),
    'members', (select count(*) from public.organization_members where organization_id = p_org),
    'customers', (select count(*) from public.customers where organization_id = p_org),
    'purchases', (select count(*) from public.purchases where organization_id = p_org),
    'plan', v_sub.plan, 'subscription_status', v_sub.status,
    'created_at', v_org.created_at);

  -- purchase_items e replenishment_predictions protegem produtos com ON DELETE RESTRICT
  -- (o histórico de vendas não pode perder o produto). Na exclusão total, removemos
  -- antes os registros dependentes; o restante sai pelo ON DELETE CASCADE.
  -- Módulos de gestão (0012–0017): registros que protegem produtos/serviços
  delete from public.invoices where organization_id = p_org;
  delete from public.purchase_services where organization_id = p_org;
  delete from public.appointments where organization_id = p_org;
  delete from public.customer_packages where organization_id = p_org;
  delete from public.service_packages where organization_id = p_org;
  delete from public.replenishment_predictions where organization_id = p_org;
  delete from public.purchase_items where organization_id = p_org;
  delete from public.purchases where organization_id = p_org;
  delete from public.organizations where id = p_org;
  perform public._admin_log('delete_organization', 'organization', p_org::text, v_reason, v_details);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
revoke execute on function public.whatsapp_pending(uuid) from public, anon, authenticated;
revoke execute on function public.whatsapp_record_dispatch(uuid, uuid, text, text, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.whatsapp_enabled_orgs() from public, anon, authenticated;
revoke execute on function public.fiscal_record_invoice(uuid, uuid, text, text, text, text, numeric, text, text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_pending(uuid) to service_role;
grant execute on function public.whatsapp_record_dispatch(uuid, uuid, text, text, text, text, text, text, uuid, text) to service_role;
grant execute on function public.whatsapp_enabled_orgs() to service_role;
grant execute on function public.fiscal_record_invoice(uuid, uuid, text, text, text, text, numeric, text, text, text, text, text, text, uuid) to service_role;
do $$
declare f text;
begin
  foreach f in array array[
    'public.get_integration_settings(uuid)',
    'public.save_whatsapp_settings(uuid, boolean, text, text, jsonb, text[])',
    'public.save_fiscal_settings(uuid, boolean, text, text, text, text, text, text, boolean, text, text, text, numeric)',
    'public.fiscal_prepare(uuid, text)',
    'public.fiscal_invoice_for_user(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
