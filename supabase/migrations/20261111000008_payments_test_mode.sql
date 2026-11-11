-- 0008 — Separa pagamentos de MODO TESTE dos reais (aditiva).
-- Pagamentos feitos com chave abc_dev_ (devMode=true no webhook) não podem
-- contar como receita no painel admin quando a operação passar para produção.

alter table public.payments add column if not exists dev_mode boolean not null default false;

-- Backfill a partir do evento de origem
update public.payments pm set dev_mode = true
  from public.payment_events e
 where e.id = pm.payment_event_id and (e.payload->>'devMode')::boolean is true and pm.dev_mode = false;

-- Novos pagamentos herdam o ambiente do evento que os gerou
create or replace function public.payments_set_dev_mode()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.payment_event_id is not null then
    select coalesce((e.payload->>'devMode')::boolean, false) into new.dev_mode
      from public.payment_events e where e.id = new.payment_event_id;
    new.dev_mode := coalesce(new.dev_mode, false);
  end if;
  return new;
end $$;
revoke execute on function public.payments_set_dev_mode() from public, anon, authenticated;
drop trigger if exists payments_dev_mode on public.payments;
create trigger payments_dev_mode before insert on public.payments
  for each row execute function public.payments_set_dev_mode();

-- Receita do painel: só pagamentos reais; teste aparece separado
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
    'mrr_received_cents', (select coalesce(sum(amount_cents), 0) from public.payments where status = 'paid' and not dev_mode and paid_at >= now() - interval '30 days'),
    'test_received_cents', (select coalesce(sum(amount_cents), 0) from public.payments where status = 'paid' and dev_mode and paid_at >= now() - interval '30 days'),
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
