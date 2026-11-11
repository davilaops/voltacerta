// Edge Function: inicia a assinatura de um plano na AbacatePay (API v2).
// - Exige usuário autenticado e papel owner na organização (validado pela RLS, nunca pelo cliente).
// - Preço vem de public.plans (nunca do navegador).
// - Cria/reaproveita o produto mensal do plano, o cliente e a assinatura; grava o vínculo
//   checkout -> organização em billing_checkouts ANTES de devolver a URL de pagamento.
// - Não marca nada como pago: só o webhook autenticado ativa a assinatura.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { AbacatePayError, PROVIDER, abacatepay, keyEnvironment } from '../_shared/billing.ts'

// APP_URL aceita uma ou mais origens separadas por vírgula, ex.:
//   "https://voltacerta.vercel.app,http://localhost:5173"
// A primeira é a padrão; o retorno do checkout volta para a origem que fez a chamada, se permitida.
const APP_ORIGINS = (Deno.env.get('APP_URL') ?? '')
  .split(',')
  .map((u) => u.trim().replace(/\/$/, ''))
  .filter((u) => /^https?:\/\/[^/]+$/.test(u))
const PLANS = ['inicial', 'profissional', 'premium']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  const origin = (req.headers.get('Origin') ?? '').replace(/\/$/, '')
  const APP_URL = APP_ORIGINS.includes(origin) ? origin : (APP_ORIGINS[0] ?? '')
  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': APP_URL || '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user?.email) return json({ error: 'NOT_AUTHENTICATED' }, 401)

  let body: { organization_id?: string; plan?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'INVALID_JSON' }, 400)
  }
  const orgId = body.organization_id ?? ''
  const plan = body.plan ?? ''
  if (!UUID_RE.test(orgId) || !PLANS.includes(plan)) return json({ error: 'INVALID_INPUT' }, 400)

  // Autorização com o JWT do usuário: RLS só devolve o vínculo se ele for membro.
  const { data: member } = await userClient
    .from('organization_members').select('role')
    .eq('organization_id', orgId).eq('user_id', user.id).maybeSingle()
  if (member?.role !== 'owner') return json({ error: 'FORBIDDEN' }, 403)

  const apiKey = Deno.env.get('ABACATEPAY_API_KEY') ?? ''
  if (!apiKey || !APP_URL) return json({ error: 'BILLING_NOT_CONFIGURED' }, 503)
  const env = keyEnvironment(apiKey)
  const devMode = env === 'dev'

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  const [{ data: org }, { data: sub }, { data: planRow }, { data: profile }] = await Promise.all([
    admin.from('organizations').select('name, suspended_at').eq('id', orgId).single(),
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

  try {
    // 1. Produto mensal do plano (cache por ambiente; recriado se o preço mudar)
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

    // 2. Cliente (a AbacatePay devolve o existente se o e-mail já estiver cadastrado)
    let customerId: string | null = null
    try {
      const customer = await abacatepay<{ id: string }>(apiKey, 'POST', '/customers/create', {
        email: user.email,
        ...(profile?.full_name ? { name: profile.full_name } : {}),
        metadata: { organization_id: orgId },
      })
      customerId = customer.id
    } catch (e) {
      console.warn('customer create failed; checkout will collect data', (e as Error).message)
    }

    // 3. Registro local antes da cobrança (externalId = nosso id)
    const { data: row, error: rowErr } = await admin.from('billing_checkouts')
      .insert({ organization_id: orgId, plan, provider: PROVIDER, provider_customer_id: customerId, amount_cents: planRow.price_cents, dev_mode: devMode, created_by: user.id })
      .select('id').single()
    if (rowErr || !row) return json({ error: 'STORE_FAILED' }, 500)

    // 4. Assinatura (checkout hospedado)
    const methods = (Deno.env.get('BILLING_METHODS') ?? 'CARD').split(',').map((m) => m.trim().toUpperCase()).filter((m) => m === 'CARD' || m === 'PIX')
    let billing: { id: string; url: string }
    try {
      billing = await abacatepay<{ id: string; url: string }>(apiKey, 'POST', '/subscriptions/create', {
        items: [{ id: productId, quantity: 1 }],
        methods: methods.length ? methods : ['CARD'],
        externalId: row.id,
        metadata: { organization_id: orgId, plan, checkout_ref: row.id },
        returnUrl: `${APP_URL}/app/plano`,
        completionUrl: `${APP_URL}/app/plano?pagamento=concluido`,
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
})

