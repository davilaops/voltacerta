-- =====================================================================
-- VoltaCerta — 0013: serviços (banho, tosa…), profissionais, pacotes e
-- agenda de atendimentos. Aditiva.
-- * Serviços, profissionais e modelos de pacote: escrita direta com RLS.
-- * Pacotes vendidos e agendamentos: escrita somente via RPC (validação
--   de conflito de horário, posse dos registros e saldo do pacote).
-- =====================================================================

-- Horário de funcionamento (0 = domingo … 6 = sábado). null = fechado.
alter table public.organizations
  add column business_hours jsonb not null default
    '{"0": null, "1": ["08:00","18:00"], "2": ["08:00","18:00"], "3": ["08:00","18:00"], "4": ["08:00","18:00"], "5": ["08:00","18:00"], "6": ["08:00","13:00"]}'::jsonb,
  add column slot_minutes int not null default 30 check (slot_minutes in (15, 20, 30, 45, 60));

-- ---------------------------------------------------------------------
-- Serviços
-- ---------------------------------------------------------------------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 120),
  category text not null default 'banho'
    check (category in ('banho', 'tosa', 'banho_tosa', 'hidratacao', 'unhas', 'consulta', 'vacina', 'transporte', 'outro')),
  price numeric(12,2) not null default 0 check (price >= 0),
  duration_minutes int not null default 60 check (duration_minutes between 10 and 600),
  return_days int check (return_days between 1 and 365), -- intervalo sugerido para o próximo atendimento
  description text check (char_length(description) <= 1000),
  active boolean not null default true,
  catalog_visible boolean not null default true,
  bookable_online boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index services_org_idx on public.services (organization_id, lower(name));
create trigger services_updated_at before update on public.services
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Profissionais (banhistas, tosadores…). Não precisam de login.
-- ---------------------------------------------------------------------
create table public.professionals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 80),
  role text not null default 'banhista_tosador'
    check (role in ('banhista', 'tosador', 'banhista_tosador', 'veterinario', 'atendente', 'motorista', 'outro')),
  phone text check (char_length(phone) <= 30),
  color text not null default '#22c58b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  work_days int[] not null default '{1,2,3,4,5,6}' check (work_days <@ array[0,1,2,3,4,5,6]),
  work_start time not null default '08:00',
  work_end time not null default '18:00' check (work_end > work_start),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index professionals_org_idx on public.professionals (organization_id);

-- Tenant imutável nas tabelas com escrita direta
create or replace function public.lock_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.organization_id := old.organization_id;
  return new;
end $$;
create trigger services_lock_tenant before update on public.services
  for each row execute function public.lock_tenant();
create trigger professionals_lock_tenant before update on public.professionals
  for each row execute function public.lock_tenant();

-- ---------------------------------------------------------------------
-- Pacotes (modelo) e pacotes vendidos ao cliente
-- ---------------------------------------------------------------------
create table public.service_packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 120),
  service_id uuid not null,
  sessions int not null check (sessions between 1 and 100),
  price numeric(12,2) not null check (price >= 0),
  validity_days int not null default 30 check (validity_days between 1 and 730),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (service_id, organization_id) references public.services (id, organization_id),
  unique (id, organization_id)
);
create trigger service_packages_lock_tenant before update on public.service_packages
  for each row execute function public.lock_tenant();

create table public.customer_packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid not null,
  pet_id uuid,
  package_id uuid references public.service_packages (id) on delete set null,
  service_id uuid not null,
  name text not null,
  sessions_total int not null check (sessions_total between 1 and 100),
  sessions_used int not null default 0 check (sessions_used >= 0 and sessions_used <= sessions_total),
  price_paid numeric(12,2) not null default 0 check (price_paid >= 0),
  purchased_at date not null,
  expires_at date not null,
  status text not null default 'active' check (status in ('active', 'finished', 'canceled')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade,
  foreign key (pet_id, organization_id) references public.pets (id, organization_id) on delete set null (pet_id),
  foreign key (service_id, organization_id) references public.services (id, organization_id),
  unique (id, organization_id)
);
create index customer_packages_customer_idx on public.customer_packages (customer_id, status);
create index customer_packages_org_idx on public.customer_packages (organization_id, status, expires_at);

