/**
 * Migration 0018: qualquer tipo de estabelecimento. Ramos novos, categorias
 * livres (sem perder os códigos antigos) e modelos de mensagem sem "pet"
 * para quem não é do ramo pet. Roda como usuário autenticado (RLS de verdade).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { createDb, setupOrg, type Db } from './harness'

let db: Db

async function orgOfType(email: string, type: string | null) {
  const userId = await db.createUser(email)
  const user = db.as(userId)
  const { create_organization: orgId } = await user.one<{ create_organization: string }>(
    'select public.create_organization($1, $2, $3, $4, $5, $6)', ['Negócio ' + email, 'Dono', null, null, null, type])
  return { userId, orgId, user }
}

beforeAll(async () => {
  db = await createDb()
})

describe('ramo do estabelecimento (0018)', () => {
  it('aceita ramos novos e os antigos', async () => {
    for (const t of ['salao_beleza', 'oficina', 'mercado', 'pet_shop', 'loja_racao']) {
      const o = await orgOfType(`ramo-${t}@teste.com`, t)
      const r = await o.user.one<{ business_type: string }>('select business_type from public.organizations where id = $1', [o.orgId])
      expect(r.business_type).toBe(t)
    }
  })

  it('recusa código de ramo malformado', async () => {
    const u = await db.createUser('ramo-ruim@teste.com')
    await expect(db.as(u).query('select public.create_organization($1, null, null, null, null, $2)', ['Loja X', 'Salão de Beleza!'])).rejects.toThrow()
  })
})

describe('categorias livres (0018)', () => {
  it('produto aceita categoria digitada e continua aceitando o código antigo', async () => {
    const o = await orgOfType('cat-prod@teste.com', 'loja_roupas')
    const rows = await o.user.query<{ category: string }>(
      `insert into public.products (organization_id, name, category, price) values
         ($1, 'Camiseta básica', 'Roupas', 49.9), ($1, 'Ração antiga', 'racoes', 10) returning category`, [o.orgId])
    expect(rows.map((r) => r.category).sort()).toEqual(['Roupas', 'racoes'])
    const def = await o.user.one<{ category: string }>(
      `insert into public.products (organization_id, name, price) values ($1, 'Sem categoria', 1) returning category`, [o.orgId])
    expect(def.category).toBe('outros')
  })

  it('recusa categoria vazia ou longa demais', async () => {
    const o = await orgOfType('cat-limite@teste.com', 'loja')
    await expect(o.user.query(`insert into public.products (organization_id, name, category, price) values ($1, 'X1', '  ', 1)`, [o.orgId])).rejects.toThrow()
    await expect(o.user.query(`insert into public.products (organization_id, name, category, price) values ($1, 'X2', $2, 1)`, [o.orgId, 'a'.repeat(41)])).rejects.toThrow()
  })

  it('serviço e profissional aceitam texto livre', async () => {
    const o = await orgOfType('cat-serv@teste.com', 'barbearia')
    const s = await o.user.one<{ category: string }>(
      `insert into public.services (organization_id, name, category, price, duration_minutes) values ($1, 'Corte degradê', 'Corte', 40, 30) returning category`, [o.orgId])
    expect(s.category).toBe('Corte')
    const p = await o.user.one<{ role: string }>(
      `insert into public.professionals (organization_id, name, role) values ($1, 'João', 'Barbeiro(a)') returning role`, [o.orgId])
    expect(p.role).toBe('Barbeiro(a)')
    const d = await o.user.one<{ category: string }>(
      `insert into public.services (organization_id, name, price, duration_minutes) values ($1, 'Sem categoria', 10, 30) returning category`, [o.orgId])
    expect(d.category).toBe('outro')
  })

  it('a central de recompras (v_predictions) continua mostrando a categoria do produto', async () => {
    const o = await orgOfType('cat-prev@teste.com', 'mercado')
    const prod = await o.user.one<{ id: string }>(
      `insert into public.products (organization_id, name, category, price, avg_duration_days) values ($1, 'Café 500g', 'Mercearia', 20, 20) returning id`, [o.orgId])
    const cust = await o.user.one<{ id: string }>(
      `insert into public.customers (organization_id, full_name, phone) values ($1, 'Ana', '(11) 98888-1111') returning id`, [o.orgId])
    await o.user.query(`select public.create_purchase($1, $2, current_date, $3::jsonb)`,
      [o.orgId, cust.id, JSON.stringify([{ product_id: prod.id, quantity: 1, unit_price: 20 }])])
    const v = await o.user.one<{ product_category: string; product_name: string }>(
      'select product_category, product_name from public.v_predictions where organization_id = $1', [o.orgId])
    expect(v).toMatchObject({ product_category: 'Mercearia', product_name: 'Café 500g' })
  })
})

describe('modelos de mensagem padrão por ramo (0018)', () => {
  const bodies = async (o: { orgId: string; user: ReturnType<Db['as']> }) =>
    (await o.user.query<{ kind: string; body: string }>('select kind, body from public.message_templates where organization_id = $1 and is_default', [o.orgId]))

  it('quem não é do ramo pet recebe modelos sem "pet" (exceto o aniversário do pet)', async () => {
    const o = await orgOfType('tpl-salao@teste.com', 'salao_beleza')
    const t = await bodies(o)
    expect(t).toHaveLength(8)
    for (const r of t.filter((x) => x.kind !== 'aniversario')) expect(r.body.toLowerCase()).not.toContain('pet')
  })

  it('pet shop continua com os modelos que falam do pet', async () => {
    const o = await setupOrg(db, 'tpl-pet@teste.com')
    const t = await bodies(o)
    expect(t.find((x) => x.kind === 'reposicao')?.body).toContain('para seu pet')
    expect(t.find((x) => x.kind === 'lembrete_agendamento')?.body).toContain('{pet}')
  })

  it('restaurar padrão usa o ramo atual do estabelecimento', async () => {
    const o = await setupOrg(db, 'tpl-troca@teste.com')
    await o.user.query(`update public.organizations set business_type = 'oficina' where id = $1`, [o.orgId])
    await o.user.query('select public.restore_default_templates($1)', [o.orgId])
    const t = await bodies(o)
    expect(t.find((x) => x.kind === 'reposicao')?.body).not.toContain('pet')
  })
})
