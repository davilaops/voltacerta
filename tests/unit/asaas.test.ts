import { beforeAll, describe, expect, it } from 'vitest'
import {
  asaas,
  asaasDateTime,
  asaasEnvironment,
  normalizeDocument,
  parseAsaasEvent,
  todayInBrazil,
  verifyAsaasToken,
} from '../../supabase/functions/_shared/asaas'
import type { BillingEvent } from '../../supabase/functions/_shared/billing'
import { createDb, setupOrg, type Db } from '../db/harness'

/** Payload no formato documentado de PAYMENT_* (webhook v3). */
function payEvent(event: string, opts: { id?: string; sub?: string | null; payment?: string; value?: number; at?: string } = {}) {
  return {
    id: opts.id ?? `evt_${Math.random().toString(36).slice(2)}&1`,
    event,
    dateCreated: opts.at ?? '2026-11-12 10:00:00',
    payment: {
      object: 'payment',
      id: opts.payment ?? 'pay_1',
      customer: 'cus_1',
      subscription: opts.sub === null ? undefined : (opts.sub ?? 'sub_1'),
      value: opts.value ?? 69.9,
      netValue: 67.91,
      billingType: 'PIX',
      status: event === 'PAYMENT_OVERDUE' ? 'OVERDUE' : 'RECEIVED',
      dueDate: '2026-11-12',
      paymentDate: '2026-11-12',
      externalReference: 'x',
    },
  }
}
const subEvent = (event: string, id: string, sub: string) => ({
  id, event, dateCreated: '2026-11-20 09:00:00',
  subscription: { object: 'subscription', id: sub, customer: 'cus_1', value: 69.9, cycle: 'MONTHLY', status: 'INACTIVE', deleted: true },
})

describe('Asaas: utilitários', () => {
  it('ambiente pela chave (hmlg = sandbox) ou forçado por ASAAS_ENV', () => {
    expect(asaasEnvironment('$aact_hmlg_000abc')).toBe('dev')
    expect(asaasEnvironment('$aact_prod_000abc')).toBe('prod')
    expect(asaasEnvironment('$aact_YTU5abc', 'sandbox')).toBe('dev')
    expect(asaasEnvironment('$aact_hmlg_000abc', 'production')).toBe('prod')
  })
  it('valida CPF e CNPJ pelos dígitos verificadores', () => {
    expect(normalizeDocument('529.982.247-25')).toBe('52998224725')
    expect(normalizeDocument('52998224724')).toBeNull()
    expect(normalizeDocument('111.111.111-11')).toBeNull()
    expect(normalizeDocument('11.222.333/0001-81')).toBe('11222333000181')
    expect(normalizeDocument('11222333000182')).toBeNull()
    expect(normalizeDocument('123')).toBeNull()
    expect(normalizeDocument(undefined)).toBeNull()
  })
  it('token do webhook em tempo constante; vazio nunca autentica', () => {
    expect(verifyAsaasToken('token-seguro-com-mais-de-32-caracteres', 'token-seguro-com-mais-de-32-caracteres')).toBe(true)
    expect(verifyAsaasToken('token-seguro-com-mais-de-32-caracteres', 'errado')).toBe(false)
    expect(verifyAsaasToken('token', null)).toBe(false)
    expect(verifyAsaasToken('', '')).toBe(false)
  })
  it('datas do Asaas (Brasília) e data de hoje no Brasil', () => {
    expect(asaasDateTime('2026-11-12 18:07:47')).toBe('2026-11-12T18:07:47-03:00')
    expect(asaasDateTime('2026-11-12')).toBe('2026-11-12T12:00:00-03:00')
    expect(asaasDateTime(null)).toBeNull()
    expect(todayInBrazil(new Date('2026-11-13T02:00:00Z'))).toBe('2026-11-12')
    expect(todayInBrazil(new Date('2026-11-13T04:00:00Z'))).toBe('2026-11-13')
  })
})