-- ---------------------------------------------------------------------
-- Agenda
-- ---------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid,
  pet_id uuid,
  service_id uuid not null,
  professional_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('requested', 'scheduled', 'confirmed', 'in_progress', 'done', 'canceled', 'no_show')),
  price numeric(12,2) not null default 0 check (price >= 0),
  customer_package_id uuid,
  source text not null default 'painel' check (source in ('painel', 'online')),
  requester_name text check (char_length(requester_name) <= 120),
  requester_phone text check (char_length(requester_phone) <= 30),
  pet_name text check (char_length(pet_name) <= 80),
  notes text check (char_length(notes) <= 1000),
  cancel_reason text check (char_length(cancel_reason) <= 300),
  completed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at - starts_at <= interval '12 hours'),
  check (customer_id is not null or requester_name is not null),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade,
  foreign key (pet_id, organization_id) references public.pets (id, organization_id) on delete set null (pet_id),
  foreign key (service_id, organization_id) references public.services (id, organization_id),
  foreign key (professional_id, organization_id) references public.professionals (id, organization_id) on delete set null (professional_id),
  foreign key (customer_package_id, organization_id) references public.customer_packages (id, organization_id) on delete set null (customer_package_id),
  unique (id, organization_id)
);
create index appointments_org_start_idx on public.appointments (organization_id, starts_at);
create index appointments_prof_start_idx on public.appointments (professional_id, starts_at) where professional_id is not null;
create index appointments_customer_idx on public.appointments (customer_id, starts_at desc);
create trigger appointments_updated_at before update on public.appointments
  for each row execute function public.set_updated_at();

create trigger audit_services after insert or update or delete on public.services
  for each row execute function public.audit_row();
create trigger audit_appointments after insert or update or delete on public.appointments
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.services enable row level security;
alter table public.professionals enable row level security;
alter table public.service_packages enable row level security;
alter table public.customer_packages enable row level security;
alter table public.appointments enable row level security;

create policy services_select on public.services for select to authenticated
  using (public.is_org_member(organization_id));
create policy services_insert on public.services for insert to authenticated
  with check (public.is_org_member(organization_id) and public.org_can_write(organization_id));
create policy services_update on public.services for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id) and public.org_can_write(organization_id));
create policy services_delete on public.services for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));

create policy professionals_select on public.professionals for select to authenticated
  using (public.is_org_member(organization_id));
create policy professionals_insert on public.professionals for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]) and public.org_can_write(organization_id));
create policy professionals_update on public.professionals for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]) and public.org_can_write(organization_id));
create policy professionals_delete on public.professionals for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));

create policy service_packages_select on public.service_packages for select to authenticated
  using (public.is_org_member(organization_id));
create policy service_packages_insert on public.service_packages for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]) and public.org_can_write(organization_id));
create policy service_packages_update on public.service_packages for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]) and public.org_can_write(organization_id));
create policy service_packages_delete on public.service_packages for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));

-- Somente leitura direta; escrita pelas RPCs.
create policy customer_packages_select on public.customer_packages for select to authenticated
  using (public.is_org_member(organization_id));
create policy appointments_select on public.appointments for select to authenticated
  using (public.is_org_member(organization_id));

-- ---------------------------------------------------------------------
-- Agendamento (criar / editar). Valida posse de cliente, pet, serviço,
-- profissional e pacote, e impede dois atendimentos simultâneos do mesmo
-- profissional.
-- ---------------------------------------------------------------------
create or replace function public._appointment_conflict(
  p_org uuid, p_professional uuid, p_starts timestamptz, p_ends timestamptz, p_ignore uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.appointments a
     where a.organization_id = p_org and a.professional_id = p_professional
       and a.status not in ('canceled', 'no_show')
       and (p_ignore is null or a.id <> p_ignore)
       and a.starts_at < p_ends and a.ends_at > p_starts
  );
$$;

