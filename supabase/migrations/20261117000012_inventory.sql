-- =====================================================================
-- VoltaCerta — 0012: controle de estoque e sugestão de compras.
-- Aditiva: novas colunas opcionais em products + tabela de movimentações.
-- * Estoque só é controlado para produtos com track_stock = true.
-- * Venda (purchase_items) baixa o estoque automaticamente (trigger).
-- * Exclusão de compra pelo usuário devolve o estoque (delete_purchase).
--   A exclusão de cliente (LGPD) NÃO devolve: a mercadoria saiu de fato.
-- * Escrita de movimentações somente via RPC (stock_adjust) ou triggers.
-- =====================================================================

alter table public.products
  add column track_stock boolean not null default false,
  add column stock_qty numeric(12,3) not null default 0,
  add column min_stock numeric(12,3) check (min_stock >= 0),
  add column supplier text check (char_length(supplier) <= 120),
  add column lead_time_days int not null default 7 check (lead_time_days between 0 and 120);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  product_id uuid not null,
  kind text not null check (kind in ('entrada', 'venda', 'estorno_venda', 'ajuste', 'perda', 'inventario')),
  quantity numeric(12,3) not null check (quantity <> 0), -- delta com sinal
  balance_after numeric(12,3) not null,
  unit_cost numeric(12,2) check (unit_cost >= 0),
  purchase_id uuid references public.purchases (id) on delete set null,
  notes text check (char_length(notes) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (product_id, organization_id) references public.products (id, organization_id) on delete cascade
);
create index stock_movements_org_date_idx on public.stock_movements (organization_id, created_at desc);
create index stock_movements_product_idx on public.stock_movements (product_id, created_at desc);

alter table public.stock_movements enable row level security;
create policy stock_movements_select on public.stock_movements for select to authenticated
  using (public.is_org_member(organization_id));

-- stock_qty só muda por movimentação (RPC/trigger), nunca por UPDATE direto do navegador.
create or replace function public.products_protect_stock()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_setting('vc.stock_write', true) is distinct from 'on' then
    if tg_op = 'INSERT' then
      new.stock_qty := 0;
    else
      new.stock_qty := old.stock_qty;
    end if;
  end if;
  return new;
end $$;
create trigger products_protect_stock before insert or update on public.products
  for each row execute function public.products_protect_stock();

-- Aplica um delta ao estoque e registra a movimentação (uso interno)
create or replace function public._stock_apply(
  p_org uuid, p_product uuid, p_kind text, p_delta numeric, p_unit_cost numeric,
  p_purchase uuid, p_notes text
) returns numeric language plpgsql security definer set search_path = '' as $$
declare v_balance numeric;
begin
  perform set_config('vc.stock_write', 'on', true);
  update public.products set stock_qty = stock_qty + p_delta
   where id = p_product and organization_id = p_org
  returning stock_qty into v_balance;
  perform set_config('vc.stock_write', 'off', true);
  if v_balance is null then raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.stock_movements (organization_id, product_id, kind, quantity, balance_after, unit_cost,
                                      purchase_id, notes, created_by)
  values (p_org, p_product, p_kind, p_delta, v_balance, p_unit_cost, p_purchase, nullif(trim(p_notes), ''), auth.uid());
  return v_balance;
end $$;

-- Entrada, ajuste, perda ou contagem de inventário (pelo painel)
-- p_kind: entrada (qtd > 0), perda (qtd > 0, baixa), ajuste (qtd com sinal), inventario (qtd = saldo contado)
create or replace function public.stock_adjust(
  p_org uuid, p_product uuid, p_kind text, p_quantity numeric,
  p_unit_cost numeric default null, p_notes text default null, p_update_cost boolean default false
) returns numeric language plpgsql security definer set search_path = '' as $$
declare v_prod public.products; v_delta numeric; v_balance numeric;
begin
  perform public._assert_member(p_org);
  perform public._assert_writable(p_org);
  select * into v_prod from public.products where id = p_product and organization_id = p_org for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_quantity is null or abs(p_quantity) > 1000000 or (p_unit_cost is not null and p_unit_cost < 0) then
    raise exception 'INVALID_QUANTITY' using errcode = '22023';
  end if;
  case p_kind
    when 'entrada' then
      if p_quantity <= 0 then raise exception 'INVALID_QUANTITY' using errcode = '22023'; end if;
      v_delta := p_quantity;
    when 'perda' then
      if p_quantity <= 0 then raise exception 'INVALID_QUANTITY' using errcode = '22023'; end if;
      v_delta := -p_quantity;
    when 'ajuste' then
      if p_quantity = 0 then raise exception 'INVALID_QUANTITY' using errcode = '22023'; end if;
      v_delta := p_quantity;
    when 'inventario' then
      if p_quantity < 0 then raise exception 'INVALID_QUANTITY' using errcode = '22023'; end if;
      v_delta := p_quantity - v_prod.stock_qty;
      if v_delta = 0 then return v_prod.stock_qty; end if;
    else
      raise exception 'INVALID_QUANTITY' using errcode = '22023';
  end case;

  -- Primeira movimentação liga o controle de estoque do produto
  if not v_prod.track_stock then
    update public.products set track_stock = true where id = p_product;
  end if;
  v_balance := public._stock_apply(p_org, p_product, p_kind, v_delta, p_unit_cost, null, p_notes);
  if p_kind = 'entrada' and p_update_cost and p_unit_cost is not null then
    update public.products set cost = p_unit_cost where id = p_product;
  end if;
  return v_balance;
end $$;

-- Venda registrada => baixa automática (somente produtos com estoque controlado)
create or replace function public.purchase_items_stock_out()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.products where id = new.product_id and track_stock) then
    perform public._stock_apply(new.organization_id, new.product_id, 'venda', -new.quantity, null, new.purchase_id, null);
  end if;
  return new;
