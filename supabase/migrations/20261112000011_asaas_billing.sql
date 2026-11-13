-- 0011 — Asaas como gateway + ajustes de robustez em billing_apply_event (aditiva).
--
-- 1. Pagamento já registrado como pago não estende o período de novo. No Asaas, cartão
--    gera PAYMENT_CONFIRMED e, semanas depois, PAYMENT_RECEIVED do MESMO pagamento
--    (ids de evento diferentes, então a idempotência por evento não bastava).
-- 2. Falha/cancelamento só afetam a assinatura vigente: eventos de uma assinatura antiga
--    ou abandonada (ex.: cobrança removida porque a pessoa desistiu) não derrubam o teste
--    grátis nem uma assinatura ativa diferente.
-- 3. Cobrança vencida de assinatura que não é a vigente não entra no histórico de pagamentos.
-- 4. Cancelamento de uma assinatura que nunca foi paga marca o checkout como 'failed'.
-- Nenhum dado existente é alterado.

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
    if nullif(p->>'payment_id', '') is not null and exists (
      select 1 from public.payments
       where provider = p->>'provider' and provider_payment_id = p->>'payment_id' and status = 'paid') then
      update public.payment_events set processed_at = now() where id = v_event;
      return jsonb_build_object('status', 'already_paid', 'organization_id', v_org);
    end if;
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
     where organization_id = v_org and status = 'active'
       and (v_sub is null or provider_subscription_id = v_sub);
    if nullif(p->>'payment_id', '') is not null then
      insert into public.payments (organization_id, provider, provider_payment_id, payment_event_id, plan, amount_cents, status)
      select v_org, p->>'provider', p->>'payment_id', v_event, s.plan, coalesce((p->>'amount_cents')::int, 0), 'failed'
        from public.subscriptions s where s.organization_id = v_org
         and (v_sub is null or s.provider_subscription_id = v_sub)
      on conflict (provider, provider_payment_id) do nothing;
    end if;

  elsif v_kind = 'canceled' then
    -- mantém o acesso até o fim do período já pago (ver subscription_effective_status)
    update public.subscriptions set status = 'canceled', canceled_at = now()
     where organization_id = v_org and status <> 'canceled'
       and (v_sub is null or provider_subscription_id = v_sub);
    update public.billing_checkouts set status = 'failed' where id = v_co.id and status = 'pending';

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
