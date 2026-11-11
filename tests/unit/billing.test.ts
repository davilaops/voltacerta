import { beforeAll, describe, expect, it } from 'vitest'
import {
  abacatepay,
  hmacSha256Base64,
  keyEnvironment,
  parseAbacateEvent,
  safeEqual,
  verifyWebhookSecret,
  verifyWebhookSignature,
  type BillingEvent,
} from '../../supabase/functions/_shared/billing'
import { createDb, setupOrg, type Db } from '../db/harness'

const SECRET = 'segredo-do-webhook-com-32-caracteres!!'
const PUBLIC_KEY = 'chave-publica-de-teste'

/** Payload no formato documentado de subscription.* (webhook v2). */
function subEvent(event: string, opts: { id?: string; checkout?: string; sub?: string; payment?: string; status?: string; amount?: number; dev?: boolean } = {}) {
  return {
    id: opts.id ?? `log_${Math.random().toString(36).slice(2)}`,
    event,
    apiVersion: 2,
    devMode: opts.dev ?? true,
    data: {
      subscription: { id: opts.sub ?? 'subs_1', amount: opts.amount ?? 6990, currency: 'BRL', method: 'CARD', status: event === 'subscription.cancelled' ? 'CANCELLED' : 'ACTIVE', frequency: 'MONTHLY' },
      customer: { id: 'cust_1', name: 'Dono', email: 'dono@loja.com', taxId: '529.***.247-**' },
      checkout: { id: opts.checkout ?? 'bill_1', externalId: 'x', frequency: 'SUBSCRIPTION', status: 'PAID', customerId: 'cust_1', metadata: null },
      payment: { id: opts.payment ?? 'pay_1', amount: opts.amount ?? 6990, paidAmount: opts.amount ?? 6990, status: opts.status ?? 'APPROVED', createdAt: '2026-11-10T12:00:00.000Z', updatedAt: '2026-11-10T12:00:05.000Z' },
      payerInformation: { method: 'CARD', CARD: { number: '4242', brand: 'VISA' } },
    },
  }
}

describe('autenticidade do webhook', () => {
  it('segredo: aceita cabeçalho ou query; rejeita ausente, errado ou não configurado', () => {
    expect(verifyWebhookSecret(SECRET, SECRET, null)).toBe(true)
    expect(verifyWebhookSecret(SECRET, null, SECRET)).toBe(true)
    expect(verifyWebhookSecret(SECRET, 'errado', SECRET)).toBe(false) // cabeçalho tem prioridade
    expect(verifyWebhookSecret(SECRET, null, null)).toBe(false)
    expect(verifyWebhookSecret('', '', '')).toBe(false)
  })
  it('assinatura: HMAC-SHA256 base64 do corpo bruto', async () => {
    const raw = JSON.stringify(subEvent('subscription.completed'))
    const sig = await hmacSha256Base64(PUBLIC_KEY, raw)
    expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(await verifyWebhookSignature(PUBLIC_KEY, raw, sig)).toBe(true)
    expect(await verifyWebhookSignature(PUBLIC_KEY, raw + ' ', sig)).toBe(false)
    expect(await verifyWebhookSignature('outra', raw, sig)).toBe(false)
    expect(await verifyWebhookSignature(PUBLIC_KEY, raw, null)).toBe(false)
  })
  it('vetor conhecido de HMAC-SHA256 (RFC 4231, caso 2) em base64', async () => {
    expect(await hmacSha256Base64('Jefe', 'what do ya want for nothing?')).toBe('W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM=')
  })
  it('comparação em tempo constante', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })
})

