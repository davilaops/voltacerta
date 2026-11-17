-- =====================================================================
-- VoltaCerta — 0015: catálogo digital e agendamento online (página
-- pública do pet shop em /loja/{slug}). Aditiva.
-- Segurança: as funções públicas NÃO são executáveis por anon nem por
-- authenticated. Só o service role as chama, pela Edge Function
-- public-store (que aplica limites de taxa e valida a entrada). Assim a
-- superfície pública do banco continua zero (ver 0006).
-- =====================================================================

alter table public.organizations
  add column public_slug text unique check (public_slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  add column catalog_enabled boolean not null default false,
  add column booking_enabled boolean not null default false,
  add column show_prices boolean not null default true,
  add column public_whatsapp text check (char_length(public_whatsapp) <= 30),
  add column public_description text check (char_length(public_description) <= 500),
  add column booking_min_notice_hours int not null default 2 check (booking_min_notice_hours between 0 and 72),
  add column booking_days_ahead int not null default 30 check (booking_days_ahead between 1 and 90),
  add constraint organizations_public_slug_required
    check (not (catalog_enabled or booking_enabled) or public_slug is not null);

alter table public.products add column catalog_visible boolean not null default false;

grant update (public_slug, catalog_enabled, booking_enabled, show_prices, public_whatsapp, public_description,
              booking_min_notice_hours, booking_days_ahead)
  on public.organizations to authenticated;

-- Valida horário de funcionamento e normaliza o endereço público
create or replace function public.organizations_validate_public()
returns trigger language plpgsql set search_path = '' as $$
declare k text; v jsonb;
begin
  new.public_slug := nullif(lower(trim(new.public_slug)), '');
  if new.public_slug in ('admin', 'app', 'api', 'loja', 'www', 'suporte', 'voltacerta') then
    raise exception 'SLUG_RESERVED' using errcode = '22023';
  end if;
  if jsonb_typeof(new.business_hours) <> 'object' then raise exception 'INVALID_HOURS' using errcode = '22023'; end if;
  for k in select generate_series(0, 6)::text loop
    v := new.business_hours -> k;
    if v is null or jsonb_typeof(v) = 'null' then continue; end if;
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) <> 2
       or (v ->> 0) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (v ->> 1) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or (v ->> 0)::time >= (v ->> 1)::time then
      raise exception 'INVALID_HOURS' using errcode = '22023';
    end if;
  end loop;
  return new;
end $$;
create trigger organizations_validate_public before insert or update on public.organizations
  for each row execute function public.organizations_validate_public();

-- ---------------------------------------------------------------------
-- Dados públicos da loja (somente o que pode aparecer na internet)
-- ---------------------------------------------------------------------
create or replace function public.public_store(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o public.organizations;
begin
  select * into o from public.organizations
   where public_slug = lower(trim(p_slug)) and (catalog_enabled or booking_enabled);
  if o.id is null or not public.org_can_write(o.id) then return null; end if;
  return jsonb_build_object(
    'name', o.name,
    'description', o.public_description,
    'whatsapp', coalesce(o.public_whatsapp, o.phone),
    'address', o.address, 'city', o.city, 'state', o.state,
    'logo_path', o.logo_path,
    'catalog_enabled', o.catalog_enabled,
    'booking_enabled', o.booking_enabled,
    'show_prices', o.show_prices,
    'business_hours', o.business_hours,
    'booking_days_ahead', o.booking_days_ahead,
    'today', public.org_today(o.id),
    'products', case when o.catalog_enabled then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'category', p.category, 'brand', p.brand,
        'price', case when o.show_prices then p.price end,
        'size_value', p.size_value, 'unit', p.unit, 'description', p.description,
        'available', case when p.track_stock then p.stock_qty > 0 end
      ) order by p.category, p.name), '[]'::jsonb)
      from public.products p where p.organization_id = o.id and p.active and p.catalog_visible) else '[]'::jsonb end,
    'services', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'category', s.category,
        'price', case when o.show_prices then s.price end,
        'duration_minutes', s.duration_minutes, 'description', s.description,
        'bookable', o.booking_enabled and s.bookable_online
      ) order by s.category, s.name), '[]'::jsonb)
      from public.services s
     where s.organization_id = o.id and s.active
       and ((o.catalog_enabled and s.catalog_visible) or (o.booking_enabled and s.bookable_online)))
  );
end $$;

-- ---------------------------------------------------------------------
-- Horários livres de um serviço em uma data (horário local da loja)
-- ---------------------------------------------------------------------
create or replace function public._free_professional(
  p_org uuid, p_starts timestamptz, p_ends timestamptz, p_local_start timestamp, p_minutes int
) returns uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.professionals p
   where p.organization_id = p_org and p.active
     and extract(dow from p_local_start)::int = any (p.work_days)
     and p_local_start::time >= p.work_start
     and (p_local_start + make_interval(mins => p_minutes))::time <= p.work_end
     and (p_local_start + make_interval(mins => p_minutes))::date = p_local_start::date
     and not public._appointment_conflict(p_org, p.id, p_starts, p_ends, null)
   order by (select count(*) from public.appointments a
              where a.professional_id = p.id and a.status not in ('canceled', 'no_show')
                and a.starts_at >= date_trunc('day', p_starts) and a.starts_at < date_trunc('day', p_starts) + interval '1 day'),
            p.created_at
   limit 1;
$$;

create or replace function public._public_slots(o public.organizations, p_service uuid, p_date date)
returns table (local_start timestamp, professional_id uuid) language plpgsql stable security definer set search_path = '' as $$
declare
  v_service public.services; v_hours jsonb; v_open time; v_close time; v_t timestamp; v_starts timestamptz;
  v_ends timestamptz; v_has_pros boolean; v_pro uuid;
