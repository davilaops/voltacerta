/**
 * Testes da migration 0005: planos centralizados, Super Admin,
 * suspensão, bloqueio de usuários, idempotência do onboarding e
 * endurecimento de colunas privilegiadas. Rodam sob RLS real (PGlite).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { createDb, setupOrg, type Db } from './harness'

type Row = Record<string, unknown>
let db: Db
let owner: Awaited<ReturnType<typeof setupOrg>>
let other: Awaited<ReturnType<typeof setupOrg>>
let adminId: string
const today = () => new Date().toISOString().slice(0, 10)

beforeAll(async () => {
  db = await createDb()
  owner = await setupOrg(db, 'dono@loja.com', 'Loja Um')
  other = await setupOrg(db, 'outro@loja.com', 'Loja Dois')
  adminId = await db.createUser('admin@voltacerta.com.br')
})

describe('planos centralizados', () => {
  it('preços e limites vêm da tabela plans e são públicos para leitura', async () => {
    const plans = await db.as(null).query<Row>('select id, price_cents, customer_limit from public.plans order by sort_order')
    expect(plans).toEqual([
      { id: 'inicial', price_cents: 3990, customer_limit: 100 },
      { id: 'profissional', price_cents: 6990, customer_limit: 500 },
      { id: 'premium', price_cents: 27990, customer_limit: null },
    ])
  })
  it('anônimo e usuário comum não alteram planos', async () => {
    await expect(db.as(null).query(`update public.plans set price_cents = 1`)).rejects.toThrow(/permission denied/)
    await expect(owner.user.query(`update public.plans set price_cents = 1`)).rejects.toThrow(/permission denied/)
  })
  it('limite do plano segue a tabela (alteração reflete no backend)', async () => {
    await db.admin.query(`update public.plans set customer_limit = 2 where id = 'profissional'`)
    await owner.user.query(`insert into public.customers (organization_id, full_name) values ($1, 'C1'), ($1, 'C2')`, [owner.orgId])
    await expect(owner.user.query(`insert into public.customers (organization_id, full_name) values ($1, 'C3')`, [owner.orgId])).rejects.toThrow(/PLAN_LIMIT_CUSTOMERS/)
    await db.admin.query(`update public.plans set customer_limit = 500 where id = 'profissional'`)
  })
})

describe('onboarding idempotente', () => {
  it('não cria organização duplicada em chamadas repetidas', async () => {
    const uid = await db.createUser('novo@loja.com')
    const u = db.as(uid)
    const a = await u.one<{ id: string }>(`select public.create_organization('Loja Nova') as id`)
    const b = await u.one<{ id: string }>(`select public.create_organization('Loja Nova (corrigido)') as id`)
    expect(b.id).toBe(a.id)
    const orgs = await u.query<Row>('select name from public.organizations')
    expect(orgs).toEqual([{ name: 'Loja Nova (corrigido)' }])
    const sub = await u.one<Row>('select status, trial_started_at from public.subscriptions')
    expect(sub.status).toBe('trialing')
    expect(sub.trial_started_at).not.toBeNull()
  })
  it('com onboarding concluído, segundo estabelecimento só com p_additional', async () => {
    await owner.user.query(`update public.organizations set onboarding_completed = true where id = $1`, [owner.orgId])
    await expect(owner.user.query(`select public.create_organization('Outra')`)).rejects.toThrow(/ORG_ALREADY_EXISTS/)
    const r = await owner.user.one<{ id: string }>(`select public.create_organization('Filial', null, null, null, null, null, true) as id`)
    expect(r.id).not.toBe(owner.orgId)
  })
})

describe('colunas privilegiadas protegidas', () => {
  it('owner não consegue remover a própria suspensão nem alterar o próprio bloqueio', async () => {
    await expect(owner.user.query(`update public.organizations set suspended_at = null where id = $1`, [owner.orgId])).rejects.toThrow(/permission denied/)
    await expect(owner.user.query(`update public.profiles set blocked_at = null where id = $1`, [owner.userId])).rejects.toThrow(/permission denied/)
    // colunas permitidas continuam funcionando
    expect(await owner.user.query(`update public.organizations set city = 'Campinas' where id = $1 returning id`, [owner.orgId])).toHaveLength(1)
    expect(await owner.user.query(`update public.profiles set full_name = 'Dono' where id = $1 returning id`, [owner.userId])).toHaveLength(1)
  })
  it('usuários não leem tabelas de plataforma', async () => {
    expect(await owner.user.query('select * from public.platform_admins')).toHaveLength(0)
    expect(await owner.user.query('select * from public.admin_audit_logs')).toHaveLength(0)
  })
})

describe('promoção do Super Admin (somente backend)', () => {
  it('usuário autenticado não pode se promover', async () => {
    await expect(owner.user.query(`select public.promote_super_admin('dono@loja.com')`)).rejects.toThrow(/permission denied/)
    await expect(owner.user.query(`insert into public.platform_admins (user_id) values ($1)`, [owner.userId])).rejects.toThrow(/row-level security/)
  })
  it('falha para e-mail inexistente', async () => {
    await expect(db.admin.query(`select public.promote_super_admin('ninguem@x.com')`)).rejects.toThrow(/USER_NOT_FOUND/)
  })
  it('promove pelo backend, grava app_metadata e auditoria', async () => {
    const [r] = await db.admin.query<{ promote_super_admin: Row }>(`select public.promote_super_admin('ADMIN@voltacerta.com.br')`)
    expect(r.promote_super_admin).toMatchObject({ user_id: adminId, super_admin: true, already_admin: false })
    const [u] = await db.admin.query<Row>(`select raw_app_meta_data from auth.users where id = $1`, [adminId])
    expect(u.raw_app_meta_data).toMatchObject({ role: 'super_admin' })
    const status = await db.as(adminId).one<{ get_account_status: Row }>('select public.get_account_status()')
    expect(status.get_account_status).toMatchObject({ super_admin: true, blocked: false })
    const [again] = await db.admin.query<{ promote_super_admin: Row }>(`select public.promote_super_admin('admin@voltacerta.com.br')`)
    expect(again.promote_super_admin.already_admin).toBe(true)
  })
})

describe('painel Super Admin', () => {
  it('usuário comum recebe FORBIDDEN em todas as RPCs administrativas', async () => {
    const calls = [
      [`select public.admin_overview(current_date - 7, current_date)`, []],
      [`select public.admin_list_organizations()`, []],
      [`select public.admin_get_organization($1)`, [owner.orgId]],
      [`select public.admin_suspend_organization($1, 'motivo qualquer')`, [other.orgId]],
      [`select public.admin_grant_trial($1, 7, 'motivo qualquer')`, [other.orgId]],
      [`select public.admin_change_plan($1, 'premium', 'motivo qualquer')`, [owner.orgId]],
      [`select public.admin_list_users()`, []],
      [`select public.admin_block_user($1, 'motivo qualquer')`, [other.userId]],
      [`select public.admin_list_audit()`, []],
      [`select public.admin_update_plan('inicial', 1, null, 'motivo qualquer')`, []],
    ] as const
    for (const [sql, params] of calls) {
      await expect(owner.user.query(sql, [...params])).rejects.toThrow(/FORBIDDEN/)
    }
  })

  it('visão geral com totais reais e MRR apenas de pagamentos confirmados', async () => {
    await db.admin.query(
      `insert into public.payments (organization_id, provider, provider_payment_id, plan, amount_cents, status, paid_at)
       values ($1, 'abacatepay', 'pay_1', 'profissional', 6990, 'paid', now()), ($1, 'abacatepay', 'pay_2', 'profissional', 6990, 'pending', null)`,
      [owner.orgId],
    )
    const r = await db.as(adminId).one<{ admin_overview: Row }>(`select public.admin_overview($1::date - 7, $1::date)`, [today()])
    const o = r.admin_overview
    expect(o.organizations_total).toBeGreaterThanOrEqual(3)
    expect(o.users_total).toBeGreaterThanOrEqual(4)
    expect(o.trials_active).toBeGreaterThanOrEqual(3)
    expect(o.mrr_received_cents).toBe(6990)
    expect((o.signups as Row[]).length).toBe(8)
  })

  it('lista e pesquisa estabelecimentos com dono, membros e status', async () => {
    const r = await db.as(adminId).one<{ admin_list_organizations: { total: number; rows: Row[] } }>(`select public.admin_list_organizations('dois')`)
    expect(r.admin_list_organizations.total).toBe(1)
    expect(r.admin_list_organizations.rows[0]).toMatchObject({ name: 'Loja Dois', owner_email: 'outro@loja.com', members: 1, effective_status: 'trialing' })
  })

  it('suspende com justificativa (somente leitura) e reativa; tudo auditado', async () => {
    const admin = db.as(adminId)
    await expect(admin.query(`select public.admin_suspend_organization($1, '')`, [other.orgId])).rejects.toThrow(/REASON_REQUIRED/)
    await admin.query(`select public.admin_suspend_organization($1, 'Inadimplência confirmada')`, [other.orgId])
    const ctx = await other.user.one<{ get_org_context: Row }>('select public.get_org_context($1)', [other.orgId])
    expect(ctx.get_org_context).toMatchObject({ suspended: true, can_write: false, suspended_reason: 'Inadimplência confirmada' })
    await expect(other.user.query(`insert into public.customers (organization_id, full_name) values ($1, 'Cliente X')`, [other.orgId])).rejects.toThrow(/row-level security/)
    expect(await other.user.query('select id from public.organizations')).toHaveLength(1) // leitura mantida
    await admin.query(`select public.admin_reactivate_organization($1, 'Pagamento regularizado')`, [other.orgId])
    expect(await other.user.query(`insert into public.customers (organization_id, full_name) values ($1, 'Cliente X') returning id`, [other.orgId])).toHaveLength(1)
    const audit = await admin.one<{ admin_list_audit: { rows: Row[] } }>('select public.admin_list_audit()')
    const actions = audit.admin_list_audit.rows.map((a) => a.action)
    expect(actions).toEqual(expect.arrayContaining(['suspend_organization', 'reactivate_organization', 'promote_super_admin']))
    expect(audit.admin_list_audit.rows.find((a) => a.action === 'suspend_organization')).toMatchObject({ actor_id: adminId, actor_email: 'admin@voltacerta.com.br', reason: 'Inadimplência confirmada' })
  })

  it('concede trial e altera plano sem marcar como pago', async () => {
    const admin = db.as(adminId)
    await db.admin.query(`update public.subscriptions set trial_ends_at = now() - interval '1 day' where organization_id = $1`, [other.orgId])
    await admin.query(`select public.admin_grant_trial($1, 10, 'Extensão comercial')`, [other.orgId])
    await admin.query(`select public.admin_change_plan($1, 'premium', 'Upgrade autorizado')`, [other.orgId])
    const [s] = await db.admin.query<Row>(`select plan, status, trial_ends_at > now() + interval '9 days' as ok from public.subscriptions where organization_id = $1`, [other.orgId])
    expect(s).toEqual({ plan: 'premium', status: 'trialing', ok: true })
    // assinatura paga ativa não é rebaixada para trial
    await db.admin.query(`update public.subscriptions set status = 'active' where organization_id = $1`, [owner.orgId])
    await expect(admin.query(`select public.admin_grant_trial($1, 5, 'Tentativa indevida')`, [owner.orgId])).rejects.toThrow(/SUBSCRIPTION_ALREADY_ACTIVE/)
  })

  it('bloqueio de usuário corta acesso aos dados imediatamente; não bloqueia admins', async () => {
    const admin = db.as(adminId)
    await expect(admin.query(`select public.admin_block_user($1, 'tentando se bloquear')`, [adminId])).rejects.toThrow(/CANNOT_BLOCK_SELF/)
    await admin.query(`select public.admin_block_user($1, 'Uso indevido reportado')`, [other.userId])
    expect(await other.user.query('select * from public.customers')).toHaveLength(0)
    await expect(other.user.query('select public.get_org_context($1)', [other.orgId])).rejects.toThrow(/FORBIDDEN/)
    const st = await other.user.one<{ get_account_status: Row }>('select public.get_account_status()')
    expect(st.get_account_status).toMatchObject({ blocked: true, blocked_reason: 'Uso indevido reportado' })
    await admin.query(`select public.admin_unblock_user($1, 'Revisado e liberado')`, [other.userId])
    expect((await other.user.query('select * from public.customers')).length).toBeGreaterThan(0)
  })

  it('lista usuários com organizações e papéis, sem expor segredos', async () => {
    const r = await db.as(adminId).one<{ admin_list_users: { rows: Row[] } }>(`select public.admin_list_users('outro@')`)
    const u = r.admin_list_users.rows[0]
    expect(u).toMatchObject({ email: 'outro@loja.com', super_admin: false })
    expect(u.organizations).toEqual([expect.objectContaining({ name: 'Loja Dois', role: 'owner' })])
    expect(Object.keys(u)).not.toEqual(expect.arrayContaining(['encrypted_password', 'raw_app_meta_data']))
  })

  it('edita preço de plano com auditoria', async () => {
    await db.as(adminId).query(`select public.admin_update_plan('premium', 29990, null, 'Reajuste anual')`)
    const [p] = await db.as(null).query<Row>(`select price_cents from public.plans where id = 'premium'`)
    expect(p.price_cents).toBe(29990)
  })

  it('super admin revogado perde acesso', async () => {
    await db.admin.query(`select public.revoke_super_admin('admin@voltacerta.com.br')`)
    await expect(db.as(adminId).query(`select public.admin_list_users()`)).rejects.toThrow(/FORBIDDEN/)
  })
})

describe('papel employee', () => {
  it('funcionário é removível por admin; papel antigo "staff" não existe mais', async () => {
    const emp = await db.createUser('func2@loja.com')
    await db.admin.query(`insert into public.organization_members values ($1, $2, 'employee')`, [owner.orgId, emp])
    await owner.user.query('select public.remove_member($1, $2)', [owner.orgId, emp])
    await expect(db.admin.query(`select 'staff'::public.member_role`)).rejects.toThrow(/invalid input value/)
  })
})

describe('permissões de funções (0006)', () => {
  it('nenhuma função do schema public é executável por anon', async () => {
    const rows = await db.admin.query<Row>(`
      select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')`)
    expect(rows).toEqual([])
  })
  it('anon recebe permission denied nas RPCs; usuário logado continua usando', async () => {
    await expect(db.as(null).query(`select public.get_org_context($1)`, [owner.orgId])).rejects.toThrow(/permission denied/)
    await expect(db.as(null).query(`select public.admin_overview(current_date - 30, current_date)`)).rejects.toThrow(/permission denied/)
    await expect(db.as(null).query(`select public.create_organization('Invasor')`)).rejects.toThrow(/permission denied/)
    const ctx = await owner.user.one<{ c: { role: string } }>(`select public.get_org_context($1) as c`, [owner.orgId])
    expect(ctx.c.role).toBe('owner')
  })
  it('funções internas e de promoção seguem fechadas para authenticated', async () => {
    for (const fn of ['promote_super_admin(text)', 'revoke_super_admin(text)', '_assert_super_admin()', 'handle_new_user()']) {
      const [r] = await db.admin.query<{ ok: boolean }>(`select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') as ok`)
      expect(r.ok, fn).toBe(false)
    }
  })
  it('planos continuam públicos para a landing (anon)', async () => {
    expect(await db.as(null).query('select id from public.plans')).toHaveLength(3)
  })
})