describe('tradução dos eventos da AbacatePay', () => {
  it('subscription.completed e renewed com pagamento aprovado/pago => paid', () => {
    const ev = parseAbacateEvent(subEvent('subscription.completed', { status: 'APPROVED' }))
    expect(ev).toMatchObject({ kind: 'paid', checkout_id: 'bill_1', subscription_id: 'subs_1', customer_id: 'cust_1', payment_id: 'pay_1', amount_cents: 6990, paid_at: '2026-11-10T12:00:05.000Z', dev_mode: true })
    expect(parseAbacateEvent(subEvent('subscription.renewed', { status: 'PAID' })).kind).toBe('paid')
    expect(parseAbacateEvent(subEvent('subscription.renewed', { status: 'FAILED' })).kind).toBe('ignored')
  })
  it('falha, cancelamento e reembolso', () => {
    expect(parseAbacateEvent(subEvent('subscription.payment_failed', { status: 'FAILED' })).kind).toBe('failed')
    expect(parseAbacateEvent(subEvent('subscription.cancelled')).kind).toBe('canceled')
    const refund = parseAbacateEvent({ id: 'log_r', event: 'checkout.refunded', devMode: false, data: { checkout: { id: 'bill_9', frequency: 'SUBSCRIPTION' } } })
    expect(refund).toMatchObject({ kind: 'refunded', payment_id: 'bill_9', dev_mode: false })
  })
  it('checkout.completed é ignorado (o acesso vem só de subscription.*) e eventos desconhecidos também', () => {
    expect(parseAbacateEvent({ id: 'log_c', event: 'checkout.completed', data: { checkout: { id: 'bill_1', frequency: 'SUBSCRIPTION', status: 'PAID' } } }).kind).toBe('ignored')
    expect(parseAbacateEvent({ id: 'log_t', event: 'subscription.trial_started', data: {} }).kind).toBe('ignored')
    expect(parseAbacateEvent({ id: 'log_x', event: 'algo.novo' }).kind).toBe('ignored')
  })
  it('exige id do evento', () => {
    expect(() => parseAbacateEvent({ event: 'subscription.completed' })).toThrow('EVENT_ID_MISSING')
  })
})

describe('cliente da API', () => {
  it('ambiente pela chave', () => {
    expect(keyEnvironment('abc_dev_123')).toBe('dev')
    expect(keyEnvironment('abc_prod_123')).toBe('prod')
  })
  it('envia Bearer na v2 e desembrulha o envelope; erro vira exceção', async () => {
    const calls: [string, RequestInit][] = []
    const ok = (async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return new Response(JSON.stringify({ data: { id: 'bill_1', url: 'https://app.abacatepay.com/pay/bill_1' }, success: true, error: null }))
    }) as unknown as typeof fetch
    const r = await abacatepay<{ id: string }>('abc_dev_k', 'POST', '/subscriptions/create', { items: [] }, ok)
    expect(r.id).toBe('bill_1')
    expect(calls[0][0]).toBe('https://api.abacatepay.com/v2/subscriptions/create')
    expect((calls[0][1].headers as Record<string, string>).Authorization).toBe('Bearer abc_dev_k')
    const fail = (async () => new Response(JSON.stringify({ data: null, success: false, error: 'Product prod_x not found' }), { status: 400 })) as unknown as typeof fetch
    await expect(abacatepay('k', 'POST', '/subscriptions/create', {}, fail)).rejects.toThrow('Product prod_x not found')
  })
})

