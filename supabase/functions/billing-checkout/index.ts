// Edge Function: inicia a assinatura de um plano.
// Gateway: Asaas quando ASAAS_API_KEY estiver configurada; senão AbacatePay (legado).
// - Exige usuário autenticado e papel owner na organização (validado pela RLS, nunca pelo cliente).
// - Preço vem de public.plans (nunca do navegador).
// - Grava o vínculo cobrança -> organização em billing_checkouts ANTES de devolver a URL de pagamento.
// - Não marca nada como pago: só o webhook autenticado ativa a assinatura.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { AbacatePayError, PROVIDER, abacatepay, keyEnvironment } from '../_shared/billing.ts'
import { ASAAS_PROVIDER, AsaasError, asaas, asaasEnvironment, normalizeDocument, todayInBrazil } from '../_shared/asaas.ts'

// APP_URL aceita uma ou mais origens separadas por vírgula, ex.:
//   "https://voltacerta.vercel.app,http://localhost:5173"
// A primeira é a padrão; o retorno do checkout volta para a origem que fez a chamada, se permitida.
const APP_ORIGINS = (Deno.env.get('APP_URL') ?? '')
  .split(',')
  .map((u) => u.trim().replace(/\/$/, ''))
  .filter((u) => /^https?:\/\/[^/]+$/.test(u))
const PLANS = ['inicial', 'profissional', 'premium']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type PlanRow = { id: string; name: string; price_cents: number; active: boolean; provider_products: unknown }
type Ctx = {
  admin: SupabaseClient
  orgId: string
  orgName: string
  ownerName: string | null
  plan: string
  planRow: PlanRow
  userId: string
  email: string
  fullName: string | null
  document: string | null
  appUrl: string
}
type Json = (body: unknown, status?: number) => Response

Deno.serve(async (req) => {
  const origin = (req.headers.get('Origin') ?? '').replace(/\/$/, '')
  const APP_URL = APP_ORIGINS.includes(origin) ? origin : (APP_ORIGINS[0] ?? '')
  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': APP_URL || '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
  const json: Json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user?.email) return json({ error: 'NOT_AUTHENTICATED' }, 401)

  let body: { organization_id?: string; plan?: string; document?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'INVALID_JSON' }, 400)
  }
  const orgId = body.organization_id ?? ''
  const plan = body.plan ?? ''
  if (!UUID_RE.test(orgId) || !PLANS.includes(plan)) return json({ error: 'INVALID_INPUT' }, 400)
  let document: string | null = null
  if (body.document) {
    document = normalizeDocument(body.document)
    if (!document) return json({ error: 'INVALID_DOCUMENT' }, 400)
  }

  // Autorização com o JWT do usuário: RLS só devolve o vínculo se ele for membro.
  const { data: member } = await userClient
    .from('organization_members').select('role')
    .eq('organization_id', orgId).eq('user_id', user.id).maybeSingle()
  if (member?.role !== 'owner') return json({ error: 'FORBIDDEN' }, 403)
  if (!APP_URL) return json({ error: 'BILLING_NOT_CONFIGURED' }, 503)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  const [{ data: org }, { data: sub }, { data: planRow }, { data: profile }] = await Promise.all([
    admin.from('organizations').select('name, owner_name, suspended_at').eq('id', orgId).single(),
    admin.from('subscriptions').select('status, plan, provider_subscription_id, current_period_end').eq('organization_id', orgId).maybeSingle(),
    admin.from('plans').select('id, name, price_cents, active, provider_products').eq('id', plan).single(),
    admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
  ])
  if (!org || org.suspended_at) return json({ error: 'ORG_SUSPENDED' }, 403)
  if (!planRow || planRow.active === false) return json({ error: 'INVALID_INPUT' }, 400)

  // Assinatura paga em vigor: trocar de plano exige cancelar a atual (evita cobrança dupla).
  const paidActive = sub?.status === 'active' && sub.provider_subscription_id &&
    sub.current_period_end && new Date(sub.current_period_end) > new Date()
  if (paidActive) return json({ error: sub.plan === plan ? 'ALREADY_SUBSCRIBED' : 'PLAN_CHANGE_REQUIRES_SUPPORT' }, 409)

  const ctx: Ctx = {
    admin, orgId, orgName: org.name, ownerName: org.owner_name, plan, planRow: planRow as PlanRow,
    userId: user.id, email: user.email, fullName: profile?.full_name ?? null, document, appUrl: APP_URL,
  }
  if (Deno.env.get('ASAAS_API_KEY')) return asaasCheckout(ctx, json)
  if (Deno.env.get('ABACATEPAY_API_KEY')) return abacateCheckout(ctx, json)
  return json({ error: 'BILLING_NOT_CONFIGURED' }, 503)
})

