-- =====================================================================
-- VoltaCerta — 0016: lembretes (aniversário do pet, pós-venda, lembrete
-- de agendamento, retorno de serviço, pacote vencendo), análise de
-- consumo por cliente e segmentação da base. Aditiva.
-- =====================================================================

alter table public.organizations
  add column post_sale_days int not null default 3 check (post_sale_days between 1 and 30);
grant update (post_sale_days) on public.organizations to authenticated;

-- Novos tipos de modelo de mensagem
alter table public.message_templates drop constraint if exists message_templates_kind_check;
alter table public.message_templates add constraint message_templates_kind_check
  check (kind in ('reposicao', 'atrasado', 'recompra', 'custom',
                  'aniversario', 'pos_venda', 'lembrete_agendamento', 'retorno_servico', 'pacote_vencendo'));

-- Lembrete já tratado (evita aparecer de novo)
alter table public.contact_logs add column reminder_key text check (char_length(reminder_key) <= 200);
create index contact_logs_reminder_idx on public.contact_logs (organization_id, reminder_key) where reminder_key is not null;

-- Modelos padrão (os 3 originais + os novos)
create or replace function public._seed_default_templates(p_org uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.message_templates (organization_id, name, kind, body, is_default)
  select p_org, t.name, t.kind, t.body, true
    from (values
      ('Reposição', 'reposicao',
       'Olá, {nome}! Tudo bem? Estamos passando para saber se você está precisando repor {produto} para seu pet. Podemos separar para você!'),
      ('Cliente atrasado', 'atrasado',
       'Olá, {nome}! Sentimos sua falta por aqui. Está precisando de algum produto para seu pet? Estamos à disposição para ajudar!'),
      ('Recompra', 'recompra',
       'Olá, {nome}! Está chegando o período de reposição de {produto}. Se precisar, podemos deixar seu pedido preparado!'),
      ('Aniversário do pet', 'aniversario',
       'Olá, {nome}! Hoje é um dia especial: parabéns ao {pet}! 🎉 Que ele tenha muita saúde e alegria. Um abraço da equipe!'),
      ('Pós-venda', 'pos_venda',
       'Olá, {nome}! Tudo certo com a sua compra? Se o {pet} gostou ou se tiver alguma dúvida, é só chamar. Obrigado pela preferência!'),
      ('Lembrete de agendamento', 'lembrete_agendamento',
       'Olá, {nome}! Lembrando do {servico} do {pet} em {data} às {hora}. Podemos confirmar?'),
      ('Retorno de serviço', 'retorno_servico',
       'Olá, {nome}! Já está na hora do próximo {servico} do {pet}. Quer que a gente reserve um horário?'),
      ('Pacote vencendo', 'pacote_vencendo',
       'Olá, {nome}! O pacote {pacote} do {pet} vence em {data} e ainda tem sessões disponíveis. Vamos agendar?')
    ) as t(name, kind, body)
   where not exists (
     select 1 from public.message_templates m where m.organization_id = p_org and m.is_default and m.kind = t.kind);
$$;
revoke execute on function public._seed_default_templates(uuid) from public, anon, authenticated;

-- Organizações existentes recebem os novos modelos padrão (os atuais não mudam)
select public._seed_default_templates(id) from public.organizations;

-- ---------------------------------------------------------------------
-- Lembretes do dia (uso interno; também usado pelo envio automático)
-- ---------------------------------------------------------------------
create or replace function public._reminders(p_org uuid, p_days_ahead int)
returns table (
  key text, kind text, due_date date, customer_id uuid, customer_name text, phone text,
  marketing_consent boolean, do_not_contact boolean, pet_name text, service_name text,
  appointment_id uuid, starts_at timestamptz, detail text
) language plpgsql stable security definer set search_path = '' as $$
declare v_today date; v_tz text; v_post int;
begin
  select timezone, post_sale_days into v_tz, v_post from public.organizations where id = p_org;
  v_today := public.org_today(p_org);
  return query
  with items as (
    -- Aniversário do pet (29/02 comemora em 28/02 nos anos não bissextos)
    select 'aniversario:' || pe.id || ':' || extract(year from b.bday)::int as key, 'aniversario'::text as kind,
           b.bday as due_date, c.id as customer_id, pe.name as pet_name, null::text as service_name,
           null::uuid as appointment_id, null::timestamptz as starts_at,
           (extract(year from b.bday)::int - extract(year from pe.birth_date)::int) || ' ano(s)' as detail
      from public.pets pe join public.customers c on c.id = pe.customer_id
      cross join lateral (
        select d::date as bday from generate_series(v_today, v_today + p_days_ahead, interval '1 day') d
         where (extract(month from d) = extract(month from pe.birth_date) and extract(day from d) = extract(day from pe.birth_date))
            or (extract(month from pe.birth_date) = 2 and extract(day from pe.birth_date) = 29
                and extract(month from d) = 2 and extract(day from d) = 28
                and extract(day from (date_trunc('year', d) + interval '2 months' - interval '1 day')) = 28)
      ) b
     where pe.organization_id = p_org and pe.birth_date is not null and pe.birth_date < v_today
    union all
    -- Pós-venda: compras de N dias atrás (janela de 7 dias para não perder ninguém)
    select 'pos_venda:' || pu.id, 'pos_venda', pu.purchase_date + v_post, pu.customer_id,
           (select pe.name from public.pets pe where pe.customer_id = pu.customer_id order by pe.created_at limit 1),
           null, null, null,
           'Compra de ' || to_char(pu.purchase_date, 'DD/MM')
      from public.purchases pu
     where pu.organization_id = p_org and pu.customer_id is not null and pu.channel in ('registro', 'pdv')
       and pu.purchase_date + v_post between v_today - 7 and v_today
    union all
    -- Lembrete de agendamento (hoje e amanhã)
    select 'agenda:' || a.id, 'lembrete_agendamento', (a.starts_at at time zone v_tz)::date, a.customer_id,
           (select pe.name from public.pets pe where pe.id = a.pet_id), s.name, a.id, a.starts_at,
           to_char(a.starts_at at time zone v_tz, 'DD/MM HH24:MI')
      from public.appointments a join public.services s on s.id = a.service_id
     where a.organization_id = p_org and a.customer_id is not null and a.status in ('scheduled', 'confirmed')
       and (a.starts_at at time zone v_tz)::date between v_today and v_today + 1
       and a.starts_at > now()
    union all
    -- Retorno de serviço (ex.: banho a cada 15 dias)
    select 'retorno:' || r.customer_id || ':' || r.service_id || ':' || r.due, 'retorno_servico', r.due, r.customer_id,
           r.pet_name, r.service_name, null, null, 'Último em ' || to_char(r.last_date, 'DD/MM')
      from (
        select a.customer_id, a.service_id, s.name as service_name,
               max((a.starts_at at time zone v_tz)::date) as last_date,
               max((a.starts_at at time zone v_tz)::date) + max(s.return_days) as due,
               (array_agg(pe.name order by a.starts_at desc))[1] as pet_name
          from public.appointments a join public.services s on s.id = a.service_id
          left join public.pets pe on pe.id = a.pet_id
         where a.organization_id = p_org and a.status = 'done' and a.customer_id is not null and s.return_days is not null
         group by a.customer_id, a.service_id, s.name
      ) r
     where r.due between v_today - 7 and v_today + p_days_ahead
       and not exists (
         select 1 from public.appointments f where f.customer_id = r.customer_id and f.service_id = r.service_id
            and f.status in ('requested', 'scheduled', 'confirmed', 'in_progress') and f.starts_at > now() - interval '1 day')
    union all
    -- Pacote com sessões sobrando perto do vencimento
    select 'pacote:' || cp.id, 'pacote_vencendo', cp.expires_at, cp.customer_id,
           (select pe.name from public.pets pe where pe.id = cp.pet_id), cp.name, null, null,
           (cp.sessions_total - cp.sessions_used) || ' sessão(ões) restante(s)'
      from public.customer_packages cp
     where cp.organization_id = p_org and cp.status = 'active' and cp.sessions_used < cp.sessions_total
       and cp.expires_at between v_today and v_today + greatest(p_days_ahead, 7)
  )
  select i.key, i.kind, i.due_date, i.customer_id, c.full_name, c.phone_normalized, c.marketing_consent, c.do_not_contact,
         i.pet_name, i.service_name, i.appointment_id, i.starts_at, i.detail
    from items i join public.customers c on c.id = i.customer_id
   where not exists (select 1 from public.contact_logs cl where cl.organization_id = p_org and cl.reminder_key = i.key)
   order by i.due_date, c.full_name;
end $$;

create or replace function public.get_reminders(p_org uuid, p_days_ahead int default 7)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._assert_member(p_org);
  if p_days_ahead is null or p_days_ahead not between 0 and 30 then raise exception 'INVALID_PERIOD' using errcode = '22023'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public._reminders(p_org, p_days_ahead) r);
