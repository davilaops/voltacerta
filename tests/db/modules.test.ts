/**
 * Testes dos módulos de gestão (migrations 0012–0017): estoque, agenda,
 * pacotes, caixa/PDV, financeiro, catálogo/agendamento online, lembretes,
 * análise de consumo e integrações. Rodam as migrations reais em PGlite,
 * como usuário autenticado (RLS de verdade).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { createDb, setupOrg, type Db } from './harness'

type Row = Record<string, unknown>
let db: Db
let A: Awaited<ReturnType<typeof setupOrg>>
let B: Awaited<ReturnType<typeof setupOrg>>
let staff: { userId: string; user: ReturnType<Db['as']> }

const n = (v: unknown) => Number(v)

async function today(orgId: string): Promise<string> {
  return (await db.admin.query<{ d: string }>('select public.org_today($1)::text as d', [orgId]))[0].d
}
function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
/** Próximo dia útil (seg–sex) a partir de hoje + offset. */
function nextWeekday(iso: string, offset: number): string {
  let d = addDays(iso, offset)
  while ([0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay())) d = addDays(d, 1)
  return d
}
async function customer(u: typeof A, name: string, phone: string | null, consent = false) {
  return (await u.user.one<{ id: string }>(
    'insert into public.customers (organization_id, full_name, phone, marketing_consent) values ($1, $2, $3, $4) returning id',
    [u.orgId, name, phone, consent])).id
}
async function product(u: typeof A, name: string, price: number, days = 30, cost: number | null = null) {
  return (await u.user.one<{ id: string }>(
    `insert into public.products (organization_id, name, category, price, avg_duration_days, cost)
     values ($1, $2, 'racoes', $3, $4, $5) returning id`, [u.orgId, name, price, days, cost])).id
}
async function service(u: typeof A, name: string, price: number, minutes = 60, returnDays: number | null = null) {
  return (await u.user.one<{ id: string }>(
    `insert into public.services (organization_id, name, category, price, duration_minutes, return_days)
     values ($1, $2, 'banho', $3, $4, $5) returning id`, [u.orgId, name, price, minutes, returnDays])).id
}
async function buy(u: typeof A, customerId: string, date: string, items: Row[]) {
  return (await u.user.one<{ id: string }>(
    'select public.create_purchase($1, $2, $3::date, $4::jsonb) as id', [u.orgId, customerId, date, JSON.stringify(items)])).id
}
async function stockOf(productId: string) {
  return n((await db.admin.query<{ s: string }>('select stock_qty as s from public.products where id = $1', [productId]))[0].s)
}

beforeAll(async () => {
  db = await createDb()
  A = await setupOrg(db, 'mod-a@teste.com', 'Pet Shop Módulos A')
  B = await setupOrg(db, 'mod-b@teste.com', 'Pet Shop Módulos B')
  const staffId = await db.createUser('func-a@teste.com')
  await db.admin.query(`insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'employee')`, [A.orgId, staffId])
  staff = { userId: staffId, user: db.as(staffId) }
})

