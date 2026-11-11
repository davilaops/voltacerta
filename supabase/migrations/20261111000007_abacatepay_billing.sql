-- 0007 — Cobrança real via AbacatePay (API v2). Aditiva: não altera dados existentes.
--
-- Fluxo:
--   1. billing-checkout (Edge Function, service_role) cria a assinatura na
--      AbacatePay e grava aqui o vínculo checkout(bill_...) -> organização/plano.
--   2. billing-webhook valida segredo + assinatura, normaliza o evento e chama
--      billing_apply_event(), que aplica tudo numa única transação, com
--      idempotência pelo id do evento (payment_events).
-- O vínculo fica no NOSSO banco: não dependemos de metadata devolvida pelo provedor.

-- ---------------------------------------------------------------------
-- 1. Produtos do provedor por plano (cache; um por ambiente dev/prod)
--    formato: {"dev": {"id": "prod_...", "price": 3990}, "prod": {...}}
-- ---------------------------------------------------------------------
alter table public.plans add column if not exists provider_products jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------
-- 2. Checkouts iniciados
-- ---------------------------------------------------------------------
create table if not exists public.billing_checkouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  plan public.plan_tier not null,
  provider text not null,
  provider_checkout_id text,
  provider_customer_id text,
  url text,
  amount_cents int not null check (amount_cents >= 0),
  dev_mode boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (provider, provider_checkout_id)
);
create index if not exists billing_checkouts_org_idx on public.billing_checkouts (organization_id, created_at desc);
alter table public.billing_checkouts enable row level security;
revoke all on public.billing_checkouts from anon, authenticated;
grant select on public.billing_checkouts to authenticated;
create policy billing_checkouts_select on public.billing_checkouts for select to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));

-- ---------------------------------------------------------------------
-- 3. Status efetivo: período pago vencido sem renovação deixa de ser "ativo"
--    active  + 3 dias após o fim do período  -> past_due (ainda escreve)
--    past_due + 10 dias após o fim do período -> expired (somente leitura)
-- ---------------------------------------------------------------------
create or replace function public.subscription_effective_status(p_org uuid)
returns public.subscription_status language sql stable security definer set search_path = '' as $$
  select case
    when s.organization_id is null then 'expired'::public.subscription_status
    when s.status = 'trialing' and s.trial_ends_at < now() then 'expired'::public.subscription_status
    when s.status = 'canceled' and s.current_period_end is not null and s.current_period_end > now()
      then 'active'::public.subscription_status
    when s.status in ('active', 'past_due') and s.current_period_end is not null
      and s.current_period_end < now() - interval '10 days' then 'expired'::public.subscription_status
    when s.status = 'active' and s.current_period_end is not null
      and s.current_period_end < now() - interval '3 days' then 'past_due'::public.subscription_status
    else s.status
  end
  from (select 1) x
  left join public.subscriptions s on s.organization_id = p_org;
$$;