begin
  select * into v_service from public.services
   where id = p_service and organization_id = o.id and active and bookable_online;
  if v_service.id is null then return; end if;
  if p_date < public.org_today(o.id) or p_date > public.org_today(o.id) + o.booking_days_ahead then return; end if;
  v_hours := o.business_hours -> extract(dow from p_date)::int::text;
  if v_hours is null or jsonb_typeof(v_hours) <> 'array' then return; end if;
  v_open := (v_hours ->> 0)::time;
  v_close := (v_hours ->> 1)::time;
  select exists (select 1 from public.professionals where organization_id = o.id and active) into v_has_pros;

  for v_t in
    select gs from generate_series(p_date + v_open, p_date + v_close - make_interval(mins => v_service.duration_minutes),
                                   make_interval(mins => o.slot_minutes)) gs
  loop
    v_starts := v_t at time zone o.timezone;
    v_ends := v_starts + make_interval(mins => v_service.duration_minutes);
    continue when v_starts < now() + make_interval(hours => o.booking_min_notice_hours);
    if v_has_pros then
      v_pro := public._free_professional(o.id, v_starts, v_ends, v_t, v_service.duration_minutes);
      continue when v_pro is null;
    else
      v_pro := null;
      continue when exists (
        select 1 from public.appointments a where a.organization_id = o.id and a.status not in ('canceled', 'no_show')
           and a.starts_at < v_ends and a.ends_at > v_starts);
    end if;
    local_start := v_t;
    professional_id := v_pro;
    return next;
  end loop;
end $$;

create or replace function public.public_slots(p_slug text, p_service uuid, p_date date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o public.organizations;
begin
  select * into o from public.organizations where public_slug = lower(trim(p_slug)) and booking_enabled;
  if o.id is null or not public.org_can_write(o.id) then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(to_char(s.local_start, 'HH24:MI') order by s.local_start), '[]'::jsonb)
            from public._public_slots(o, p_service, p_date) s);
end $$;

-- ---------------------------------------------------------------------
-- Solicitação de agendamento feita pelo tutor (fica "solicitado" até o
-- pet shop confirmar no painel)
-- ---------------------------------------------------------------------
create or replace function public.public_request_booking(
  p_slug text, p_service uuid, p_date date, p_time text, p_name text, p_phone text,
  p_pet_name text default null, p_notes text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o public.organizations; v_service public.services; v_phone text; v_local timestamp; v_slot record;
  v_customer uuid; v_id uuid; v_starts timestamptz;
begin
  select * into o from public.organizations where public_slug = lower(trim(p_slug)) and booking_enabled;
  if o.id is null or not public.org_can_write(o.id) then raise exception 'BOOKING_UNAVAILABLE' using errcode = 'P0001'; end if;
  select * into v_service from public.services where id = p_service and organization_id = o.id and active and bookable_online;
  if v_service.id is null then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_name is null or char_length(trim(p_name)) not between 2 and 120 then raise exception 'INVALID_NAME' using errcode = '22023'; end if;
  v_phone := public.normalize_phone(p_phone);
  if v_phone is null then raise exception 'INVALID_PHONE' using errcode = '22023'; end if;
  if p_time is null or p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_date is null then
    raise exception 'INVALID_DATE' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('booking:' || o.id::text));
  -- Limites anti-abuso
  if (select count(*) from public.appointments where organization_id = o.id and source = 'online'
        and status = 'requested' and requester_phone = v_phone and starts_at > now()) >= 3 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
  if (select count(*) from public.appointments where organization_id = o.id and source = 'online'
        and created_at > now() - interval '1 hour') >= 40 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;

  v_local := p_date + p_time::time;
  select * into v_slot from public._public_slots(o, p_service, p_date) s where s.local_start = v_local;
  if not found then raise exception 'SLOT_UNAVAILABLE' using errcode = 'P0001'; end if;
  v_starts := v_local at time zone o.timezone;

  select id into v_customer from public.customers where organization_id = o.id and phone_normalized = v_phone;

  insert into public.appointments (organization_id, customer_id, service_id, professional_id, starts_at, ends_at, status,
                                   price, source, requester_name, requester_phone, pet_name, notes)
  values (o.id, v_customer, v_service.id, v_slot.professional_id, v_starts,
          v_starts + make_interval(mins => v_service.duration_minutes), 'requested', v_service.price, 'online',
          left(trim(p_name), 120), v_phone, nullif(left(trim(p_pet_name), 80), ''), nullif(left(trim(p_notes), 1000), ''))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'service', v_service.name, 'date', p_date, 'time', p_time,
                            'store', o.name, 'whatsapp', coalesce(o.public_whatsapp, o.phone));
end $$;

-- ---------------------------------------------------------------------
-- Permissões: funções públicas somente para o service role
-- ---------------------------------------------------------------------
revoke execute on function public.organizations_validate_public() from public, anon, authenticated;
revoke execute on function public._free_professional(uuid, timestamptz, timestamptz, timestamp, int) from public, anon, authenticated;
revoke execute on function public._public_slots(public.organizations, uuid, date) from public, anon, authenticated;
revoke execute on function public.public_store(text) from public, anon, authenticated;
revoke execute on function public.public_slots(text, uuid, date) from public, anon, authenticated;
revoke execute on function public.public_request_booking(text, uuid, date, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.public_store(text) to service_role;
grant execute on function public.public_slots(text, uuid, date) to service_role;
grant execute on function public.public_request_booking(text, uuid, date, text, text, text, text, text) to service_role;