// ---------------------------------------------------------------------------
// Asaas: cliente → assinatura mensal → fatura da 1ª cobrança
// ---------------------------------------------------------------------------
async function asaasCheckout(c: Ctx, json: Json): Promise<Response> {
  const apiKey = Deno.env.get('ASAAS_API_KEY')!
  const env = asaasEnvironment(apiKey, Deno.env.get('ASAAS_ENV'))
  const devMode = env === 'dev'
  const api = <T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) => asaas<T>(apiKey, env, method, path, body)

  try {
    // 1. Cobranças anteriores ainda pendentes deste estabelecimento (mesmo ambiente)
    const { data: pendings } = await c.admin.from('billing_checkouts')
      .select('id, plan, provider_checkout_id, url, created_at')
      .eq('organization_id', c.orgId).eq('provider', ASAAS_PROVIDER).eq('dev_mode', devMode).eq('status', 'pending')
      .order('created_at', { ascending: false })
    for (const p of pendings ?? []) {
      if (!p.provider_checkout_id) {
        await c.admin.from('billing_checkouts').update({ status: 'failed' }).eq('id', p.id)
        continue
      }
      const list = await api<{ data?: { status?: string }[] }>('GET', `/subscriptions/${p.provider_checkout_id}/payments`)
      const statuses = (list.data ?? []).map((x) => x.status)
      if (statuses.some((s) => s === 'CONFIRMED' || s === 'RECEIVED')) {
        // Já pago; a confirmação (webhook) está a caminho. Não cria outra cobrança.
        return json({ error: 'PAYMENT_PROCESSING' }, 409)
      }
      const fresh = Date.now() - new Date(p.created_at).getTime() < 3 * 86400_000
      if (p.plan === c.plan && fresh && p.url && statuses.includes('PENDING')) {
        return json({ url: p.url }) // reaproveita a mesma fatura (evita assinaturas duplicadas)
      }
      // Abandonada ou de outro plano: remove no Asaas para não gerar cobranças futuras.
      try {
        await api('DELETE', `/subscriptions/${p.provider_checkout_id}`)
      } catch (e) {
        if (!(e instanceof AsaasError && e.status === 404)) throw e
      }
      await c.admin.from('billing_checkouts').update({ status: 'failed' }).eq('id', p.id)
    }

    // 2. Cliente: reaproveita o já criado para este estabelecimento; senão exige CPF/CNPJ
    const { data: prev } = await c.admin.from('billing_checkouts')
      .select('provider_customer_id')
      .eq('organization_id', c.orgId).eq('provider', ASAAS_PROVIDER).eq('dev_mode', devMode)
      .not('provider_customer_id', 'is', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    let customerId: string | null = c.document ? null : (prev?.provider_customer_id ?? null)
    if (!customerId) {
      if (!c.document) return json({ error: 'DOCUMENT_REQUIRED' }, 422)
      const name = c.document.length === 14 ? c.orgName : (c.ownerName || c.fullName || c.orgName)
      const customer = await api<{ id: string }>('POST', '/customers', {
        name,
        cpfCnpj: c.document,
        email: c.email,
        externalReference: c.orgId,
        ...(c.document.length === 14 ? { company: c.orgName } : {}),
      })
      customerId = customer.id
    }

    // 3. Registro local antes da cobrança (externalReference = nosso id)
    const { data: row, error: rowErr } = await c.admin.from('billing_checkouts')
      .insert({ organization_id: c.orgId, plan: c.plan, provider: ASAAS_PROVIDER, provider_customer_id: customerId, amount_cents: c.planRow.price_cents, dev_mode: devMode, created_by: c.userId })
      .select('id').single()
    if (rowErr || !row) return json({ error: 'STORE_FAILED' }, 500)

    // 4. Assinatura mensal; 1ª cobrança vence hoje
    const billingType = (Deno.env.get('ASAAS_BILLING_TYPE') ?? 'UNDEFINED').trim().toUpperCase()
    const subBody = {
      customer: customerId,
      billingType: ['UNDEFINED', 'PIX', 'CREDIT_CARD', 'BOLETO'].includes(billingType) ? billingType : 'UNDEFINED',
      value: c.planRow.price_cents / 100,
      nextDueDate: todayInBrazil(),
      cycle: 'MONTHLY',
      description: `VoltaCerta — plano ${c.planRow.name} (mensal)`,
      externalReference: row.id,
    }
    let subscription: { id: string }
    try {
      try {
        subscription = await api<{ id: string }>('POST', '/subscriptions', {
          ...subBody,
          callback: { successUrl: `${c.appUrl}/app/plano?pagamento=concluido`, autoRedirect: true },
        })
      } catch (e) {
        // O Asaas só aceita retorno para o domínio cadastrado na conta; sem ele, segue sem redirecionamento.
        if (!(e instanceof AsaasError && e.status === 400 && /url|dom[ií]nio|callback/i.test(e.message))) throw e
        console.warn('asaas callback rejected; creating subscription without redirect', e.message)
        subscription = await api<{ id: string }>('POST', '/subscriptions', subBody)
      }
    } catch (e) {
      await c.admin.from('billing_checkouts').update({ status: 'failed' }).eq('id', row.id)
      throw e
    }

    // 5. Fatura da primeira cobrança
    const list = await api<{ data?: { invoiceUrl?: string }[] }>('GET', `/subscriptions/${subscription.id}/payments`)
    const url = list.data?.[0]?.invoiceUrl
    await c.admin.from('billing_checkouts')
      .update({ provider_checkout_id: subscription.id, url: url ?? null, ...(url ? {} : { status: 'failed' }) })
      .eq('id', row.id)
    if (!url) {
      console.error('asaas: subscription without first payment', subscription.id)
      return json({ error: 'BILLING_PROVIDER_ERROR' }, 502)
    }
    return json({ url })
  } catch (e) {
    const msg = e instanceof AsaasError ? `${e.status} ${e.code ?? ''} ${e.message}` : String(e)
    console.error('asaas checkout failed', msg)
    if (e instanceof AsaasError && e.status === 400 && /cpf|cnpj/i.test(e.message)) return json({ error: 'INVALID_DOCUMENT' }, 400)
    return json({ error: 'BILLING_PROVIDER_ERROR' }, 502)
  }
}