describe('Asaas: tradução dos eventos', () => {
  it('PAYMENT_CONFIRMED e PAYMENT_RECEIVED de assinatura => paid', () => {
    const ev = parseAsaasEvent(payEvent('PAYMENT_RECEIVED', { id: 'evt_a' }), true)
    expect(ev).toMatchObject({ provider: 'asaas', kind: 'paid', checkout_id: 'sub_1', subscription_id: 'sub_1', customer_id: 'cus_1', payment_id: 'pay_1', amount_cents: 6990, paid_at: '2026-11-12T10:00:00-03:00', dev_mode: true })
    expect((ev.payload as { devMode: boolean }).devMode).toBe(true)
    expect(parseAsaasEvent(payEvent('PAYMENT_CONFIRMED'), false).kind).toBe('paid')
  })
  it('vencida, cartão recusado e reprovada na análise => failed; estorno => refunded', () => {
    expect(parseAsaasEvent(payEvent('PAYMENT_OVERDUE'), true).kind).toBe('failed')
    expect(parseAsaasEvent(payEvent('PAYMENT_CREDIT_CARD_CAPTURE_REFUSED'), true).kind).toBe('failed')
    expect(parseAsaasEvent(payEvent('PAYMENT_REPROVED_BY_RISK_ANALYSIS'), true).kind).toBe('failed')
    expect(parseAsaasEvent(payEvent('PAYMENT_REFUNDED'), true).kind).toBe('refunded')
  })
  it('assinatura removida/inativada => canceled', () => {
    expect(parseAsaasEvent(subEvent('SUBSCRIPTION_DELETED', 'evt_d', 'sub_9'), true)).toMatchObject({ kind: 'canceled', subscription_id: 'sub_9', checkout_id: 'sub_9' })
    expect(parseAsaasEvent(subEvent('SUBSCRIPTION_INACTIVATED', 'evt_i', 'sub_9'), true).kind).toBe('canceled')
  })
  it('cobrança avulsa (sem assinatura) e eventos sem efeito são ignorados', () => {
    expect(parseAsaasEvent(payEvent('PAYMENT_RECEIVED', { sub: null }), true).kind).toBe('ignored')
    expect(parseAsaasEvent(payEvent('PAYMENT_CREATED'), true).kind).toBe('ignored')
    expect(parseAsaasEvent(subEvent('SUBSCRIPTION_CREATED', 'evt_c', 'sub_1'), true).kind).toBe('ignored')
    expect(parseAsaasEvent({ id: 'evt_x', event: 'CHECKOUT_PAID' }, true).kind).toBe('ignored')
  })
  it('exige id do evento', () => {
    expect(() => parseAsaasEvent({ event: 'PAYMENT_RECEIVED' }, true)).toThrow('EVENT_ID_MISSING')
  })
})

describe('Asaas: cliente da API', () => {
  it('usa a base do ambiente e o header access_token; erro vira exceção com código', async () => {
    const calls: [string, RequestInit][] = []
    const ok = (async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return new Response(JSON.stringify({ id: 'sub_1' }))
    }) as unknown as typeof fetch
    expect((await asaas<{ id: string }>('$aact_hmlg_k', 'dev', 'POST', '/subscriptions', { a: 1 }, ok)).id).toBe('sub_1')
    expect(calls[0][0]).toBe('https://api-sandbox.asaas.com/v3/subscriptions')
    expect((calls[0][1].headers as Record<string, string>).access_token).toBe('$aact_hmlg_k')
    await asaas('$aact_prod_k', 'prod', 'DELETE', '/subscriptions/sub_1', undefined, ok)
    expect(calls[1][0]).toBe('https://api.asaas.com/v3/subscriptions/sub_1')
    const fail = (async () => new Response(JSON.stringify({ errors: [{ code: 'invalid_cpfCnpj', description: 'O CPF/CNPJ informado é inválido.' }] }), { status: 400 })) as unknown as typeof fetch
    await expect(asaas('k', 'dev', 'POST', '/customers', {}, fail)).rejects.toMatchObject({ status: 400, code: 'invalid_cpfCnpj', message: 'O CPF/CNPJ informado é inválido.' })
  })
})