end $$;
create trigger purchase_items_stock_out after insert on public.purchase_items
  for each row execute function public.purchase_items_stock_out();

-- Exclusão de compra pelo usuário: devolve ao estoque o que foi baixado por ela
create or replace function public.delete_purchase(p_purchase uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; r record;
begin
  select organization_id into v_org from public.purchases where id = p_purchase;
  if v_org is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform public._assert_member(v_org, array['owner', 'admin']::public.member_role[]);

  for r in
    select product_id, -sum(quantity) as qty from public.stock_movements
     where purchase_id = p_purchase and kind in ('venda', 'estorno_venda')
     group by product_id having sum(quantity) <> 0
  loop
    perform public._stock_apply(v_org, r.product_id, 'estorno_venda', r.qty, null, null,
                                'Compra excluída');
  end loop;

  delete from public.replenishment_predictions where source_purchase_id = p_purchase;
  update public.replenishment_predictions
     set status = case when contacted_at is not null then 'contacted'::public.prediction_status else 'open'::public.prediction_status end,
         completed_at = null, completed_purchase_id = null, recovered = false, recovered_amount = 0
   where completed_purchase_id = p_purchase and status = 'completed';
  delete from public.purchases where id = p_purchase;
end $$;

-- ---------------------------------------------------------------------
-- Sugestão de compras ao fornecedor
-- Janela = horizonte + prazo de entrega do fornecedor.
-- Demanda prevista = maior valor entre:
--   (a) recompras previstas dos clientes que vencem na janela (quantidade)
--   (b) média diária de vendas dos últimos 90 dias × janela
-- Sugerido = demanda + estoque mínimo − estoque atual (nunca negativo).
-- ---------------------------------------------------------------------
create or replace function public.stock_overview(p_org uuid, p_horizon_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date; v jsonb;
begin
  perform public._assert_member(p_org);
  if p_horizon_days is null or p_horizon_days not between 7 and 120 then
    raise exception 'INVALID_PERIOD' using errcode = '22023';
  end if;
  v_today := public.org_today(p_org);

  select coalesce(jsonb_agg(r order by r.suggested_qty desc, r.name), '[]'::jsonb) into v from (
    select x.*,
           greatest(0, ceil(x.forecast + coalesce(x.min_stock, 0) - x.stock_qty))::numeric as suggested_qty,
           round(greatest(0, ceil(x.forecast + coalesce(x.min_stock, 0) - x.stock_qty)) * coalesce(x.cost, 0), 2) as suggested_cost,
           case when x.avg_daily > 0 then floor(greatest(x.stock_qty, 0) / x.avg_daily)::int end as coverage_days,
           (x.stock_qty <= coalesce(x.min_stock, 0)) as low_stock
      from (
        select p.id, p.name, p.category, p.brand, p.unit, p.supplier, p.cost, p.price,
               p.stock_qty, p.min_stock, p.lead_time_days,
               p_horizon_days + p.lead_time_days as window_days,
               round(coalesce(s.sold_90, 0) / 90.0, 3) as avg_daily,
               coalesce(s.sold_90, 0) as sold_90,
               coalesce(f.predicted_qty, 0) as predicted_qty,
               coalesce(f.predicted_customers, 0) as predicted_customers,
               greatest(coalesce(f.predicted_qty, 0),
                        round(coalesce(s.sold_90, 0) / 90.0 * (p_horizon_days + p.lead_time_days), 2)) as forecast
          from public.products p
          left join lateral (
            select sum(pi.quantity) as sold_90
              from public.purchase_items pi join public.purchases pu on pu.id = pi.purchase_id
             where pi.product_id = p.id and pu.purchase_date > v_today - 90
          ) s on true
          left join lateral (
            select sum(rp.quantity) as predicted_qty, count(distinct rp.customer_id) as predicted_customers
              from public.replenishment_predictions rp
             where rp.product_id = p.id and rp.status in ('open', 'contacted')
               and rp.expected_date <= v_today + p_horizon_days + p.lead_time_days
          ) f on true
         where p.organization_id = p_org and p.active and p.track_stock
      ) x
  ) r;
  return jsonb_build_object(
    'today', v_today,
    'horizon_days', p_horizon_days,
    'products', v,
    'totals', jsonb_build_object(
      'tracked', (select count(*) from public.products where organization_id = p_org and active and track_stock),
      'low_stock', (select count(*) from public.products where organization_id = p_org and active and track_stock
                      and stock_qty <= coalesce(min_stock, 0)),
      'stock_value', (select coalesce(round(sum(greatest(stock_qty, 0) * coalesce(cost, 0)), 2), 0)
                        from public.products where organization_id = p_org and active and track_stock),
      'stock_sale_value', (select coalesce(round(sum(greatest(stock_qty, 0) * price), 2), 0)
                        from public.products where organization_id = p_org and active and track_stock)
    )
  );
end $$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
revoke execute on function public._stock_apply(uuid, uuid, text, numeric, numeric, uuid, text) from public, anon, authenticated;
revoke execute on function public.products_protect_stock() from public, anon, authenticated;
revoke execute on function public.purchase_items_stock_out() from public, anon, authenticated;
revoke execute on function public.stock_adjust(uuid, uuid, text, numeric, numeric, text, boolean) from public, anon;
revoke execute on function public.stock_overview(uuid, int) from public, anon;
revoke execute on function public.delete_purchase(uuid) from public, anon;
grant execute on function public.stock_adjust(uuid, uuid, text, numeric, numeric, text, boolean) to authenticated;
grant execute on function public.stock_overview(uuid, int) to authenticated;
grant execute on function public.delete_purchase(uuid) to authenticated;