end $$;

-- Registra o contato de um lembrete (após o usuário confirmar o envio)
create or replace function public.log_reminder_contact(
  p_org uuid, p_customer uuid, p_key text, p_result public.contact_result,
  p_template uuid default null, p_message text default null, p_notes text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_dnc boolean;
begin
  perform public._assert_member(p_org);
  perform public._assert_writable(p_org);
  if p_key is null or p_key !~ '^(aniversario|pos_venda|agenda|retorno|pacote):' or char_length(p_key) > 200 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  select do_not_contact into v_dnc from public.customers where id = p_customer and organization_id = p_org;
  if not found then raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002'; end if;
  -- Lembrete de agendamento é transacional; os demais respeitam a oposição ao contato
  if v_dnc and p_key !~ '^agenda:' then raise exception 'CUSTOMER_OPTED_OUT' using errcode = 'P0001'; end if;
  if p_template is not null and not exists (select 1 from public.message_templates where id = p_template and organization_id = p_org) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if (select count(*) from public.contact_logs where user_id = auth.uid() and contacted_at > now() - interval '1 minute') >= 20 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
  insert into public.contact_logs (organization_id, customer_id, template_id, channel, message, result, notes, user_id, reminder_key)
  values (p_org, p_customer, p_template, 'whatsapp_link', left(p_message, 2000), p_result, nullif(trim(p_notes), ''),
          auth.uid(), p_key)
  returning id into v_id;
  -- Lembrete de agendamento respondido => agendamento confirmado
  if p_key ~ '^agenda:' and p_result in ('respondeu', 'comprou') then
    update public.appointments set status = 'confirmed'
     where organization_id = p_org and id = substring(p_key from 8)::uuid and status = 'scheduled';
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Análise de consumo de um cliente
-- ---------------------------------------------------------------------
create or replace function public.customer_insights(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid; v_today date; v_total numeric; v_count int; v_first date; v_last date; v_rank numeric;
begin
  select organization_id into v_org from public.customers where id = p_customer;
  if v_org is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform public._assert_member(v_org);
  v_today := public.org_today(v_org);
  select coalesce(sum(total), 0), count(*), min(purchase_date), max(purchase_date)
    into v_total, v_count, v_first, v_last
    from public.purchases where customer_id = p_customer;

  -- Posição do cliente no faturamento dos últimos 12 meses (percentil)
  select round((100 * percent_rank)::numeric, 0) into v_rank from (
    select customer_id, percent_rank() over (order by sum(total)) as percent_rank
      from public.purchases where organization_id = v_org and customer_id is not null and purchase_date > v_today - 365
     group by customer_id) x where x.customer_id = p_customer;

  return jsonb_build_object(
    'total_spent', v_total,
    'purchases_count', v_count,
    'avg_ticket', case when v_count > 0 then round(v_total / v_count, 2) else 0 end,
    'first_purchase', v_first,
    'last_purchase', v_last,
    'days_since_last', case when v_last is not null then v_today - v_last end,
    'avg_interval_days', case when v_count > 1 then round((v_last - v_first)::numeric / (v_count - 1), 1) end,
    'spent_12m', (select coalesce(sum(total), 0) from public.purchases where customer_id = p_customer and purchase_date > v_today - 365),
    'percentile_12m', v_rank,
    'services_count', (select count(*) from public.appointments where customer_id = p_customer and status = 'done'),
    'no_show_count', (select count(*) from public.appointments where customer_id = p_customer and status = 'no_show'),
    'receivable_open', (select coalesce(sum(amount), 0) from public.finance_entries
                         where customer_id = p_customer and kind = 'income' and status = 'pending'),
    'top_products', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select pr.name, sum(pi.quantity) as quantity, sum(pi.total) as total, count(distinct pu.id) as times
          from public.purchase_items pi join public.purchases pu on pu.id = pi.purchase_id
          join public.products pr on pr.id = pi.product_id
         where pu.customer_id = p_customer group by pr.id, pr.name order by sum(pi.total) desc limit 5) t),
    'by_category', (select coalesce(jsonb_object_agg(cat, tot), '{}'::jsonb) from (
        select pr.category::text as cat, sum(pi.total) as tot
          from public.purchase_items pi join public.purchases pu on pu.id = pi.purchase_id
          join public.products pr on pr.id = pi.product_id
         where pu.customer_id = p_customer group by pr.category
        union all
        select 'servicos', sum(ps.total) from public.purchase_services ps join public.purchases pu on pu.id = ps.purchase_id
         where pu.customer_id = p_customer having sum(ps.total) > 0) t),
    'monthly', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'total', coalesce(t.total, 0)) order by m), '[]'::jsonb)
        from generate_series(date_trunc('month', v_today) - interval '11 months', date_trunc('month', v_today), interval '1 month') m
        left join lateral (
          select sum(total) as total from public.purchases
           where customer_id = p_customer and date_trunc('month', purchase_date) = m) t on true),
    'packages', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', cp.id, 'name', cp.name, 'sessions_total', cp.sessions_total, 'sessions_used', cp.sessions_used,
        'expires_at', cp.expires_at, 'status', cp.status, 'pet_id', cp.pet_id, 'service_id', cp.service_id) order by cp.created_at desc), '[]'::jsonb)
        from public.customer_packages cp where cp.customer_id = p_customer)
  );
