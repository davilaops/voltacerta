-- 0009 — Super Admin: encerrar assinatura e excluir estabelecimento.
--
-- admin_cancel_subscription: encerra a assinatura IMEDIATAMENTE (status canceled e
--   fim do período = agora -> estabelecimento fica somente leitura). O cancelamento
--   no gateway (AbacatePay) é feito antes, pela Edge Function admin-cancel-subscription,
--   que informa o resultado em p_provider_result para a auditoria.
-- admin_delete_organization: exclusão DEFINITIVA, com nome digitado como confirmação.
--   Bloqueada enquanto houver assinatura paga em vigor no gateway (evita continuar
--   cobrando um cliente sem conta). Contas de usuário são preservadas; o histórico
--   financeiro (payments/payment_events) fica sem vínculo (on delete set null).


create or replace function public.admin_cancel_subscription(p_org uuid, p_reason text, p_provider_result text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_sub public.subscriptions;
begin
  perform public._assert_super_admin();
  v_reason := public._require_reason(p_reason);
  select * into v_sub from public.subscriptions where organization_id = p_org for update;
  if v_sub.organization_id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if public.subscription_effective_status(p_org) in ('canceled', 'expired') then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001';
  end if;

  update public.subscriptions set
    status = 'canceled',
    canceled_at = now(),
    current_period_end = least(coalesce(current_period_end, now()), now()),
    trial_ends_at = case when status = 'trialing' then least(coalesce(trial_ends_at, now()), now()) else trial_ends_at end
  where organization_id = p_org;

  perform public._admin_log('cancel_subscription', 'subscription', p_org::text, v_reason, jsonb_build_object(
    'previous_status', v_sub.status, 'plan', v_sub.plan,
    'provider_subscription_id', v_sub.provider_subscription_id,
    'provider_result', left(coalesce(p_provider_result, 'sem assinatura no gateway'), 300)));
  return jsonb_build_object('ok', true);
end $$;

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
  delete from public.replenishment_predictions where organization_id = p_org;
  delete from public.purchase_items where organization_id = p_org;
  delete from public.purchases where organization_id = p_org;
  delete from public.organizations where id = p_org;
  perform public._admin_log('delete_organization', 'organization', p_org::text, v_reason, v_details);
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.admin_cancel_subscription(uuid, text, text) from public, anon;
revoke execute on function public.admin_delete_organization(uuid, text, text) from public, anon;
grant execute on function public.admin_cancel_subscription(uuid, text, text) to authenticated, service_role;
grant execute on function public.admin_delete_organization(uuid, text, text) to authenticated, service_role;