-- ---------------------------------------------------------------------
-- 4. Aplicação atômica e idempotente de um evento já autenticado
--    p: { provider, event_id, event_type, kind, checkout_id, subscription_id,
--         customer_id, payment_id, amount_cents, paid_at, dev_mode, payload }
--    kind: paid | failed | canceled | refunded | ignored
-- ---------------------------------------------------------------------
create or replace function public.billing_apply_event(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_event uuid;
  v_co public.billing_checkouts;
  v_org uuid;
  v_kind text := p->>'kind';
  v_paid_at timestamptz := coalesce((p->>'paid_at')::timestamptz, now());
  v_sub text := nullif(p->>'subscription_id', '');
  v_err text;
begin
  insert into public.payment_events (provider, event_id, event_type, payload)
  values (p->>'provider', p->>'event_id', p->>'event_type', coalesce(p->'payload', '{}'::jsonb))
  on conflict (provider, event_id) do nothing
  returning id into v_event;
  if v_event is null then
    return jsonb_build_object('status', 'duplicate');
  end if;

  if v_kind = 'ignored' then
    update public.payment_events set processed_at = now() where id = v_event;
    return jsonb_build_object('status', 'ignored');
  end if;

  -- Identifica a organização pelo checkout que NÓS criamos (ou pela assinatura já vinculada)
  select * into v_co from public.billing_checkouts
   where provider = p->>'provider' and provider_checkout_id = p->>'checkout_id';
  v_org := v_co.organization_id;
  if v_org is null and v_sub is not null then
    select organization_id into v_org from public.subscriptions
     where provider = p->>'provider' and provider_subscription_id = v_sub;
  end if;
  if v_org is null then
    update public.payment_events set error = 'ORGANIZATION_NOT_IDENTIFIED' where id = v_event;
    return jsonb_build_object('status', 'error', 'error', 'ORGANIZATION_NOT_IDENTIFIED');
  end if;
  update public.payment_events set organization_id = v_org where id = v_event;

  -- Eventos de modo teste nunca liberam plano num checkout de produção (e vice-versa)
  if v_co.id is not null and coalesce((p->>'dev_mode')::boolean, false) <> v_co.dev_mode then
    update public.payment_events set error = 'ENVIRONMENT_MISMATCH' where id = v_event;
    return jsonb_build_object('status', 'error', 'error', 'ENVIRONMENT_MISMATCH');
  end if;

  if v_kind = 'paid' then
    update public.subscriptions set
      status = 'active',
      plan = coalesce(v_co.plan, plan),
      provider = p->>'provider',
      provider_subscription_id = coalesce(v_sub, provider_subscription_id),
      provider_customer_id = coalesce(nullif(p->>'customer_id', ''), provider_customer_id),
      current_period_start = v_paid_at,
      current_period_end = greatest(coalesce(current_period_end, v_paid_at), v_paid_at) + interval '1 month',
      canceled_at = null
    where organization_id = v_org;
    if nullif(p->>'payment_id', '') is not null then
      insert into public.payments (organization_id, provider, provider_payment_id, payment_event_id, plan, amount_cents, status, paid_at, period_start, period_end)
      select v_org, p->>'provider', p->>'payment_id', v_event, s.plan, coalesce((p->>'amount_cents')::int, 0), 'paid', v_paid_at, s.current_period_start, s.current_period_end
        from public.subscriptions s where s.organization_id = v_org
      on conflict (provider, provider_payment_id) do update set status = 'paid', paid_at = excluded.paid_at;
    end if;
    update public.billing_checkouts set status = 'completed', completed_at = now() where id = v_co.id and status <> 'completed';

  elsif v_kind = 'failed' then
    update public.subscriptions set status = 'past_due'
     where organization_id = v_org and status = 'active';
    if nullif(p->>'payment_id', '') is not null then
      insert into public.payments (organization_id, provider, provider_payment_id, payment_event_id, plan, amount_cents, status)
      select v_org, p->>'provider', p->>'payment_id', v_event, s.plan, coalesce((p->>'amount_cents')::int, 0), 'failed'
        from public.subscriptions s where s.organization_id = v_org
      on conflict (provider, provider_payment_id) do nothing;
    end if;

  elsif v_kind = 'canceled' then
    -- mantém o acesso até o fim do período já pago (ver subscription_effective_status)
    update public.subscriptions set status = 'canceled', canceled_at = now()
     where organization_id = v_org and (v_sub is null or provider_subscription_id is null or provider_subscription_id = v_sub);

  elsif v_kind = 'refunded' then
    update public.payments set status = 'refunded'
     where provider = p->>'provider' and provider_payment_id = p->>'payment_id';

  else
    v_err := 'UNKNOWN_KIND';
  end if;

  update public.payment_events set processed_at = case when v_err is null then now() end, error = v_err where id = v_event;
  return jsonb_build_object('status', coalesce(v_err, 'applied'), 'organization_id', v_org);
end $$;

revoke execute on function public.billing_apply_event(jsonb) from public, anon, authenticated;
grant execute on function public.billing_apply_event(jsonb) to service_role;