// ---------------------------------------------------------------------
describe('estoque', () => {
  it('entrada liga o controle, venda baixa, exclusão devolve', async () => {
    const p = await product(A, 'Ração Estoque 15kg', 200, 30, 120)
    const c = await customer(A, 'Cliente Estoque', '(11) 90000-0001')
    await A.user.query(`select public.stock_adjust($1, $2, 'entrada', 10, 125, 'NF 123', true)`, [A.orgId, p])
    expect(await stockOf(p)).toBe(10)
    const prod = await A.user.one<Row>('select track_stock, cost from public.products where id = $1', [p])
    expect(prod.track_stock).toBe(true)
    expect(n(prod.cost)).toBe(125)

    const sale = await buy(A, c, await today(A.orgId), [{ product_id: p, quantity: 3 }])
    expect(await stockOf(p)).toBe(7)
    await A.user.query('select public.delete_purchase($1)', [sale])
    expect(await stockOf(p)).toBe(10)
    const kinds = await A.user.query<{ kind: string }>('select kind from public.stock_movements where product_id = $1 order by created_at', [p])
    expect(kinds.map((k) => k.kind)).toEqual(['entrada', 'venda', 'estorno_venda'])
  })

  it('saldo não pode ser alterado por UPDATE direto e inventário ajusta para o contado', async () => {
    const p = await product(A, 'Areia Estoque', 30)
    await A.user.query(`select public.stock_adjust($1, $2, 'entrada', 5)`, [A.orgId, p])
    await A.user.query('update public.products set stock_qty = 999, name = $2 where id = $1', [p, 'Areia Estoque 4kg'])
    expect(await stockOf(p)).toBe(5)
    await A.user.query(`select public.stock_adjust($1, $2, 'inventario', 2, null, 'Contagem')`, [A.orgId, p])
    expect(await stockOf(p)).toBe(2)
    await A.user.query(`select public.stock_adjust($1, $2, 'perda', 1)`, [A.orgId, p])
    expect(await stockOf(p)).toBe(1)
    await expect(A.user.query(`select public.stock_adjust($1, $2, 'entrada', -3)`, [A.orgId, p])).rejects.toThrow(/INVALID_QUANTITY/)
    await expect(B.user.query(`select public.stock_adjust($1, $2, 'entrada', 3)`, [A.orgId, p])).rejects.toThrow(/FORBIDDEN/)
  })

  it('produto sem controle de estoque não gera movimentação na venda', async () => {
    const p = await product(A, 'Petisco Sem Estoque', 10)
    const c = await customer(A, 'Cliente Sem Estoque', null)
    await buy(A, c, await today(A.orgId), [{ product_id: p, quantity: 2 }])
    expect(await A.user.query('select * from public.stock_movements where product_id = $1', [p])).toHaveLength(0)
  })

  it('sugestão de compra considera recompras previstas e estoque mínimo', async () => {
    const t = await today(A.orgId)
    const p = await product(A, 'Ração Sugestão', 100, 30, 60)
    await A.user.query('update public.products set min_stock = 2, lead_time_days = 5 where id = $1', [p])
    await A.user.query(`select public.stock_adjust($1, $2, 'entrada', 4)`, [A.orgId, p])
    // 3 clientes compraram há 25 dias => recompras previstas para daqui a ~5 dias
    for (let i = 0; i < 3; i++) {
      const c = await customer(A, `Cliente Sugestão ${i}`, `(11) 90000-01${i}0`)
      await buy(A, c, addDays(t, -25), [{ product_id: p, quantity: 1 }])
    }
    const ov = (await A.user.one<{ stock_overview: Row }>('select public.stock_overview($1, 30)', [A.orgId])).stock_overview
    const row = (ov.products as Row[]).find((r) => r.id === p)!
    expect(n(row.stock_qty)).toBe(1) // 4 − 3 vendidos
    expect(n(row.predicted_qty)).toBe(3)
    expect(n(row.predicted_customers)).toBe(3)
    expect(n(row.suggested_qty)).toBeGreaterThanOrEqual(4) // demanda 3 + mínimo 2 − saldo 1
    expect(row.low_stock).toBe(true)
    expect(n((ov.totals as Row).low_stock)).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------
describe('caixa (PDV) e financeiro', () => {
  it('registro de compra gera receita paga "não informado"', async () => {
    const p = await product(A, 'Ração Financeiro', 50)
    const c = await customer(A, 'Cliente Financeiro', null)
    const sale = await buy(A, c, await today(A.orgId), [{ product_id: p, quantity: 2 }])
    const fe = await A.user.one<Row>('select * from public.finance_entries where purchase_id = $1', [sale])
    expect(fe.status).toBe('paid')
    expect(fe.payment_method).toBe('nao_informado')
    expect(n(fe.amount)).toBe(100)
  })

  it('PDV exige caixa aberto, aceita venda sem cliente e pagamento dividido', async () => {
    const p = await product(A, 'Brinquedo PDV', 40)
    const s = await service(A, 'Banho avulso PDV', 60)
    const items = JSON.stringify([{ product_id: p, quantity: 1 }])
    const services = JSON.stringify([{ service_id: s }])
    const pays = JSON.stringify([{ method: 'dinheiro', amount: 50 }, { method: 'pix', amount: 50 }])
    await expect(staff.user.query('select public.pdv_checkout($1, null, $2::jsonb, $3::jsonb, 0, $4::jsonb)', [A.orgId, items, services, pays]))
      .rejects.toThrow(/CASH_SESSION_REQUIRED/)

    await staff.user.query('select public.open_cash_session($1, 100)', [A.orgId])
    await expect(staff.user.query('select public.open_cash_session($1, 0)', [A.orgId])).rejects.toThrow(/CASH_SESSION_ALREADY_OPEN/)
    const sale = (await staff.user.one<{ id: string }>(
      'select public.pdv_checkout($1, null, $2::jsonb, $3::jsonb, 0, $4::jsonb) as id', [A.orgId, items, services, pays])).id
    const pu = await staff.user.one<Row>('select * from public.purchases where id = $1', [sale])
    expect(pu.customer_id).toBeNull()
    expect(pu.channel).toBe('pdv')
    expect(n(pu.total)).toBe(100)

    // Pagamento que não fecha o total é recusado (nada é gravado)
    await expect(staff.user.query('select public.pdv_checkout($1, null, $2::jsonb, null, 0, $3::jsonb)',
      [A.orgId, items, JSON.stringify([{ method: 'pix', amount: 10 }])])).rejects.toThrow(/PAYMENT_MISMATCH/)
    // Fiado exige cliente identificado
    await expect(staff.user.query('select public.pdv_checkout($1, null, $2::jsonb, null, 0, $3::jsonb)',
      [A.orgId, items, JSON.stringify([{ method: 'fiado', amount: 40 }])])).rejects.toThrow(/FIADO_REQUIRES_CUSTOMER/)

    await staff.user.query(`select public.cash_movement($1, 'sangria', 30, 'Depósito')`, [A.orgId])
    const sum = (await staff.user.one<{ cash_session_summary: Row }>('select public.cash_session_summary($1)', [A.orgId])).cash_session_summary
    expect(n(sum.expected_cash)).toBe(120) // 100 abertura + 50 dinheiro − 30 sangria
    expect(n((sum.by_method as Row).pix)).toBe(50)
    const closed = (await staff.user.one<{ close_cash_session: Row }>('select public.close_cash_session($1, 118)', [A.orgId])).close_cash_session
    expect(n(closed.difference)).toBe(-2)
  })

  it('funcionário não lê o financeiro; proprietário lança despesa e baixa fiado', async () => {
    expect(await staff.user.query('select * from public.finance_entries where organization_id = $1', [A.orgId])).toHaveLength(0)
    await expect(staff.user.query('select public.finance_report($1, current_date - 30, current_date)', [A.orgId])).rejects.toThrow(/FORBIDDEN/)

    const t = await today(A.orgId)
    const c = await customer(A, 'Cliente Fiado', '(11) 90000-0099')
    const p = await product(A, 'Ração Fiado', 80)
    await A.user.query('select public.open_cash_session($1, 0)', [A.orgId])
    const sale = (await A.user.one<{ id: string }>(
      'select public.pdv_checkout($1, $2, $3::jsonb, null, 0, $4::jsonb, null, null, $5::date) as id',
      [A.orgId, c, JSON.stringify([{ product_id: p, quantity: 1 }]), JSON.stringify([{ method: 'fiado', amount: 80 }]), addDays(t, 10)])).id
    const fe = await A.user.one<Row>('select * from public.finance_entries where purchase_id = $1', [sale])
    expect(fe.status).toBe('pending')
    expect(fe.due_date).toBeTruthy()
    await A.user.query(`select public.settle_finance_entry($1, 'pix')`, [fe.id])
    expect((await A.user.one<Row>('select status from public.finance_entries where id = $1', [fe.id])).status).toBe('paid')
    await expect(A.user.query('select public.cancel_finance_entry($1)', [fe.id])).rejects.toThrow(/ENTRY_LOCKED/)

    const exp = (await A.user.one<{ id: string }>(
      `select public.save_finance_entry($1, null, 'expense', 'aluguel', 'Aluguel do mês', 1500, $2::date, false) as id`, [A.orgId, addDays(t, 5)])).id
    await expect(A.user.query(
      `select public.save_finance_entry($1, null, 'expense', 'venda_produtos', 'Errado', 10, $2::date, false)`, [A.orgId, t])).rejects.toThrow(/INVALID_ENTRY/)
    const rep = (await A.user.one<{ finance_report: Row }>('select public.finance_report($1, $2::date, $2::date)', [A.orgId, t])).finance_report
    expect(n(rep.payable_open)).toBeGreaterThanOrEqual(1500)
    expect(n(rep.payable_next7)).toBeGreaterThanOrEqual(1500)
    expect(n(rep.revenue)).toBeGreaterThan(0)
    await A.user.query(`select public.settle_finance_entry($1, 'transferencia')`, [exp])
    const rep2 = (await A.user.one<{ finance_report: Row }>('select public.finance_report($1, $2::date, $2::date)', [A.orgId, t])).finance_report
    expect(n(rep2.paid_expenses)).toBeGreaterThanOrEqual(1500)
    await A.user.query('select public.close_cash_session($1, 0)', [A.orgId])
  })

  it('outra organização não acessa caixa nem lançamentos', async () => {
    expect(await B.user.query('select * from public.cash_sessions where organization_id = $1', [A.orgId])).toHaveLength(0)
    await expect(B.user.query('select public.cash_session_summary($1)', [A.orgId])).rejects.toThrow(/FORBIDDEN/)
  })
})

// ---------------------------------------------------------------------
describe('serviços, agenda e pacotes', () => {
  let svc: string
  let pro: string
  let cust: string
  let pet: string

  beforeAll(async () => {
    svc = await service(A, 'Banho e tosa', 90, 60, 15)
    pro = (await A.user.one<{ id: string }>(
      `insert into public.professionals (organization_id, name, role, work_days) values ($1, 'Ana Tosadora', 'tosador', '{0,1,2,3,4,5,6}') returning id`,
      [A.orgId])).id
    cust = await customer(A, 'Tutor Agenda', '(11) 90000-0200', true)
    pet = (await A.user.one<{ id: string }>(`insert into public.pets (organization_id, customer_id, name) values ($1, $2, 'Thor') returning id`, [A.orgId, cust])).id
  })

  it('agenda e impede dois atendimentos simultâneos do mesmo profissional', async () => {
    const t = await today(A.orgId)
    const start = `${addDays(t, 1)}T13:00:00-03:00`
    await A.user.query('select public.save_appointment($1, null, $2, $3, $4, $5, $6::timestamptz)', [A.orgId, cust, pet, svc, pro, start])
    await expect(A.user.query('select public.save_appointment($1, null, $2, $3, $4, $5, $6::timestamptz)',
      [A.orgId, cust, pet, svc, pro, `${addDays(t, 1)}T13:30:00-03:00`])).rejects.toThrow(/SCHEDULE_CONFLICT/)
    // Sem profissional definido não há conflito
    await A.user.query('select public.save_appointment($1, null, $2, $3, $4, null, $5::timestamptz)',
      [A.orgId, cust, pet, svc, `${addDays(t, 1)}T13:30:00-03:00`])
    // Pet de outro cliente é recusado
    const other = await customer(A, 'Outro Tutor', null)
    await expect(A.user.query('select public.save_appointment($1, null, $2, $3, $4, null, $5::timestamptz)',
      [A.orgId, other, pet, svc, `${addDays(t, 2)}T10:00:00-03:00`])).rejects.toThrow(/PET_NOT_FOUND/)
    // Serviço de outra organização é recusado
    await expect(B.user.query('select public.save_appointment($1, null, null, null, $2, null, now())', [B.orgId, svc])).rejects.toThrow(/SERVICE_NOT_FOUND/)
  })

  it('concluir atendimento gera a venda do serviço; excluir a venda reabre o atendimento', async () => {
    const t = await today(A.orgId)
    const appt = (await A.user.one<{ id: string }>('select public.save_appointment($1, null, $2, $3, $4, $5, $6::timestamptz) as id',
      [A.orgId, cust, pet, svc, pro, `${t}T00:05:00-03:00`])).id
    const sale = (await A.user.one<{ id: string }>(`select public.complete_appointment($1, $2::jsonb) as id`,
      [appt, JSON.stringify([{ method: 'cartao_debito', amount: 90 }])])).id
    expect(sale).toBeTruthy()
    const pu = await A.user.one<Row>('select channel, total, customer_id from public.purchases where id = $1', [sale])
    expect(pu.channel).toBe('agenda')
    expect(n(pu.total)).toBe(90)
    expect((await A.user.one<Row>('select status from public.appointments where id = $1', [appt])).status).toBe('done')
    await expect(A.user.query('select public.complete_appointment($1)', [appt])).rejects.toThrow(/INVALID_STATUS_TRANSITION/)

    await A.user.query('select public.delete_purchase($1)', [sale])
    expect((await A.user.one<Row>('select status from public.appointments where id = $1', [appt])).status).toBe('confirmed')
    expect(await A.user.query('select * from public.finance_entries where purchase_id = $1', [sale])).toHaveLength(0)
  })

  it('pacote: venda, consumo de sessões e encerramento automático', async () => {
    const t = await today(A.orgId)
    const pkg = (await A.user.one<{ id: string }>(
      `insert into public.service_packages (organization_id, name, service_id, sessions, price, validity_days)
       values ($1, '2 banhos', $2, 2, 150, 30) returning id`, [A.orgId, svc])).id
    const cp = (await A.user.one<{ id: string }>(`select public.sell_package($1, $2, $3, $4, $5::jsonb) as id`,
      [A.orgId, cust, pet, pkg, JSON.stringify([{ method: 'pix', amount: 150 }])])).id
    const fe = await A.user.query<Row>(
      `select fe.* from public.finance_entries fe join public.purchase_services ps on ps.purchase_id = fe.purchase_id where ps.customer_package_id = $1`, [cp])
    expect(fe).toHaveLength(1)
    expect(fe[0].category).toBe('pacotes')

    for (let i = 0; i < 2; i++) {
      const appt = (await A.user.one<{ id: string }>('select public.save_appointment($1, null, $2, $3, $4, null, $5::timestamptz, null, null, $6) as id',
        [A.orgId, cust, pet, svc, `${t}T00:1${i}:00-03:00`, cp])).id
      expect(n((await A.user.one<Row>('select price from public.appointments where id = $1', [appt])).price)).toBe(0)
      expect(await A.user.one<{ id: string | null }>('select public.complete_appointment($1) as id', [appt])).toEqual({ id: null })
    }
    const after = await A.user.one<Row>('select sessions_used, status from public.customer_packages where id = $1', [cp])
    expect(after.sessions_used).toBe(2)
    expect(after.status).toBe('finished')
    await expect(A.user.query('select public.save_appointment($1, null, $2, $3, $4, null, now(), null, null, $5)',
      [A.orgId, cust, pet, svc, cp])).rejects.toThrow(/PACKAGE_UNAVAILABLE/)
  })

  it('cliente pode ser lido na agenda pela view e status muda com regras', async () => {
    const t = await today(A.orgId)
    const appt = (await A.user.one<{ id: string }>('select public.save_appointment($1, null, $2, $3, $4, $5, $6::timestamptz) as id',
      [A.orgId, cust, pet, svc, pro, `${addDays(t, 3)}T09:00:00-03:00`])).id
    const v = await A.user.one<Row>('select * from public.v_appointments where id = $1', [appt])
    expect(v.customer_name).toBe('Tutor Agenda')
    expect(v.pet_display_name).toBe('Thor')
    expect(v.professional_name).toBe('Ana Tosadora')
    await A.user.query(`select public.set_appointment_status($1, 'canceled', 'Cliente desmarcou')`, [appt])
    await A.user.query(`select public.set_appointment_status($1, 'scheduled')`, [appt])
    expect(await B.user.query('select * from public.v_appointments where id = $1', [appt])).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------
describe('catálogo e agendamento online', () => {
  it('funções públicas não são executáveis por anon nem por usuários', async () => {
    await expect(db.as(null).query(`select public.public_store('qualquer')`)).rejects.toThrow(/permission denied/)
    await expect(A.user.query(`select public.public_store('qualquer')`)).rejects.toThrow(/permission denied/)
    await expect(A.user.query(`select public.public_request_booking('x', gen_random_uuid(), current_date, '10:00', 'Nome', '11999999999')`))
      .rejects.toThrow(/permission denied/)
  })

  it('valida endereço público e horário de funcionamento', async () => {
    await expect(A.user.query(`update public.organizations set public_slug = 'Inválido Com Espaço' where id = $1`, [A.orgId])).rejects.toThrow()
    await expect(A.user.query(`update public.organizations set public_slug = 'admin' where id = $1`, [A.orgId])).rejects.toThrow(/SLUG_RESERVED/)
    await expect(A.user.query(`update public.organizations set business_hours = '{"1": ["18:00","08:00"]}' where id = $1`, [A.orgId])).rejects.toThrow(/INVALID_HOURS/)
    await expect(A.user.query(`update public.organizations set catalog_enabled = true where id = $1`, [A.orgId])).rejects.toThrow(/public_slug_required/)
  })

  it('loja publicada mostra catálogo, horários livres e recebe solicitação', async () => {
    const t = await today(B.orgId)
    const svc = await service(B, 'Banho Online', 70, 60)
    const prodVisible = await product(B, 'Ração Catálogo', 99)
    await product(B, 'Produto Oculto', 10)
    await B.user.query('update public.products set catalog_visible = true where id = $1', [prodVisible])
    await B.user.query(`update public.organizations set public_slug = 'pet-b', catalog_enabled = true, booking_enabled = true,
      booking_min_notice_hours = 0 where id = $1`, [B.orgId])

    const store = (await db.admin.query<{ s: Row }>(`select public.public_store('PET-B') as s`))[0].s
    expect(store.name).toBe('Pet Shop Módulos B')
    expect((store.products as Row[]).map((p) => p.name)).toEqual(['Ração Catálogo'])
    expect((store.services as Row[])[0].bookable).toBe(true)

    const date = nextWeekday(t, 2)
    const slots = (await db.admin.query<{ s: string[] }>(`select public.public_slots('pet-b', $1, $2::date) as s`, [svc, date]))[0].s
    expect(slots[0]).toBe('08:00')
    expect(slots).toContain('17:00')
    expect(slots).not.toContain('17:30') // 60 min não cabe antes das 18h

    const res = (await db.admin.query<{ r: Row }>(
      `select public.public_request_booking('pet-b', $1, $2::date, '10:00', 'Joana Tutora', '(11) 97777-6666', 'Mel') as r`, [svc, date]))[0].r
    expect(res.service).toBe('Banho Online')
    const appt = await B.user.one<Row>(`select * from public.appointments where source = 'online' and organization_id = $1`, [B.orgId])
    expect(appt.status).toBe('requested')
    expect(appt.requester_phone).toBe('5511977776666')
    // Sem profissionais cadastrados, o horário fica ocupado
    const slots2 = (await db.admin.query<{ s: string[] }>(`select public.public_slots('pet-b', $1, $2::date) as s`, [svc, date]))[0].s
    expect(slots2).not.toContain('10:00')
    await expect(db.admin.query(`select public.public_request_booking('pet-b', $1, $2::date, '10:00', 'Outro', '(11) 96666-5555')`, [svc, date]))
      .rejects.toThrow(/SLOT_UNAVAILABLE/)
    await expect(db.admin.query(`select public.public_request_booking('pet-b', $1, $2::date, '11:00', 'Outro', '123')`, [svc, date]))
      .rejects.toThrow(/INVALID_PHONE/)

    // Pet shop confirma: precisa vincular cliente
    await expect(B.user.query(`select public.set_appointment_status($1, 'confirmed')`, [appt.id])).rejects.toThrow(/CUSTOMER_NOT_FOUND/)
    const c = await customer(B, 'Joana Tutora', '(11) 97777-6666')
    await B.user.query('select public.save_appointment($1, $2, $3, null, $4, null, $5::timestamptz)', [B.orgId, appt.id, c, svc, appt.starts_at])
    expect((await B.user.one<Row>('select status, customer_id from public.appointments where id = $1', [appt.id])).status).toBe('scheduled')

    // Domingo (fechado) não tem horários
    let sunday = addDays(t, 2)
    while (new Date(sunday + 'T12:00:00Z').getUTCDay() !== 0) sunday = addDays(sunday, 1)
    expect((await db.admin.query<{ s: string[] }>(`select public.public_slots('pet-b', $1, $2::date) as s`, [svc, sunday]))[0].s).toEqual([])
  })

  it('limita solicitações repetidas do mesmo telefone', async () => {
    const t = await today(B.orgId)
    const svc = await service(B, 'Hidratação Online', 50, 30)
    const date = nextWeekday(t, 3)
    for (const h of ['08:00', '08:30', '09:00']) {
      await db.admin.query(`select public.public_request_booking('pet-b', $1, $2::date, $3, 'Spam', '(11) 95555-4444')`, [svc, date, h])
    }
    await expect(db.admin.query(`select public.public_request_booking('pet-b', $1, $2::date, '09:30', 'Spam', '(11) 95555-4444')`, [svc, date]))
      .rejects.toThrow(/RATE_LIMITED/)
  })
})

// ---------------------------------------------------------------------
describe('lembretes, consumo e segmentos', () => {
  it('aniversário e pós-venda aparecem e somem após o contato', async () => {
    const t = await today(A.orgId)
    const c = await customer(A, 'Tutor Aniversário', '(11) 90000-0300', true)
    const birth = `${Number(t.slice(0, 4)) - 3}${t.slice(4)}`
    await A.user.query(`insert into public.pets (organization_id, customer_id, name, birth_date) values ($1, $2, 'Bolinha', $3)`, [A.orgId, c, birth])
    const p = await product(A, 'Ração Pós-venda', 40)
    await buy(A, c, addDays(t, -3), [{ product_id: p, quantity: 1 }])

    const list = (await A.user.one<{ get_reminders: Row[] }>('select public.get_reminders($1, 7)', [A.orgId])).get_reminders
    const mine = list.filter((r) => r.customer_id === c)
    const bday = mine.find((r) => r.kind === 'aniversario')!
    expect(bday.pet_name).toBe('Bolinha')
    expect(bday.detail).toBe('3 ano(s)')
    expect(mine.some((r) => r.kind === 'pos_venda')).toBe(true)

    await A.user.query(`select public.log_reminder_contact($1, $2, $3, 'respondeu')`, [A.orgId, c, bday.key])
    const list2 = (await A.user.one<{ get_reminders: Row[] }>('select public.get_reminders($1, 7)', [A.orgId])).get_reminders
    expect(list2.some((r) => r.key === bday.key)).toBe(false)
    await expect(A.user.query(`select public.log_reminder_contact($1, $2, 'qualquer', 'respondeu')`, [A.orgId, c])).rejects.toThrow(/INVALID_INPUT/)
  })

  it('análise de consumo e segmentação', async () => {
    const t = await today(A.orgId)
    const c = await customer(A, 'Cliente Campeão', '(11) 90000-0400')
    const p = await product(A, 'Ração Campeã', 100)
    for (const d of [-90, -60, -30, -5]) await buy(A, c, addDays(t, d), [{ product_id: p, quantity: 1 }])
    const ins = (await A.user.one<{ customer_insights: Row }>('select public.customer_insights($1)', [c])).customer_insights
    expect(n(ins.total_spent)).toBe(400)
    expect(n(ins.avg_ticket)).toBe(100)
    expect(n(ins.avg_interval_days)).toBe(28.3)
    expect((ins.top_products as Row[])[0].name).toBe('Ração Campeã')
    expect(ins.monthly as Row[]).toHaveLength(12)
    await expect(B.user.query('select public.customer_insights($1)', [c])).rejects.toThrow(/FORBIDDEN/)

    const seg = (await A.user.one<{ customer_segments: Row }>('select public.customer_segments($1)', [A.orgId])).customer_segments
    expect((seg.customers as Row[]).find((x) => x.id === c)!.segment).toBe('campeao')
  })
})

// ---------------------------------------------------------------------
describe('integrações (WhatsApp e nota fiscal)', () => {
  it('tokens nunca são lidos pelo painel', async () => {
    await expect(A.user.query(`select public.save_whatsapp_settings($1, true, '123456789', null, '{}'::jsonb, '{}')`, [A.orgId]))
      .rejects.toThrow(/INTEGRATION_INCOMPLETE/)
    await A.user.query(`select public.save_whatsapp_settings($1, true, '123456789', 'EAAG-segredo', $2::jsonb, '{aniversario,lembrete_agendamento}')`,
      [A.orgId, JSON.stringify({ aniversario: { name: 'aniversario_pet', language: 'pt_BR' }, lembrete_agendamento: { name: 'lembrete', language: 'pt_BR' } })])
    expect(await A.user.query('select * from public.org_integrations')).toHaveLength(0)
    const s = (await A.user.one<{ get_integration_settings: Row }>('select public.get_integration_settings($1)', [A.orgId])).get_integration_settings
    expect(s.whatsapp_enabled).toBe(true)
    expect(s.whatsapp_has_token).toBe(true)
    expect(JSON.stringify(s)).not.toContain('segredo')
    await expect(staff.user.query('select public.get_integration_settings($1)', [A.orgId])).rejects.toThrow(/FORBIDDEN/)
    await expect(A.user.query(`select public.save_whatsapp_settings($1, true, '1', null, '{"aniversario": {"name": "Nome Inválido", "language": "pt_BR"}}'::jsonb, '{}')`, [A.orgId]))
      .rejects.toThrow(/INVALID_INPUT/)
  })

  it('envio automático respeita consentimento e não repete', async () => {
    const t = await today(A.orgId)
    const yes = await customer(A, 'Com Consentimento', '(11) 90000-0500', true)
    const no = await customer(A, 'Sem Consentimento', '(11) 90000-0501', false)
    const birth = `${Number(t.slice(0, 4)) - 2}${t.slice(4)}`
    for (const c of [yes, no]) {
      await A.user.query(`insert into public.pets (organization_id, customer_id, name, birth_date) values ($1, $2, 'Pipoca', $3)`, [A.orgId, c, birth])
    }
    const pending = (await db.admin.query<{ p: Row[] }>('select public.whatsapp_pending($1) as p', [A.orgId]))[0].p
    const bdays = pending.filter((x) => x.kind === 'aniversario')
    expect(bdays.some((x) => x.customer_id === yes)).toBe(true)
    expect(bdays.some((x) => x.customer_id === no)).toBe(false)
    const item = bdays.find((x) => x.customer_id === yes)!
    expect((item.template as Row).name).toBe('aniversario_pet')

    await db.admin.query(`select public.whatsapp_record_dispatch($1, $2, 'aniversario', $3, 'aniversario_pet', 'sent', 'wamid.1', null, null, 'Parabéns')`,
      [A.orgId, yes, item.dedupe_key])
    const pending2 = (await db.admin.query<{ p: Row[] }>('select public.whatsapp_pending($1) as p', [A.orgId]))[0].p
    expect(pending2.some((x) => x.dedupe_key === item.dedupe_key)).toBe(false)
    const log = await A.user.one<Row>(`select channel, external_message_id from public.contact_logs where reminder_key = $1`, [item.dedupe_key])
    expect(log.channel).toBe('whatsapp_api')
    await expect(A.user.query('select public.whatsapp_pending($1)', [A.orgId])).rejects.toThrow(/permission denied/)
  })

  it('nota fiscal exige configuração e NCM dos produtos', async () => {
    const p = await product(A, 'Ração Fiscal', 50)
    const c = await customer(A, 'Cliente Fiscal', null)
    const sale = await buy(A, c, await today(A.orgId), [{ product_id: p, quantity: 1 }])
    await expect(A.user.query(`select public.fiscal_prepare($1, 'nfce')`, [sale])).rejects.toThrow(/FISCAL_NOT_CONFIGURED/)
    await expect(staff.user.query(`select public.save_fiscal_settings($1, true, 'homologacao', 'tok', '12345678000195', null, null, null, true, null, null, null, null)`, [A.orgId]))
      .rejects.toThrow(/FORBIDDEN/)
    await A.user.query(`select public.save_fiscal_settings($1, true, 'homologacao', 'tok-fiscal', '12.345.678/0001-95', '123', null, '3550308', true, '102', null, null, null)`, [A.orgId])
    await expect(A.user.query(`select public.fiscal_prepare($1, 'nfce')`, [sale])).rejects.toThrow(/FISCAL_DATA_MISSING/)
    await A.user.query(`update public.products set ncm = '23091000' where id = $1`, [p])
    const prep = (await A.user.one<{ fiscal_prepare: Row }>(`select public.fiscal_prepare($1, 'nfce')`, [sale])).fiscal_prepare
    expect((prep.items as Row[])[0].ncm).toBe('23091000')
    expect(JSON.stringify(prep)).not.toContain('tok-fiscal')
    await expect(A.user.query(`select public.fiscal_prepare($1, 'nfse')`, [sale])).rejects.toThrow(/FISCAL_NO_ITEMS/)
  })
})

// ---------------------------------------------------------------------
describe('exclusão do estabelecimento', () => {
  it('remove em cascata todos os dados dos novos módulos', async () => {
    const root = await db.createUser('root-mod@voltacerta.com.br')
    await db.admin.query(`select public.promote_super_admin('root-mod@voltacerta.com.br')`)
    await db.as(root).query(`select public.admin_delete_organization($1, 'Teste de exclusão', 'Pet Shop Módulos A')`, [A.orgId])
    for (const table of ['stock_movements', 'services', 'professionals', 'appointments', 'customer_packages', 'cash_sessions',
      'finance_entries', 'purchase_services', 'org_integrations', 'message_dispatches', 'invoices']) {
      const r = await db.admin.query<{ c: string }>(`select count(*) as c from public.${table} where organization_id = $1`, [A.orgId])
      expect(n(r[0].c), table).toBe(0)
    }
  })
})
