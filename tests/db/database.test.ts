/**
 * Testes de integração do banco: executam as migrations REAIS em um
 * Postgres embutido (PGlite) com um stub mínimo do Supabase (auth.uid,
 * roles anon/authenticated). As consultas rodam como role `authenticated`,
 * portanto sujeitas às políticas RLS de verdade.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { createDb, setupOrg, type Db } from './harness'

let db: Db
let A: Awaited<ReturnType<typeof setupOrg>>
let B: Awaited<ReturnType<typeof setupOrg>>

type Row = Record<string, unknown>

async function today(orgId: string): Promise<string> {
  const r = await db.admin.query<{ d: string }>('select public.org_today($1)::text as d', [orgId])
  return r[0].d
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

async function createCustomer(u: typeof A, name: string, phone: string | null) {
  return u.user.one<{ id: string }>(
    'insert into public.customers (organization_id, full_name, phone) values ($1, $2, $3) returning id',
    [u.orgId, name, phone],
  )
}
async function createProduct(u: typeof A, name: string, price: number, days: number | null) {
  return u.user.one<{ id: string }>(
    `insert into public.products (organization_id, name, category, price, avg_duration_days)
     values ($1, $2, 'racoes', $3, $4) returning id`,
    [u.orgId, name, price, days],
  )
}
async function buy(u: typeof A, customerId: string, date: string, items: Row[], requestId: string | null = null) {
  const r = await u.user.one<{ id: string }>(
    'select public.create_purchase($1, $2, $3::date, $4::jsonb, 0, null, $5) as id',
    [u.orgId, customerId, date, JSON.stringify(items), requestId],
  )
  return r.id
}
async function activePrediction(u: typeof A, customerId: string, productId: string) {
  return u.user.one<Row>(
    `select * from public.v_predictions where customer_id = $1 and product_id = $2 and status in ('open','contacted')`,
    [customerId, productId],
  )
}

beforeAll(async () => {
  db = await createDb()
  A = await setupOrg(db, 'dono-a@teste.com', 'Pet Shop A')
  B = await setupOrg(db, 'dono-b@teste.com', 'Pet Shop B')
})

describe('cadastro e onboarding', () => {
  it('cria perfil ao criar usuário e organização com trial + modelos padrão', async () => {
    const profile = await A.user.one<Row>('select * from public.profiles where id = $1', [A.userId])
    expect(profile.email).toBe('dono-a@teste.com')
    const ctx = await A.user.one<{ get_org_context: Row }>('select public.get_org_context($1)', [A.orgId])
    expect(ctx.get_org_context.role).toBe('owner')
    expect(ctx.get_org_context.status).toBe('trialing')
    expect(ctx.get_org_context.can_write).toBe(true)
    const templates = await A.user.query('select * from public.message_templates where organization_id = $1', [A.orgId])
    expect(templates).toHaveLength(3)
  })

  it('anônimo não acessa nada', async () => {
    await expect(db.as(null).query('select * from public.customers')).rejects.toThrow(/permission denied/)
  })
})

describe('isolamento multi-tenant (RLS)', () => {
  it('usuário de B não enxerga nem altera dados de A', async () => {
    const c = await createCustomer(A, 'Maria Silva', '(11) 91234-5678')
    expect(await B.user.query('select * from public.customers where id = $1', [c.id])).toHaveLength(0)
    expect(await B.user.query('select * from public.organizations where id = $1', [A.orgId])).toHaveLength(0)
    const upd = await B.user.query('update public.customers set full_name = $2 where id = $1 returning id', [c.id, 'Hack'])
    expect(upd).toHaveLength(0)
    const del = await B.user.query('delete from public.customers where id = $1 returning id', [c.id])
    expect(del).toHaveLength(0)
  })

  it('não permite inserir em organização alheia enviando organization_id', async () => {
    await expect(
      B.user.query('insert into public.customers (organization_id, full_name) values ($1, $2)', [A.orgId, 'Intruso']),
    ).rejects.toThrow(/row-level security/)
  })

  it('RPCs validam associação no servidor', async () => {
    const c = await B.user.one<{ id: string }>('select id from public.customers limit 1')
    expect(c).toBeUndefined()
    const custA = await createCustomer(A, 'Cliente Alvo', null)
    const prodA = await createProduct(A, 'Ração Alvo', 100, 30)
    await expect(buy(B, custA.id, await today(A.orgId), [{ product_id: prodA.id, quantity: 1 }])).rejects.toThrow(/FORBIDDEN|CUSTOMER_NOT_FOUND/)
    await expect(
      B.user.query('select public.create_purchase($1, $2, current_date, $3::jsonb)', [A.orgId, custA.id, JSON.stringify([{ product_id: prodA.id, quantity: 1 }])]),
    ).rejects.toThrow(/FORBIDDEN/)
    await expect(B.user.query('select public.dashboard_metrics($1, current_date - 7, current_date)', [A.orgId])).rejects.toThrow(/FORBIDDEN/)
  })

  it('não é possível vincular pet de B a cliente de A (FK composta)', async () => {
    const custA = await createCustomer(A, 'Dono do Rex', null)
    await expect(
      B.user.query(`insert into public.pets (organization_id, customer_id, name) values ($1, $2, 'Rex')`, [B.orgId, custA.id]),
    ).rejects.toThrow()
  })

  it('usuários não podem alterar assinaturas, previsões ou compras diretamente', async () => {
    const upd = await A.user.query(`update public.subscriptions set plan = 'premium', status = 'active' where organization_id = $1 returning 1`, [A.orgId])
    expect(upd).toHaveLength(0)
    await expect(
      A.user.query(`insert into public.purchases (organization_id, customer_id, purchase_date, subtotal, total) select $1, id, current_date, 0, 0 from public.customers limit 1`, [A.orgId]),
    ).rejects.toThrow(/row-level security/)
    await expect(A.user.query('select * from public.payment_events')).resolves.toHaveLength(0)
  })
})

describe('clientes e produtos', () => {
  it('normaliza telefone e impede duplicidade no mesmo estabelecimento', async () => {
    const c = await createCustomer(A, 'João Souza', '(21) 98888-7777')
    const row = await A.user.one<Row>('select phone_normalized from public.customers where id = $1', [c.id])
    expect(row.phone_normalized).toBe('5521988887777')
    await expect(createCustomer(A, 'João Duplicado', '21 988887777')).rejects.toThrow(/customers_org_phone_uq/)
    // Mesmo telefone em outra organização é permitido
    await expect(createCustomer(B, 'João em B', '(21) 98888-7777')).resolves.toBeTruthy()
  })

  it('rejeita telefone inválido', async () => {
    await expect(createCustomer(A, 'Fone Ruim', '123')).rejects.toThrow(/INVALID_PHONE/)
  })

  it('cria produto com duração configurável e SKU único', async () => {
    const p = await createProduct(A, 'Areia Gato 4kg', 39.9, 20)
    const row = await A.user.one<Row>('select avg_duration_days, price from public.products where id = $1', [p.id])
    expect(row.avg_duration_days).toBe(20)
    await A.user.query(`update public.products set sku = 'SKU-1' where id = $1`, [p.id])
    const p2 = await createProduct(A, 'Outro', 10, 10)
    await expect(A.user.query(`update public.products set sku = 'sku-1' where id = $1`, [p2.id])).rejects.toThrow(/products_org_sku_uq/)
  })

  it('funcionário não pode excluir cliente; owner pode', async () => {
    const staffId = await db.createUser('func@teste.com')
    await db.admin.query(`insert into public.organization_members values ($1, $2, 'employee')`, [A.orgId, staffId])
    const staff = db.as(staffId)
    const c = await createCustomer(A, 'Para Excluir', null)
    expect(await staff.query('delete from public.customers where id = $1 returning id', [c.id])).toHaveLength(0)
    expect(await A.user.query('delete from public.customers where id = $1 returning id', [c.id])).toHaveLength(1)
    // auditoria registrou a exclusão sem dados pessoais
    const audit = await A.user.query<Row>(`select * from public.audit_logs where entity = 'customers' and action = 'delete' and entity_id = $1`, [c.id])
    expect(audit).toHaveLength(1)
    expect(JSON.stringify(audit[0].details)).not.toContain('Para Excluir')
    // funcionário não lê auditoria
    expect(await staff.query('select * from public.audit_logs')).toHaveLength(0)
  })
})

describe('compras e motor de previsão', () => {
  it('registra compra com preço histórico, totais e previsão pela duração do produto', async () => {
    const c = await createCustomer(A, 'Ana Lima', '(11) 97777-1111')
    const p = await createProduct(A, 'Ração Premium 15kg', 200, 35)
    const t = await today(A.orgId)
    const purchaseId = await buy(A, c.id, t, [{ product_id: p.id, quantity: 1 }])
    const purchase = await A.user.one<Row>('select * from public.purchases where id = $1', [purchaseId])
    expect(Number(purchase.total)).toBe(200)

    // preço muda depois — histórico preservado
    await A.user.query('update public.products set price = 250 where id = $1', [p.id])
    const item = await A.user.one<Row>('select unit_price from public.purchase_items where purchase_id = $1', [purchaseId])
    expect(Number(item.unit_price)).toBe(200)

    const pred = await activePrediction(A, c.id, p.id)
    expect(pred.expected_days).toBe(35)
    expect(pred.expected_date).toBeDefined()
    expect(pred.stage).toBe('prevista')
    expect(pred.days_until).toBe(35)
  })

  it('ajusta a duração pela quantidade', async () => {
    const c = await createCustomer(A, 'Bruno Q', null)
    const p = await createProduct(A, 'Sachê', 3, 5)
    await buy(A, c.id, await today(A.orgId), [{ product_id: p.id, quantity: 6 }])
    expect((await activePrediction(A, c.id, p.id)).expected_days).toBe(30)
  })

  it('soma itens repetidos do mesmo produto em uma única previsão', async () => {
    const c = await createCustomer(A, 'Carla Rep', null)
    const p = await createProduct(A, 'Petisco', 10, 10)
    await buy(A, c.id, await today(A.orgId), [{ product_id: p.id, quantity: 1 }, { product_id: p.id, quantity: 2 }])
    const preds = await A.user.query('select * from public.replenishment_predictions where customer_id = $1', [c.id])
    expect(preds).toHaveLength(1)
    expect((preds[0] as Row).expected_days).toBe(30)
  })

  it('nova compra antes da previsão encerra a anterior como concluída e cria nova (sem duplicar)', async () => {
    const c = await createCustomer(A, 'Diego Antecipado', null)
    const p = await createProduct(A, 'Ração 10kg', 150, 30)
    const t = await today(A.orgId)
    await buy(A, c.id, addDays(t, -20), [{ product_id: p.id, quantity: 1 }])
    const first = await activePrediction(A, c.id, p.id)
    const secondPurchase = await buy(A, c.id, t, [{ product_id: p.id, quantity: 1 }])
    const all = await A.user.query<Row>('select * from public.replenishment_predictions where customer_id = $1 order by created_at', [c.id])
    expect(all).toHaveLength(2)
    const old = all.find((r) => r.id === first.id)!
    expect(old.status).toBe('completed')
    expect(old.completed_purchase_id).toBe(secondPurchase)
    expect(old.recovered).toBe(false) // sem contato registrado => não é venda recuperada
    expect(all.filter((r) => r.status === 'open')).toHaveLength(1)
  })

  it('poucos registros não desestabilizam; histórico consistente ajusta a previsão', async () => {
    const c = await createCustomer(A, 'Elisa Histórico', null)
    const p = await createProduct(A, 'Ração Hist', 100, 30)
    const t = await today(A.orgId)
    // Apenas 1 intervalo (20 dias) < mínimo (2): usa só a duração do produto
    await buy(A, c.id, addDays(t, -40), [{ product_id: p.id, quantity: 1 }])
    await buy(A, c.id, addDays(t, -20), [{ product_id: p.id, quantity: 1 }])
    expect((await activePrediction(A, c.id, p.id)).expected_days).toBe(30)
    // 2 intervalos de 20 dias => mediana 20, peso 2/5 = 0.4 => 0.6*30 + 0.4*20 = 26
    await buy(A, c.id, t, [{ product_id: p.id, quantity: 1 }])
    const pred = await activePrediction(A, c.id, p.id)
    expect(pred.expected_days).toBe(26)
    expect(pred.history_samples).toBe(2)
  })

  it('limita outliers do histórico', async () => {
    const c = await createCustomer(A, 'Fábio Outlier', null)
    const p = await createProduct(A, 'Ração Out', 100, 30)
    const t = await today(A.orgId)
    await buy(A, c.id, addDays(t, -400), [{ product_id: p.id, quantity: 1 }])
    await buy(A, c.id, addDays(t, -200), [{ product_id: p.id, quantity: 1 }])
    await buy(A, c.id, t, [{ product_id: p.id, quantity: 1 }])
    // intervalos de 200 dias são limitados a 2,5 x 30 = 75 => 0.6*30 + 0.4*75 = 48
    expect((await activePrediction(A, c.id, p.id)).expected_days).toBe(48)
  })

  it('compra retroativa não substitui a previsão mais recente', async () => {
    const c = await createCustomer(A, 'Gabi Retro', null)
    const p = await createProduct(A, 'Ração Retro', 100, 30)
    const t = await today(A.orgId)
    await buy(A, c.id, t, [{ product_id: p.id, quantity: 1 }])
    const current = await activePrediction(A, c.id, p.id)
    await buy(A, c.id, addDays(t, -50), [{ product_id: p.id, quantity: 1 }])
    const after = await activePrediction(A, c.id, p.id)
    expect(after.id).toBe(current.id)
  })

  it('é idempotente com client_request_id e rejeita datas futuras', async () => {
    const c = await createCustomer(A, 'Hugo Idem', null)
    const p = await createProduct(A, 'Ração Idem', 100, 30)
    const t = await today(A.orgId)
    const key = '11111111-1111-4111-8111-111111111111'
    const a = await buy(A, c.id, t, [{ product_id: p.id, quantity: 1 }], key)
    const b = await buy(A, c.id, t, [{ product_id: p.id, quantity: 1 }], key)
    expect(a).toBe(b)
    expect(await A.user.query('select * from public.purchases where customer_id = $1', [c.id])).toHaveLength(1)
    await expect(buy(A, c.id, addDays(t, 1), [{ product_id: p.id, quantity: 1 }])).rejects.toThrow(/INVALID_DATE/)
    await expect(buy(A, c.id, t, [])).rejects.toThrow(/INVALID_ITEMS/)
  })

  it('excluir compra remove a previsão gerada e reabre a anterior', async () => {
    const c = await createCustomer(A, 'Iara Del', null)
    const p = await createProduct(A, 'Ração Del', 100, 30)
    const t = await today(A.orgId)
    await buy(A, c.id, addDays(t, -10), [{ product_id: p.id, quantity: 1 }])
    const first = await activePrediction(A, c.id, p.id)
    const second = await buy(A, c.id, t, [{ product_id: p.id, quantity: 1 }])
    await A.user.query('select public.delete_purchase($1)', [second])
    const active = await activePrediction(A, c.id, p.id)
    expect(active.id).toBe(first.id)
    expect(active.status).toBe('open')
  })

  it('estados derivados: próxima, hoje e atrasada', async () => {
    const c = await createCustomer(A, 'Júlia Estados', null)
    const p1 = await createProduct(A, 'P Próx', 10, 33)
    const p2 = await createProduct(A, 'P Hoje', 10, 30)
    const p3 = await createProduct(A, 'P Atras', 10, 25)
    const t = await today(A.orgId)
    await buy(A, c.id, addDays(t, -30), [
      { product_id: p1.id, quantity: 1 },
      { product_id: p2.id, quantity: 1 },
      { product_id: p3.id, quantity: 1 },
    ])
    expect((await activePrediction(A, c.id, p1.id)).stage).toBe('proxima')
    expect((await activePrediction(A, c.id, p2.id)).stage).toBe('hoje')
    expect((await activePrediction(A, c.id, p3.id)).stage).toBe('atrasada')
    const vc = await A.user.one<Row>('select situation from public.v_customers where id = $1', [c.id])
    expect(vc.situation).toBe('precisa_contato')
  })
})

describe('contatos e vendas recuperadas', () => {
  it('registra contato, marca previsão como contatada e atribui venda recuperada', async () => {
    const c = await createCustomer(A, 'Kátia Contato', '(11) 95555-0000')
    const p = await createProduct(A, 'Ração Rec', 180, 30)
    const t = await today(A.orgId)
    await buy(A, c.id, addDays(t, -31), [{ product_id: p.id, quantity: 1 }])
    const pred = await activePrediction(A, c.id, p.id)
    await A.user.query(
      `select public.log_contact($1, $2, 'respondeu', $3, null, 'Olá Kátia', null, null)`,
      [A.orgId, c.id, pred.id],
    )
    const contacted = await activePrediction(A, c.id, p.id)
    expect(contacted.status).toBe('contacted')
    expect(contacted.stage).toBe('contatada')
    const log = await A.user.one<Row>('select * from public.contact_logs where customer_id = $1', [c.id])
    expect(log.user_id).toBe(A.userId)
    expect(log.message).toBe('Olá Kátia')

    await buy(A, c.id, t, [{ product_id: p.id, quantity: 1, unit_price: 170 }])
    const done = await A.user.one<Row>('select * from public.replenishment_predictions where id = $1', [pred.id])
    expect(done.status).toBe('completed')
    expect(done.recovered).toBe(true)
    expect(Number(done.recovered_amount)).toBe(170)
  })

  it('bloqueia contato com cliente que pediu para não ser contatado (LGPD)', async () => {
    const c = await createCustomer(A, 'Leo Opt-out', null)
    await A.user.query('update public.customers set do_not_contact = true where id = $1', [c.id])
    const row = await A.user.one<Row>('select do_not_contact_at from public.customers where id = $1', [c.id])
    expect(row.do_not_contact_at).not.toBeNull()
    await expect(
      A.user.query(`select public.log_contact($1, $2, 'respondeu')`, [A.orgId, c.id]),
    ).rejects.toThrow(/CUSTOMER_OPTED_OUT/)
  })

  it('aplica rate limit em registros de contato', async () => {
    const c = await createCustomer(A, 'Rate Limit', null)
    await db.admin.query(`update public.contact_logs set contacted_at = now() - interval '2 minutes' where user_id = $1`, [A.userId])
    for (let i = 0; i < 20; i++) {
      await A.user.query(`select public.log_contact($1, $2, 'nao_respondeu')`, [A.orgId, c.id])
    }
    await expect(A.user.query(`select public.log_contact($1, $2, 'nao_respondeu')`, [A.orgId, c.id])).rejects.toThrow(/RATE_LIMITED/)
    await db.admin.query(`update public.contact_logs set contacted_at = now() - interval '2 minutes' where customer_id = $1`, [c.id])
  })
})

describe('indicadores e relatórios', () => {
  it('dashboard calcula a partir dos dados reais', async () => {
    const t = await today(A.orgId)
    const m = (await A.user.one<{ dashboard_metrics: Row }>(
      'select public.dashboard_metrics($1, $2::date, $3::date)', [A.orgId, addDays(t, -30), t],
    )).dashboard_metrics
    const total = await A.user.one<{ n: number }>('select count(*)::int as n from public.customers')
    expect(m.customers_total).toBe(total.n)
    expect(Number(m.recovered_sales)).toBeGreaterThanOrEqual(1)
    expect(Number(m.recovered_revenue)).toBeGreaterThanOrEqual(170)
    expect((m.series as Row[]).length).toBe(31)
    expect(Number(m.contact_today)).toBeGreaterThanOrEqual(1)
    // Organização B não tem receita recuperada
    const mb = (await B.user.one<{ dashboard_metrics: Row }>(
      'select public.dashboard_metrics($1, $2::date, $3::date)', [B.orgId, addDays(t, -30), t],
    )).dashboard_metrics
    expect(Number(mb.recovered_revenue)).toBe(0)
  })

  it('valor potencial não é confundido com receita recuperada', async () => {
    const t = await today(A.orgId)
    const r = await A.user.one<{ get_report: Row[] }>(
      `select public.get_report($1, 'recovered_revenue', $2::date, $3::date)`, [A.orgId, addDays(t, -30), t],
    )
    const sum = r.get_report.reduce((s, x) => s + Number(x.amount), 0)
    expect(sum).toBe(170)
  })

  it('relatórios completos exigem plano Profissional ou superior', async () => {
    const t = await today(B.orgId)
    await db.admin.query(`update public.subscriptions set plan = 'inicial', status = 'active' where organization_id = $1`, [B.orgId])
    await expect(
      B.user.query(`select public.get_report($1, 'top_products', $2::date, $2::date)`, [B.orgId, t]),
    ).rejects.toThrow(/PLAN_FEATURE_UNAVAILABLE/)
    await expect(
      B.user.query(`select public.get_report($1, 'sales_by_period', $2::date, $2::date)`, [B.orgId, t]),
    ).resolves.toBeTruthy()
  })
})

describe('planos e assinatura', () => {
  it('limita clientes no plano Inicial (100)', async () => {
    const b = B
    const existing = (await b.user.one<{ n: number }>('select count(*)::int as n from public.customers')).n
    await db.admin.query(
      `insert into public.customers (organization_id, full_name) select $1, 'Cliente ' || g from generate_series(1, $2) g`,
      [b.orgId, 100 - existing],
    )
    await expect(createCustomer(b, 'Cliente 101', null)).rejects.toThrow(/PLAN_LIMIT_CUSTOMERS/)
  })

  it('trial expirado bloqueia escrita, mantendo leitura', async () => {
    const C = await setupOrg(db, 'dono-c@teste.com', 'Pet Shop C')
    await createCustomer(C, 'Antes de expirar', null)
    await db.admin.query(`update public.subscriptions set trial_ends_at = now() - interval '1 day' where organization_id = $1`, [C.orgId])
    const ctx = await C.user.one<{ get_org_context: Row }>('select public.get_org_context($1)', [C.orgId])
    expect(ctx.get_org_context.effective_status).toBe('expired')
    await expect(createCustomer(C, 'Depois', null)).rejects.toThrow(/row-level security/)
    expect(await C.user.query('select * from public.customers')).toHaveLength(1)
  })
})

describe('equipe e convites', () => {
  it('convite pendente é aceito quando o usuário convidado entra', async () => {
    await A.user.query(
      `insert into public.organization_invitations (organization_id, email, role, invited_by) values ($1, 'novo@teste.com', 'admin', $2)`,
      [A.orgId, A.userId],
    )
    const newId = await db.createUser('novo@teste.com')
    const n = await db.as(newId).one<{ accept_pending_invitations: number }>('select public.accept_pending_invitations()')
    expect(n.accept_pending_invitations).toBe(1)
    const ctx = await db.as(newId).one<{ get_org_context: Row }>('select public.get_org_context($1)', [A.orgId])
    expect(ctx.get_org_context.role).toBe('admin')
  })

  it('admin não pode promover ninguém a owner nem remover o owner', async () => {
    const adminId = (await db.admin.query<{ id: string }>(`select id from auth.users where email = 'novo@teste.com'`))[0].id
    await expect(db.as(adminId).query('select public.update_member_role($1, $2, $3)', [A.orgId, A.userId, 'employee'])).rejects.toThrow(/FORBIDDEN/)
    await expect(db.as(adminId).query('select public.remove_member($1, $2)', [A.orgId, A.userId])).rejects.toThrow(/FORBIDDEN/)
  })
})

describe('LGPD', () => {
  it('exporta dados de um cliente', async () => {
    const c = await createCustomer(A, 'Mara Export', '(31) 94444-3333')
    await A.user.query(`insert into public.pets (organization_id, customer_id, name, species) values ($1, $2, 'Mel', 'gato')`, [A.orgId, c.id])
    const r = await A.user.one<{ export_customer_data: Row }>('select public.export_customer_data($1)', [c.id])
    expect((r.export_customer_data.customer as Row).full_name).toBe('Mara Export')
    expect(r.export_customer_data.pets).toHaveLength(1)
    await expect(B.user.query('select public.export_customer_data($1)', [c.id])).rejects.toThrow(/FORBIDDEN/)
  })
})