create or replace function public.save_appointment(
  p_org uuid, p_id uuid, p_customer uuid, p_pet uuid, p_service uuid, p_professional uuid,
  p_starts_at timestamptz, p_duration_minutes int default null, p_price numeric default null,
  p_customer_package uuid default null, p_notes text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_service public.services; v_ends timestamptz; v_id uuid; v_old public.appointments; v_pkg public.customer_packages;
  v_status text;
begin
  perform public._assert_member(p_org);
  perform public._assert_writable(p_org);

  if p_id is not null then
    select * into v_old from public.appointments where id = p_id and organization_id = p_org for update;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if v_old.status in ('done', 'canceled', 'no_show') then
      raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001';
    end if;
  end if;

  select * into v_service from public.services where id = p_service and organization_id = p_org;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_customer is null and (v_old.id is null or v_old.requester_name is null) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_customer is not null and not exists (select 1 from public.customers where id = p_customer and organization_id = p_org) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_pet is not null and not exists (
    select 1 from public.pets where id = p_pet and organization_id = p_org and customer_id = p_customer) then
    raise exception 'PET_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_professional is not null and not exists (
    select 1 from public.professionals where id = p_professional and organization_id = p_org) then
    raise exception 'PROFESSIONAL_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_customer_package is not null then
    select * into v_pkg from public.customer_packages
     where id = p_customer_package and organization_id = p_org and customer_id = p_customer;
    if not found then raise exception 'PACKAGE_NOT_FOUND' using errcode = 'P0002'; end if;
    if v_pkg.status <> 'active' or v_pkg.service_id <> p_service then
      raise exception 'PACKAGE_UNAVAILABLE' using errcode = 'P0001';
    end if;
  end if;
  if p_starts_at is null or p_starts_at < now() - interval '400 days' or p_starts_at > now() + interval '400 days' then
    raise exception 'INVALID_DATE' using errcode = '22023';
  end if;
  if p_duration_minutes is not null and p_duration_minutes not between 10 and 720 then
    raise exception 'INVALID_DURATION' using errcode = '22023';
  end if;
  if p_price is not null and (p_price < 0 or p_price > 1000000) then
    raise exception 'INVALID_PRICE' using errcode = '22023';
  end if;

  v_ends := p_starts_at + make_interval(mins => coalesce(p_duration_minutes, v_service.duration_minutes));

  if p_professional is not null then
    perform pg_advisory_xact_lock(hashtext('appt:' || p_professional::text));
    if public._appointment_conflict(p_org, p_professional, p_starts_at, v_ends, p_id) then
      raise exception 'SCHEDULE_CONFLICT' using errcode = 'P0001';
    end if;
  end if;

  if p_id is null then
    insert into public.appointments (organization_id, customer_id, pet_id, service_id, professional_id, starts_at, ends_at,
                                     status, price, customer_package_id, notes, created_by)
    values (p_org, p_customer, p_pet, p_service, p_professional, p_starts_at, v_ends, 'scheduled',
            case when p_customer_package is not null then 0 else coalesce(p_price, v_service.price) end,
            p_customer_package, nullif(trim(p_notes), ''), auth.uid())
    returning id into v_id;
  else
    -- Solicitação online confirmada pelo painel vira "agendado"
    v_status := case when v_old.status = 'requested' then 'scheduled' else v_old.status end;
    update public.appointments set
      customer_id = coalesce(p_customer, customer_id), pet_id = p_pet, service_id = p_service,
      professional_id = p_professional, starts_at = p_starts_at, ends_at = v_ends, status = v_status,
      price = case when p_customer_package is not null then 0 else coalesce(p_price, v_service.price) end,
      customer_package_id = p_customer_package, notes = nullif(trim(p_notes), '')
    where id = p_id;
    v_id := p_id;
  end if;
  return v_id;
end $$;

-- Mudança de status (exceto "concluído", que passa por complete_appointment)
create or replace function public.set_appointment_status(p_id uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.appointments;
begin
  select * into v from public.appointments where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform public._assert_member(v.organization_id);
  perform public._assert_writable(v.organization_id);
  if v.status in ('done', 'canceled', 'no_show') and p_status <> 'scheduled' then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001';
  end if;
  if v.status = 'done' then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001';
  end if;
  if p_status not in ('scheduled', 'confirmed', 'in_progress', 'canceled', 'no_show') then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001';
  end if;
  if v.status = 'requested' and p_status in ('confirmed', 'in_progress', 'no_show') and v.customer_id is null then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Reabrir um cancelado: o horário precisa continuar livre
  if v.status in ('canceled', 'no_show') and p_status = 'scheduled' and v.professional_id is not null
     and public._appointment_conflict(v.organization_id, v.professional_id, v.starts_at, v.ends_at, v.id) then
    raise exception 'SCHEDULE_CONFLICT' using errcode = 'P0001';
  end if;
  update public.appointments set
    status = p_status,
    cancel_reason = case when p_status in ('canceled', 'no_show') then nullif(trim(p_reason), '') else null end
  where id = p_id;
end $$;

-- Agenda com nomes (respeita RLS do usuário)
create or replace view public.v_appointments with (security_invoker = true) as
select a.*,
       coalesce(c.full_name, a.requester_name) as customer_name,
       coalesce(c.phone, a.requester_phone) as customer_phone,
       c.do_not_contact as customer_do_not_contact,
       coalesce(pe.name, a.pet_name) as pet_display_name,
       s.name as service_name, s.category as service_category,
       pr.name as professional_name, pr.color as professional_color,
       cp.name as package_name, cp.sessions_total as package_sessions_total, cp.sessions_used as package_sessions_used
  from public.appointments a
  join public.services s on s.id = a.service_id
  left join public.customers c on c.id = a.customer_id
  left join public.pets pe on pe.id = a.pet_id
  left join public.professionals pr on pr.id = a.professional_id
  left join public.customer_packages cp on cp.id = a.customer_package_id;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
revoke execute on function public.lock_tenant() from public, anon, authenticated;
revoke execute on function public._appointment_conflict(uuid, uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function public.save_appointment(uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, int, numeric, uuid, text) from public, anon;
revoke execute on function public.set_appointment_status(uuid, text, text) from public, anon;
grant execute on function public.save_appointment(uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, int, numeric, uuid, text) to authenticated;
grant execute on function public.set_appointment_status(uuid, text, text) to authenticated;

-- Horário de funcionamento editável pelo proprietário/administrador (RLS de organizations)
grant update (business_hours, slot_minutes) on public.organizations to authenticated;
