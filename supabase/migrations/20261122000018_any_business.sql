-- =====================================================================
-- VoltaCerta — 0018: qualquer tipo de estabelecimento (não só pet shop).
-- Aditiva: nenhum dado existente é apagado ou alterado.
--   * ramo do estabelecimento aceita novos tipos (salão, oficina, loja…)
--   * categorias de produto e de serviço e a função do profissional
--     passam a ser texto livre; os valores antigos continuam válidos
--   * modelos de mensagem padrão sem "pet" para quem não é do ramo pet
--     (os modelos de organizações existentes não mudam)
-- =====================================================================

-- Ramo do estabelecimento: códigos curtos (os antigos continuam válidos)
alter table public.organizations drop constraint if exists organizations_business_type_check;
alter table public.organizations add constraint organizations_business_type_check
  check (business_type ~ '^[a-z][a-z_]{1,39}$');

-- Categoria de produto: enum fixo -> texto livre. A view v_predictions
-- depende da coluna, então é recriada com a mesma definição.
drop view if exists public.v_predictions;
alter table public.products alter column category drop default;
alter table public.products alter column category type text using category::text;
alter table public.products alter column category set default 'outros';
alter table public.products add constraint products_category_check
  check (char_length(trim(category)) between 1 and 40);

create view public.v_predictions with (security_invoker = true) as
select
  p.*,
  c.full_name as customer_name, c.phone as customer_phone, c.phone_normalized as customer_phone_normalized,
  c.do_not_contact as customer_do_not_contact,
  pr.name as product_name, pr.category as product_category, pr.price as product_price,
  src.purchase_date as last_purchase_date,
  pet.name as pet_name,
  (p.expected_date - t.today) as days_until,
  case p.status
    when 'open' then case
      when t.today > p.expected_date + o.overdue_after_days then 'atrasada'
      when t.today >= p.expected_date then 'hoje'
      when p.expected_date - t.today <= o.soon_days then 'proxima'
      else 'prevista' end
    when 'contacted' then 'contatada'
    when 'completed' then 'concluida'
    else 'ignorada'
  end as stage,
  (p.status in ('open', 'contacted') and t.today > p.expected_date + o.lost_after_days) as is_lost
from public.replenishment_predictions p
join public.customers c on c.id = p.customer_id
join public.products pr on pr.id = p.product_id
join public.purchases src on src.id = p.source_purchase_id
join public.organizations o on o.id = p.organization_id
cross join lateral (select (now() at time zone o.timezone)::date as today) t
left join lateral (
  select pe.name from public.pets pe where pe.customer_id = c.id order by pe.created_at limit 1
) pet on true;
grant select on public.v_predictions to authenticated, service_role;

-- Categoria de serviço e função do profissional: texto livre
alter table public.services drop constraint if exists services_category_check;
alter table public.services alter column category set default 'outro';
alter table public.services add constraint services_category_check
  check (char_length(trim(category)) between 1 and 40);

alter table public.professionals drop constraint if exists professionals_role_check;
alter table public.professionals alter column role set default 'outro';
alter table public.professionals add constraint professionals_role_check
  check (char_length(trim(role)) between 1 and 40);

-- Modelos padrão: texto sem "pet" para quem não é do ramo pet
create or replace function public._is_pet_business(p_type text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_type, '') in ('pet_shop', 'loja_racao', 'veterinario', 'delivery')
$$;
revoke execute on function public._is_pet_business(text) from public, anon, authenticated;

create or replace function public._seed_default_templates(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pet boolean;
begin
  select public._is_pet_business(business_type) into v_pet from public.organizations where id = p_org;
  insert into public.message_templates (organization_id, name, kind, body, is_default)
  select p_org, t.name, t.kind, case when v_pet then t.pet_body else t.body end, true
    from (values
      ('Reposição', 'reposicao',
       'Olá, {nome}! Tudo bem? Estamos passando para saber se você está precisando repor {produto}. Podemos separar para você!',
       'Olá, {nome}! Tudo bem? Estamos passando para saber se você está precisando repor {produto} para seu pet. Podemos separar para você!'),
      ('Cliente atrasado', 'atrasado',
       'Olá, {nome}! Sentimos sua falta por aqui. Está precisando de alguma coisa? Estamos à disposição para ajudar!',
       'Olá, {nome}! Sentimos sua falta por aqui. Está precisando de algum produto para seu pet? Estamos à disposição para ajudar!'),
      ('Recompra', 'recompra',
       'Olá, {nome}! Está chegando o período de reposição de {produto}. Se precisar, podemos deixar seu pedido preparado!',
       'Olá, {nome}! Está chegando o período de reposição de {produto}. Se precisar, podemos deixar seu pedido preparado!'),
      ('Aniversário do pet', 'aniversario',
       'Olá, {nome}! Hoje é um dia especial: parabéns ao {pet}! 🎉 Muita saúde e alegria. Um abraço da equipe!',
       'Olá, {nome}! Hoje é um dia especial: parabéns ao {pet}! 🎉 Que ele tenha muita saúde e alegria. Um abraço da equipe!'),
      ('Pós-venda', 'pos_venda',
       'Olá, {nome}! Tudo certo com a sua compra? Se tiver alguma dúvida, é só chamar. Obrigado pela preferência!',
       'Olá, {nome}! Tudo certo com a sua compra? Se o {pet} gostou ou se tiver alguma dúvida, é só chamar. Obrigado pela preferência!'),
      ('Lembrete de agendamento', 'lembrete_agendamento',
       'Olá, {nome}! Lembrando do seu horário de {servico} em {data} às {hora}. Podemos confirmar?',
       'Olá, {nome}! Lembrando do {servico} do {pet} em {data} às {hora}. Podemos confirmar?'),
      ('Retorno de serviço', 'retorno_servico',
       'Olá, {nome}! Já está na hora do seu próximo {servico}. Quer que a gente reserve um horário?',
       'Olá, {nome}! Já está na hora do próximo {servico} do {pet}. Quer que a gente reserve um horário?'),
      ('Pacote vencendo', 'pacote_vencendo',
       'Olá, {nome}! Seu pacote {pacote} vence em {data} e ainda tem sessões disponíveis. Vamos agendar?',
       'Olá, {nome}! O pacote {pacote} do {pet} vence em {data} e ainda tem sessões disponíveis. Vamos agendar?')
    ) as t(name, kind, body, pet_body)
   where not exists (
     select 1 from public.message_templates m where m.organization_id = p_org and m.is_default and m.kind = t.kind);
end $$;
revoke execute on function public._seed_default_templates(uuid) from public, anon, authenticated;
