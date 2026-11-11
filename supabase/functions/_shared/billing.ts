/**
 * Integração AbacatePay (API v2) — lógica independente de runtime
 * (Deno nas Edge Functions, Node nos testes). Usa apenas fetch e Web Crypto.
 *
 * Referências oficiais (conferidas em 10/11/2026):
 *   https://docs.abacatepay.com/pages/reference/introduction   (base, auth, envelope)
 *   https://docs.abacatepay.com/pages/products/create          (POST /products/create)
 *   https://docs.abacatepay.com/pages/client/create            (POST /customers/create)
 *   https://docs.abacatepay.com/pages/subscriptions/create     (POST /subscriptions/create)
 *   https://docs.abacatepay.com/pages/notificacoes/seguranca   (X-Webhook-Secret / X-Webhook-Signature)
 *   https://docs.abacatepay.com/pages/webhooks/events/subscriptions
 *
 * Nenhum pagamento é considerado confirmado sem um evento autenticado do provedor.
 */

export const PROVIDER = 'abacatepay'
export const ABACATEPAY_API = 'https://api.abacatepay.com/v2'

export type PlanTier = 'inicial' | 'profissional' | 'premium'
export type EventKind = 'paid' | 'failed' | 'canceled' | 'refunded' | 'ignored'

/** Evento normalizado, aplicado no banco por public.billing_apply_event(). */
export interface BillingEvent {
  provider: string
  event_id: string
  event_type: string
  kind: EventKind
  checkout_id: string | null
  subscription_id: string | null
  customer_id: string | null
  payment_id: string | null
  amount_cents: number | null
  paid_at: string | null
  dev_mode: boolean
  payload: unknown
}

const encoder = new TextEncoder()

/** Comparação em tempo constante para evitar timing attacks. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function toBase64(buf: ArrayBuffer): string {
  let s = ''
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b)
  return btoa(s)
}

export async function hmacSha256Base64(key: string, payload: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toBase64(await crypto.subtle.sign('HMAC', k, encoder.encode(payload)))
}

/**
 * Prova de ORIGEM: o segredo cadastrado no webhook chega no cabeçalho
 * X-Webhook-Secret (e também em ?webhookSecret=). Preferimos o cabeçalho.
 */
export function verifyWebhookSecret(expected: string, header: string | null, query: string | null): boolean {
  if (!expected) return false
  const provided = header ?? query
  return !!provided && safeEqual(provided, expected)
}

/**
 * Prova de INTEGRIDADE: X-Webhook-Signature = base64(HMAC-SHA256(corpo bruto, chave pública da AbacatePay)).
 * A chave é pública (igual para todas as contas), então sozinha NÃO autentica — sempre
 * combine com verifyWebhookSecret.
 */
export async function verifyWebhookSignature(publicKey: string, rawBody: string, header: string | null): Promise<boolean> {
  if (!publicKey || !header) return false
  return safeEqual(header.trim(), await hmacSha256Base64(publicKey, rawBody))
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {})
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)

const PAID_STATUSES = new Set(['PAID', 'APPROVED'])

/**
 * Converte o payload do webhook v2 em um BillingEvent.
 * Concessão de acesso vem SOMENTE dos eventos subscription.* — checkout.completed
 * também dispara a cada ciclo pago e é ignorado para não contar duas vezes
 * (recomendação da própria documentação).
 */
export function parseAbacateEvent(payload: unknown): BillingEvent {
  const p = obj(payload)
  const eventId = str(p.id)
  if (!eventId) throw new Error('EVENT_ID_MISSING')
  const type = String(p.event ?? '')
  const data = obj(p.data)
  const subscription = obj(data.subscription)
  const checkout = obj(data.checkout)
  const payment = obj(data.payment)
  const customer = obj(data.customer)

  let kind: EventKind = 'ignored'
  switch (type) {
    case 'subscription.completed':
    case 'subscription.renewed':
      kind = PAID_STATUSES.has(String(payment.status ?? '')) ? 'paid' : 'ignored'
      break
    case 'subscription.payment_failed':
      kind = 'failed'
      break
    case 'subscription.cancelled':
      kind = 'canceled'
      break
    case 'checkout.refunded':
      kind = str(checkout.frequency) === 'SUBSCRIPTION' ? 'refunded' : 'ignored'
      break
  }

  return {
    provider: PROVIDER,
    event_id: eventId,
    event_type: type,
    kind,
    checkout_id: str(checkout.id),
    subscription_id: str(subscription.id),
    customer_id: str(customer.id) ?? str(checkout.customerId),
    payment_id: str(payment.id) ?? (kind === 'refunded' ? str(checkout.id) : null),
    amount_cents: num(payment.paidAmount) ?? num(payment.amount) ?? num(subscription.amount),
    paid_at: kind === 'paid' ? (str(payment.updatedAt) ?? str(payment.createdAt)) : null,
    dev_mode: p.devMode === true,
    payload,
  }
}

/** Ambiente da chave: abc_dev_... (modo teste) ou abc_prod_... */
export function keyEnvironment(apiKey: string): 'dev' | 'prod' {
  return apiKey.startsWith('abc_dev_') ? 'dev' : 'prod'
}

export class AbacatePayError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** Chamada à API v2. Envelope: { data, success, error }. */
export async function abacatepay<T = Obj>(
  apiKey: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const res = await fetchImpl(`${ABACATEPAY_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let env: { data?: T; success?: boolean; error?: string | null } = {}
  try {
    env = await res.json()
  } catch {
    /* corpo não-JSON */
  }
  if (!res.ok || env.success === false || env.data == null) {
    throw new AbacatePayError(env.error ?? `HTTP ${res.status}`, res.status)
  }
  return env.data
}