end $$;

-- ---------------------------------------------------------------------
-- Segmentação da base (recência × frequência × valor, últimos 12 meses)
-- ---------------------------------------------------------------------
create or replace function public.customer_segments(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date;
begin
  perform public._assert_member(p_org);
  v_today := public.org_today(p_org);
  return (
    with base as (
      select c.id, c.full_name, c.phone, c.do_not_contact,
             max(pu.purchase_date) as last_date, min(pu.purchase_date) as first_date,
             count(pu.id) filter (where pu.purchase_date > v_today - 365) as freq,
             coalesce(sum(pu.total) filter (where pu.purchase_date > v_today - 365), 0) as monetary,
             count(pu.id) as total_count
        from public.customers c left join public.purchases pu on pu.customer_id = c.id
       where c.organization_id = p_org
       group by c.id
    ), seg as (
      select b.*, v_today - b.last_date as recency,
             case
               when b.last_date is null then 'sem_compras'
               when b.total_count = 1 and v_today - b.first_date <= 30 then 'novo'
               when v_today - b.last_date <= 30 and b.freq >= 4 then 'campeao'
               when v_today - b.last_date <= 60 and b.freq >= 2 then 'fiel'
               when v_today - b.last_date between 61 and 120 and b.freq >= 2 then 'em_risco'
               when v_today - b.last_date > 120 then 'perdido'
               else 'ocasional'
             end as segment
        from base b
    )
    select jsonb_build_object(
      'summary', (select coalesce(jsonb_object_agg(segment, jsonb_build_object('count', cnt, 'revenue', rev)), '{}'::jsonb)
                    from (select segment, count(*) as cnt, sum(monetary) as rev from seg group by segment) s),
      'customers', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', id, 'name', full_name, 'phone', phone, 'do_not_contact', do_not_contact, 'segment', segment,
          'recency', recency, 'frequency', freq, 'monetary', monetary,
          'avg_ticket', case when freq > 0 then round(monetary / freq, 2) end) order by monetary desc), '[]'::jsonb)
          from (select * from seg order by monetary desc limit 2000) s2)
    )
  );
end $$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
revoke execute on function public._reminders(uuid, int) from public, anon, authenticated;
grant execute on function public._reminders(uuid, int) to service_role;
do $$
declare f text;
begin
  foreach f in array array[
    'public.get_reminders(uuid, int)',
    'public.log_reminder_contact(uuid, uuid, text, public.contact_result, uuid, text, text)',
    'public.customer_insights(uuid)',
    'public.customer_segments(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