// ---------------------------------------------------------------------------
// AbacatePay (legado): produto → cliente → assinatura com checkout hospedado
// ---------------------------------------------------------------------------
async function abacateCheckout(c: Ctx, json: Json): Promise<Response> {
  const apiKey = Deno.env.get('ABACATEPAY_API_KEY')!
  const env = keyEnvironment(apiKey)
  const devMode = env === 'dev'
  const { admin, plan, planRow } = c
  try {
    const products = (planRow.provider_products ?? {}) as Record<string, { id: string; price: number }>
    let productId = products[env]?.price === planRow.price_cents ? products[env].id : null
    if (!productId) {
      const product = await abacatepay<{ id: string }>(apiKey, 'POST', '/products/create', {
        externalId: `voltacerta-${plan}-${planRow.price_cents}-${Date.now()}`,
        name: `VoltaCerta ${planRow.name}`,
        description: `Assinatura mensal do plano ${planRow.name}`,
        price: planRow.price_cents,
        currency: 'BRL',
        cycle: 'MONTHLY',
      })
      productId = product.id
      await admin.from('plans')
        .update({ provider_products: { ...products, [env]: { id: productId, price: planRow.price_cents } } })
        .eq('id', plan)
    }

    let customerId: string | null = null
    try {
      const customer = await abacatepay<{ id: string }>(apiKey, 'POST', '/customers/create', {
        email: c.email,
        ...(c.fullName ? { name: c.fullName } : {}),
        metadata: { organization_id: c.orgId },
      })
      customerId = customer.id
    } catch (e) {
      console.warn('customer create failed; checkout will collect data', (e as Error).message)
    }

    const { data: row, error: rowErr } = await admin.from('billing_checkouts')
      .insert({ organization_id: c.orgId, plan, provider: PROVIDER, provider_customer_id: customerId, amount_cents: planRow.price_cents, dev_mode: devMode, created_by: c.userId })
      .select('id').single()
    if (rowErr || !row) return json({ error: 'STORE_FAILED' }, 500)

    const methods = (Deno.env.get('BILLING_METHODS') ?? 'CARD').split(',').map((m) => m.trim().toUpperCase()).filter((m) => m === 'CARD' || m === 'PIX')
    let billing: { id: string; url: string }
    try {
      billing = await abacatepay<{ id: string; url: string }>(apiKey, 'POST', '/subscriptions/create', {
        items: [{ id: productId, quantity: 1 }],
        methods: methods.length ? methods : ['CARD'],
        externalId: row.id,
        metadata: { organization_id: c.orgId, plan, checkout_ref: row.id },
        returnUrl: `${c.appUrl}/app/plano`,
        completionUrl: `${c.appUrl}/app/plano?pagamento=concluido`,
        ...(customerId ? { customerId } : {}),
      })
    } catch (e) {
      await admin.from('billing_checkouts').update({ status: 'failed' }).eq('id', row.id)
      throw e
    }
    await admin.from('billing_checkouts').update({ provider_checkout_id: billing.id, url: billing.url }).eq('id', row.id)
    return json({ url: billing.url })
  } catch (e) {
    const msg = e instanceof AbacatePayError ? `${e.status} ${e.message}` : String(e)
    console.error('abacatepay checkout failed', msg)
    return json({ error: 'BILLING_PROVIDER_ERROR' }, 502)
  }
}