describe('Asaas: billing_apply_event (banco, PGlite)', () => {
  let db: Db
  let org: Awaited<ReturnType<typeof setupOrg>>
  const apply = async (ev: BillingEvent) =>
    (await db.admin.query<{ r: { status: string; error?: string } }>('select public.billing_apply_event($1::jsonb) as r', [JSON.stringify(ev)]))[0].r
  const sub = async () =>
    (await db.admin.query<{ status: string; plan: string; provider: string; provider_subscription_id: string | null; current_period_end: Date | null; eff: string }>(
      `select s.*, public.subscription_effective_status(s.organization_id)::text as eff from public.subscriptions s where organization_id = $1`, [org.orgId]))[0]
  const checkoutStatus = async (id: string) =>
    (await db.admin.query<{ status: string }>(`select status from public.billing_checkouts where provider_checkout_id = $1`, [id]))[0].status

  beforeAll(async () => {
    db = await createDb()
    org = await setupOrg(db, 'asaas@loja.com', 'Loja Asaas')
    await db.admin.query(`insert into public.billing_checkouts (organization_id, plan, provider, provider_checkout_id, amount_cents, dev_mode) values
      ($1, 'inicial', 'asaas', 'sub_abandonada', 3990, true),
      ($1, 'profissional', 'asaas', 'sub_1', 6990, true)`, [org.orgId])
  })

  it('assinatura abandonada removida/vencida não derruba o teste grátis', async () => {
    expect((await apply(parseAsaasEvent(payEvent('PAYMENT_OVERDUE', { id: 'evt_ov0', sub: 'sub_abandonada', payment: 'pay_ab' }), true))).status).toBe('applied')
    expect((await apply(parseAsaasEvent(subEvent('SUBSCRIPTION_DELETED', 'evt_del0', 'sub_abandonada'), true))).status).toBe('applied')
    expect((await sub()).status).toBe('trialing')
    expect(await checkoutStatus('sub_abandonada')).toBe('failed')
  })

  it('pagamento confirmado ativa o plano; o "recebido" do mesmo pagamento não estende o período de novo', async () => {
    expect((await apply(parseAsaasEvent(payEvent('PAYMENT_CONFIRMED', { id: 'evt_c1', payment: 'pay_1' }), true))).status).toBe('applied')
    const s1 = await sub()
    expect(s1).toMatchObject({ status: 'active', plan: 'profissional', provider: 'asaas', provider_subscription_id: 'sub_1', eff: 'active' })
    expect(new Date(s1.current_period_end!).toISOString()).toBe('2026-12-12T13:00:00.000Z')
    expect((await apply(parseAsaasEvent(payEvent('PAYMENT_RECEIVED', { id: 'evt_r1', payment: 'pay_1', at: '2026-12-14 08:00:00' }), true))).status).toBe('already_paid')
    expect(new Date((await sub()).current_period_end!).toISOString()).toBe('2026-12-12T13:00:00.000Z')
    const pays = await org.user.query<{ status: string; amount_cents: number; dev_mode: boolean }>('select status, amount_cents, dev_mode from public.payments')
    expect(pays).toEqual([{ status: 'paid', amount_cents: 6990, dev_mode: true }])
    expect(await checkoutStatus('sub_1')).toBe('completed')
  })

  it('evento de outra assinatura (antiga) não deixa a vigente em atraso', async () => {
    await apply(parseAsaasEvent(payEvent('PAYMENT_OVERDUE', { id: 'evt_ov1', sub: 'sub_abandonada', payment: 'pay_ab2' }), true))
    expect((await sub()).status).toBe('active')
  })

  it('renovação estende; vencida deixa atrasada; estorno e remoção funcionam', async () => {
    await apply(parseAsaasEvent(payEvent('PAYMENT_RECEIVED', { id: 'evt_c2', payment: 'pay_2', at: '2026-12-12 09:00:00' }), true))
    expect(new Date((await sub()).current_period_end!).toISOString()).toBe('2027-01-12T13:00:00.000Z')
    await apply(parseAsaasEvent(payEvent('PAYMENT_OVERDUE', { id: 'evt_ov2', payment: 'pay_3' }), true))
    expect((await sub()).status).toBe('past_due')
    await apply(parseAsaasEvent(payEvent('PAYMENT_REFUNDED', { id: 'evt_rf', payment: 'pay_2' }), true))
    const [p2] = await db.admin.query<{ status: string }>(`select status from public.payments where provider_payment_id = 'pay_2'`)
    expect(p2.status).toBe('refunded')
    await apply(parseAsaasEvent(subEvent('SUBSCRIPTION_DELETED', 'evt_del1', 'sub_1'), true))
    const s = await sub()
    expect(s.status).toBe('canceled')
    expect(s.eff).toBe('active') // período pago ainda vigente
  })

  it('evento de produção não libera checkout de sandbox', async () => {
    const other = await setupOrg(db, 'prod@loja.com', 'Loja Prod')
    await db.admin.query(`insert into public.billing_checkouts (organization_id, plan, provider, provider_checkout_id, amount_cents, dev_mode) values ($1, 'inicial', 'asaas', 'sub_dev', 3990, true)`, [other.orgId])
    const r = await apply(parseAsaasEvent(payEvent('PAYMENT_RECEIVED', { id: 'evt_env', sub: 'sub_dev', payment: 'pay_env' }), false))
    expect(r).toMatchObject({ status: 'error', error: 'ENVIRONMENT_MISMATCH' })
  })
})
