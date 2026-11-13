/**
 * Integração Asaas (API v3) — lógica independente de runtime
 * (Deno nas Edge Functions, Node nos testes). Usa apenas fetch.
 *
 * Referências oficiais (conferidas em 12/11/2026):
 *   https://docs.asaas.com/docs/chaves-de-api                    (bases sandbox/produção, header access_token)
 *   https://docs.asaas.com/reference/criar-novo-cliente          (POST /customers — name e cpfCnpj obrigatórios)
 *   https://docs.asaas.com/reference/criar-nova-assinatura       (POST /subscriptions)
 *   https://docs.asaas.com/reference/listar-cobrancas-de-uma-assinatura (GET /subscriptions/{id}/payments → invoiceUrl)
 *   https://docs.asaas.com/reference/remover-assinatura          (DELETE /subscriptions/{id})
 *   https://docs.asaas.com/docs/webhook-para-cobrancas           (PAYMENT_*; header asaas-access-token)
 *   https://docs.asaas.com/docs/eventos-para-assinaturas         (SUBSCRIPTION_*)
 *
 * Fluxo: cliente → assinatura mensal (externalReference = nosso billing_checkouts.id) →
 * fatura da 1ª cobrança (invoiceUrl), onde a pessoa paga com Pix, cartão ou boleto.
 * Nenhum pagamento é considerado confirmado sem um evento autenticado do Asaas.
 */
import type { BillingEvent, EventKind } from './billing.ts'
import { safeEqual } from './billing.ts'

export const ASAAS_PROVIDER = 'asaas'
export const ASAAS_API = { dev: 'https://api-sandbox.asaas.com/v3', prod: 'https://api.asaas.com/v3' } as const

/**
 * Ambiente da chave. Chaves do sandbox (homologação) contêm "_hmlg_" e as de produção "_prod_".
 * ASAAS_ENV=sandbox|production força o ambiente (útil para chaves antigas sem o marcador).
 */
export function asaasEnvironment(apiKey: string, override?: string | null): 'dev' | 'prod' {
  const o = (override ?? '').trim().toLowerCase()
  if (o === 'sandbox' || o === 'dev') return 'dev'
  if (o === 'production' || o === 'prod') return 'prod'
  return apiKey.includes('_hmlg_') ? 'dev' : 'prod'
}

export class AsaasError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null = null) {
    super(message)
  }
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {})
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

/** Chamada à API v3. Erros vêm como { errors: [{ code, description }] }. */
export async function asaas<T = Obj>(
  apiKey: string,
  env: 'dev' | 'prod',
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const res = await fetchImpl(`${ASAAS_API[env]}${path}`, {
    method,
    headers: {
      access_token: apiKey,
      'Content-Type': 'application/json',
      'User-Agent': 'VoltaCerta/1.0',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* corpo vazio ou não-JSON */
  }
  if (!res.ok) {
    const first = obj((obj(data).errors as unknown[] | undefined)?.[0])
    throw new AsaasError(str(first.description) ?? `HTTP ${res.status}`, res.status, str(first.code))
  }
  return (data ?? {}) as T
}

/** CPF (11) ou CNPJ (14) com dígitos verificadores válidos. Devolve só os dígitos, ou null. */
export function normalizeDocument(input: string | null | undefined): string | null {
  const d = (input ?? '').replace(/\D/g, '')
  if (d.length === 11) {
    if (/^(\d)\1{10}$/.test(d)) return null
    const calc = (n: number) => {
      let s = 0
      for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i)
      const r = (s * 10) % 11
      return r === 10 ? 0 : r
    }
    return calc(9) === Number(d[9]) && calc(10) === Number(d[10]) ? d : null
  }
  if (d.length === 14) {
    if (/^(\d)\1{13}$/.test(d)) return null
    const calc = (n: number) => {
      const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      const s = w.reduce((acc, wi, i) => acc + Number(d[i]) * wi, 0)
      const r = s % 11
      return r < 2 ? 0 : 11 - r
    }
    return calc(12) === Number(d[12]) && calc(13) === Number(d[13]) ? d : null
  }
  return null
}

/** Autenticação do webhook: header asaas-access-token = token cadastrado no webhook. */
export function verifyAsaasToken(expected: string, header: string | null): boolean {
  return !!expected && !!header && safeEqual(header, expected)
}

/** "2026-11-12 18:07:47" (horário de Brasília, formato do Asaas) → ISO com fuso. */
export function asaasDateTime(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return `${s.replace(' ', 'T')}-03:00`
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T12:00:00-03:00`
  return s
}

const PAID = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'])
const FAILED = new Set(['PAYMENT_OVERDUE', 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED', 'PAYMENT_REPROVED_BY_RISK_ANALYSIS'])
const CANCELED = new Set(['SUBSCRIPTION_DELETED', 'SUBSCRIPTION_INACTIVATED'])

/**
 * Converte o webhook do Asaas em BillingEvent.
 * - Só cobranças de ASSINATURA (payment.subscription) contam; avulsas são ignoradas.
 * - checkout_id = id da assinatura (é o que gravamos em billing_checkouts.provider_checkout_id).
 * - Cartão gera PAYMENT_CONFIRMED e, semanas depois, PAYMENT_RECEIVED do MESMO pagamento:
 *   o banco ignora o segundo (billing_apply_event não estende o período duas vezes).
 * - O Asaas não informa o ambiente no evento: usamos o ambiente da chave configurada
 *   e gravamos devMode no payload (usado para separar receita de teste).
 */
export function parseAsaasEvent(payload: unknown, devMode: boolean): BillingEvent {
  const p = obj(payload)
  const eventId = str(p.id)
  if (!eventId) throw new Error('EVENT_ID_MISSING')
  const type = String(p.event ?? '')
  const payment = obj(p.payment)
  const subscription = obj(p.subscription)

  let kind: EventKind = 'ignored'
  let subId: string | null = null
  if (type.startsWith('PAYMENT_')) {
    subId = str(payment.subscription)
    if (subId) {
      if (PAID.has(type)) kind = 'paid'
      else if (FAILED.has(type)) kind = 'failed'
      else if (type === 'PAYMENT_REFUNDED') kind = 'refunded'
    }
  } else if (CANCELED.has(type)) {
    subId = str(subscription.id)
    if (subId) kind = 'canceled'
  }

  const value = typeof payment.value === 'number' && Number.isFinite(payment.value) ? Math.round(payment.value * 100) : null
  return {
    provider: ASAAS_PROVIDER,
    event_id: eventId,
    event_type: type,
    kind,
    checkout_id: subId,
    subscription_id: subId,
    customer_id: str(payment.customer) ?? str(subscription.customer),
    payment_id: str(payment.id),
    amount_cents: value,
    paid_at: kind === 'paid'
      ? (asaasDateTime(p.dateCreated) ?? asaasDateTime(payment.confirmedDate) ?? asaasDateTime(payment.paymentDate))
      : null,
    dev_mode: devMode,
    payload: { ...p, devMode },
  }
}

/** Data de hoje em Brasília (YYYY-MM-DD), usada no vencimento da 1ª cobrança. */
export function todayInBrazil(now = new Date()): string {
  return new Date(now.getTime() - 3 * 3600_000).toISOString().slice(0, 10)
}
