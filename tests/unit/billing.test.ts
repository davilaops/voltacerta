import { beforeAll, describe, expect, it } from 'vitest'
import { hmacSha256Hex, parseProviderEvent, safeEqual, subscriptionUpdateFor, verifySignature } from '../../supabase/functions/_shared/billing'
import { createDb, setupOrg, type Db } from '../db/harness'

const SECRET = 'whsec_test_123'
const ORG = '7f1d1a8e-2c34-4c55-9a8b-0d9e1f2a3b4c'

describe('verificação de assinatura do webhook', () => {
  it('aceita assinatura válida (hex e com prefixo sha256=)', async () => {
    const body = JSON.stringify({ id: 'evt_1', event: 'billing.paid' })
    const sig = await hmacSha256Hex(SECRET, body)
    expect(await verifySignature(SECRET, body, sig)).toBe(true)
    expect(await verifySignature(SECRET, body, `sha256=${sig.toUpperCase()}`)).toBe(true)
  })
  it('rejeita assinatura inválida, ausente ou corpo alterado', async () => {
    const body = JSON.stringify({ id: 'evt_1' })
    const sig = await hmacSha256Hex(SECRET, body)
    expect(await verifySignature(SECRET, body + ' ', sig)).toBe(false)
    expect(await verifySignature('outro', body, sig)).toBe(false)
    expect(await verifySignature(SECRET, body, null)).toBe(false)
    expect(await verifySignature('', body, sig)).toBe(false)
  })
  it('comparação em tempo constante', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })
})

describe('mapeamento de eventos', () => {
  it('pagamento confirmado ativa a assinatura com o plano dos metadados', () => {
    const ev = parseProviderEvent({ id: 'evt_2', event: 'billing.paid', data: { metadata: { organization_id: ORG, plan: 'premium' }, period_end: '2026-12-10T00:00:00Z' } })
    expect(ev.type).toBe('payment_confirmed')
    expect(ev.organizationId).toBe(ORG)
    expect(subscriptionUpdateFor(ev)).toEqual({ status: 'active', plan: 'premium', current_period_end: '2026-12-10T00:00:00Z' })
  })
  it('falha de pagamento marca como atrasada; eventos desconhecidos não alteram nada', () => {
    expect(subscriptionUpdateFor(parseProviderEvent({ id: 'e3', event: 'billing.failed' }))).toEqual({ status: 'past_due' })
    expect(subscriptionUpdateFor(parseProviderEvent({ id: 'e4', event: 'algo.novo' }))).toBeNull()
  })
  it('ignora metadados inválidos e exige id do evento', () => {
    const ev = parseProviderEvent({ id: 'e5', event: 'billing.paid', data: { metadata: { organization_id: 'x; drop table', plan: 'gratis' } } })
    expect(ev.organizationId).toBeNull()
    expect(ev.plan).toBeNull()
    expect(() => parseProviderEvent({ event: 'billing.paid' })).toThrow('EVENT_ID_MISSING')
  })
})

describe('idempotência e acesso aos eventos de pagamento (banco)', () => {
  let db: Db
  beforeAll(async () => {
    db = await createDb()
  })
  it('o mesmo evento não é registrado duas vezes', async () => {
    const insert = `insert into public.payment_events (provider, event_id, event_type, payload) values ('abacatepay', 'evt_dup', 'billing.paid', '{}')
                    on conflict (provider, event_id) do nothing returning id`
    expect(await db.admin.query(insert)).toHaveLength(1)
    expect(await db.admin.query(insert)).toHaveLength(0)
  })
  it('usuários autenticados não leem nem gravam eventos de pagamento', async () => {
    const { user } = await setupOrg(db, 'billing@teste.com')
    expect(await user.query('select * from public.payment_events')).toHaveLength(0)
    await expect(user.query(`insert into public.payment_events (provider, event_id, event_type, payload) values ('x', 'y', 'z', '{}')`)).rejects.toThrow(/row-level security/)
  })
})
