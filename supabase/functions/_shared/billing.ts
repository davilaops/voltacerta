/**
 * Lógica de cobrança independente de runtime (Deno nas Edge Functions,
 * Node nos testes). Usa apenas Web Crypto.
 *
 * IMPORTANTE: o formato do payload do provedor (AbacatePay) deve ser
 * conferido com a documentação oficial antes de entrar em produção.
 * Este módulo trabalha com um formato canônico e um adaptador explícito;
 * nenhum pagamento é considerado confirmado sem evento assinado do provedor.
 */

export type PlanTier = 'inicial' | 'profissional' | 'premium'
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'

export interface CanonicalBillingEvent {
  eventId: string
  type: 'payment_confirmed' | 'payment_failed' | 'subscription_canceled' | 'subscription_expired' | 'unknown'
  rawType: string
  organizationId: string | null
  plan: PlanTier | null
  periodEnd: string | null
  providerCustomerId: string | null
  providerSubscriptionId: string | null
}

const encoder = new TextEncoder()

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Comparação em tempo constante para evitar timing attacks. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)))
}

/** Valida assinatura HMAC-SHA256 (hex, opcionalmente prefixada por "sha256="). */
export async function verifySignature(secret: string, rawBody: string, header: string | null): Promise<boolean> {
  if (!secret || !header) return false
  const provided = header.trim().replace(/^sha256=/i, '').toLowerCase()
  const expected = await hmacSha256Hex(secret, rawBody)
  return safeEqual(provided, expected)
}

const PLANS: PlanTier[] = ['inicial', 'profissional', 'premium']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Adaptador do payload do provedor -> evento canônico.
 * Espera metadados `organization_id` e `plan` enviados na criação da cobrança.
 * Os nomes de eventos em EVENT_TYPE_MAP DEVEM ser confirmados na documentação do provedor.
 */
export const EVENT_TYPE_MAP: Record<string, CanonicalBillingEvent['type']> = {
  'billing.paid': 'payment_confirmed',
  'subscription.paid': 'payment_confirmed',
  'billing.failed': 'payment_failed',
  'subscription.canceled': 'subscription_canceled',
  'subscription.expired': 'subscription_expired',
}

export function parseProviderEvent(payload: unknown): CanonicalBillingEvent {
  const p = (payload ?? {}) as Record<string, unknown>
  const data = (p.data ?? {}) as Record<string, unknown>
  const meta = (data.metadata ?? p.metadata ?? {}) as Record<string, unknown>
  const rawType = String(p.event ?? p.type ?? '')
  const eventId = p.id == null ? '' : String(p.id)
  if (!eventId) throw new Error('EVENT_ID_MISSING')

  const plan = typeof meta.plan === 'string' && PLANS.includes(meta.plan as PlanTier) ? (meta.plan as PlanTier) : null
  const orgId = typeof meta.organization_id === 'string' && UUID_RE.test(meta.organization_id) ? meta.organization_id : null
  return {
    eventId,
    rawType,
    type: EVENT_TYPE_MAP[rawType] ?? 'unknown',
    organizationId: orgId,
    plan,
    periodEnd: typeof data.period_end === 'string' ? data.period_end : null,
    providerCustomerId: typeof data.customer_id === 'string' ? data.customer_id : null,
    providerSubscriptionId: typeof data.subscription_id === 'string' ? data.subscription_id : null,
  }
}

export type SubscriptionUpdate = {
  status: SubscriptionStatus
  plan?: PlanTier
  current_period_end?: string
  canceled_at?: string
}

/** Calcula a alteração de assinatura decorrente de um evento confirmado. */
export function subscriptionUpdateFor(ev: CanonicalBillingEvent, now = new Date()): SubscriptionUpdate | null {
  switch (ev.type) {
    case 'payment_confirmed': {
      const end = ev.periodEnd ?? new Date(now.getTime() + 31 * 86400000).toISOString()
      return { status: 'active', current_period_end: end, ...(ev.plan ? { plan: ev.plan } : {}) }
    }
    case 'payment_failed':
      return { status: 'past_due' }
    case 'subscription_canceled':
      return { status: 'canceled', canceled_at: now.toISOString() }
    case 'subscription_expired':
      return { status: 'expired' }
    default:
      return null
  }
}