describe('billing_apply_event (banco, PGlite)', () => {
  let db: Db
  let org: Awaited<ReturnType<typeof setupOrg>>
  const apply = async (ev: BillingEvent) =>
    (await db.admin.query<{ r: { status: string; error?: string } }>('select public.billing_apply_event($1::jsonb) as r', [JSON.stringify(ev)]))[0].r
  const sub = async () =>
    (await db.admin.query<{ status: string; plan: string; provider_subscription_id: string | null; current_period_end: Date | null; eff: string }>(
      `select s.*, public.subscription_effective_status(s.organization_id)::text as eff from public.subscriptions s where organization_id = $1`, [org.orgId]))[0]

  beforeAll(async () => {
    db = await createDb()
    org = await setupOrg(db, 'assinante@loja.com', 'Loja Assinante')
    await db.admin.query(`insert into public.billing_checkouts (organization_id, plan, provider, provider_checkout_id, amount_cents, dev_mode) values ($1, 'premium', 'abacatepay', 'bill_1', 27990, true)`, [org.orgId])
  })

  it('usuário comum não executa a função nem grava checkouts', async () => {
    await expect(org.user.query(`select public.billing_apply_event('{}'::jsonb)`)).rejects.toThrow(/permission denied/)
    await expect(org.user.query(`insert into public.billing_checkouts (organization_id, plan, provider, amount_cents) values ($1, 'premium', 'x', 0)`, [org.orgId])).rejects.toThrow(/permission denied/)
    expect(await org.user.query('select id from public.billing_checkouts')).toHaveLength(1) // owner lê os seus
  })

  it('evento de outro ambiente (produção x teste) não libera o plano', async () => {
    const r = await apply(parseAbacateEvent(subEvent('subscription.completed', { id: 'log_prod', dev: false })))
    expect(r).toMatchObject({ status: 'error', error: 'ENVIRONMENT_MISMATCH' })
    expect((await sub()).status).toBe('trialing')
  })

  it('checkout desconhecido não altera nenhuma organização', async () => {
    const r = await apply(parseAbacateEvent(subEvent('subscription.completed', { id: 'log_unk', checkout: 'bill_desconhecido', sub: 'subs_x' })))
    expect(r).toMatchObject({ status: 'error', error: 'ORGANIZATION_NOT_IDENTIFIED' })
  })

  it('pagamento aprovado ativa o plano do checkout, registra o pagamento e é idempotente', async () => {
    const ev = parseAbacateEvent(subEvent('subscription.completed', { id: 'log_ok', payment: 'pay_1', amount: 27990 }))
    expect((await apply(ev)).status).toBe('applied')
    expect((await apply(ev)).status).toBe('duplicate')
    const s = await sub()
    expect(s).toMatchObject({ status: 'active', plan: 'premium', provider_subscription_id: 'subs_1', eff: 'active' })
    expect(new Date(s.current_period_end!).toISOString()).toBe('2026-12-10T12:00:05.000Z')
    const pays = await org.user.query<{ status: string; amount_cents: number }>('select status, amount_cents from public.payments')
    expect(pays).toEqual([{ status: 'paid', amount_cents: 27990 }])
    const [co] = await db.admin.query<{ status: string }>(`select status from public.billing_checkouts where provider_checkout_id = 'bill_1'`)
    expect(co.status).toBe('completed')
  })

  it('renovação estende o período a partir do fim atual', async () => {
    await apply(parseAbacateEvent(subEvent('subscription.renewed', { id: 'log_ren', payment: 'pay_2', amount: 27990 })))
    expect(new Date((await sub()).current_period_end!).toISOString()).toBe('2027-01-10T12:00:05.000Z')
  })

  it('falha de cobrança deixa atrasada; cancelamento mantém acesso até o fim do período', async () => {
    await apply(parseAbacateEvent(subEvent('subscription.payment_failed', { id: 'log_fail', payment: 'pay_3', status: 'FAILED' })))
    expect((await sub()).status).toBe('past_due')
    await apply(parseAbacateEvent(subEvent('subscription.cancelled', { id: 'log_cancel' })))
    const s = await sub()
    expect(s.status).toBe('canceled')
    expect(s.eff).toBe('active') // período pago ainda vigente
  })

  it('período vencido sem renovação: past_due após 3 dias e expired após 10', async () => {
    await db.admin.query(`update public.subscriptions set status = 'active', current_period_end = now() - interval '4 days' where organization_id = $1`, [org.orgId])
    expect((await sub()).eff).toBe('past_due')
    await db.admin.query(`update public.subscriptions set current_period_end = now() - interval '11 days' where organization_id = $1`, [org.orgId])
    expect((await sub()).eff).toBe('expired')
    const [w] = await db.admin.query<{ ok: boolean }>('select public.org_can_write($1) as ok', [org.orgId])
    expect(w.ok).toBe(false)
  })

  it('outro estabelecimento não vê checkouts, pagamentos nem eventos alheios', async () => {
    const other = await setupOrg(db, 'outra@loja.com', 'Outra Loja')
    expect(await other.user.query('select id from public.billing_checkouts')).toHaveLength(0)
    expect(await other.user.query('select id from public.payments')).toHaveLength(0)
    expect(await other.user.query('select id from public.payment_events')).toHaveLength(0)
  })
})
