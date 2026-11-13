// Edge Function: Super Admin encerra a assinatura de um estabelecimento (Asaas ou AbacatePay).
// 1. Valida o JWT e exige Super Admin (is_super_admin() no banco).
// 2. Se houver assinatura na AbacatePay no MESMO ambiente da chave atual, cancela lá
//    (POST /v2/subscriptions/cancel { id } — cancelamento imediato, sem novas cobranças;
//    exige a permissão SUBSCRIPTION:DELETE na chave).
// 3. Encerra no banco via admin_cancel_subscription (com o JWT do admin => auditoria com autor).
// Se o cancelamento no gateway falhar, NADA muda no banco (o admin vê o erro e tenta de novo).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { AbacatePayError, PROVIDER, abacatepay, keyEnvironment } from '../_shared/billing.ts'
import { ASAAS_PROVIDER, AsaasError, asaas, asaasEnvironment } from '../_shared/asaas.ts'

const ORIGINS = (Deno.env.get('APP_URL') ?? '')
  .split(',')
  .map((u) => u.trim().replace(/\/$/, ''))
  .filter((u) => /^https?:\/\/[^/]+$/.test(u))
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  const origin = (req.headers.get('Origin') ?? '').replace(/\/$/, '')
  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : (ORIGINS[0] ?? '*'),
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
  if (!user) return json({ error: 'NOT_AUTHENTICATED' }, 401)
  const { data: isAdmin } = await userClient.rpc('is_super_admin')
  if (isAdmin !== true) return json({ error: 'FORBIDDEN' }, 403)

  let body: { organization_id?: string; reason?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'INVALID_JSON' }, 400)
  }
  const orgId = body.organization_id ?? ''
  const reason = (body.reason ?? '').trim()
  if (!UUID_RE.test(orgId)) return json({ error: 'INVALID_INPUT' }, 400)
  if (reason.length < 5) return json({ error: 'REASON_REQUIRED' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const { data: sub } = await admin.from('subscriptions')
    .select('provider, provider_subscription_id').eq('organization_id', orgId).maybeSingle()
  if (!sub) return json({ error: 'NOT_FOUND' }, 404)

  let providerResult = 'sem assinatura no gateway'
  if (sub.provider === ASAAS_PROVIDER && sub.provider_subscription_id) {
    const apiKey = Deno.env.get('ASAAS_API_KEY') ?? ''
    if (!apiKey) return json({ error: 'BILLING_NOT_CONFIGURED' }, 503)
    const keyEnv = asaasEnvironment(apiKey, Deno.env.get('ASAAS_ENV'))
    const { data: co } = await admin.from('billing_checkouts')
      .select('dev_mode').eq('provider', ASAAS_PROVIDER).eq('provider_checkout_id', sub.provider_subscription_id).maybeSingle()
    const subEnv = co?.dev_mode ? 'dev' : 'prod'
    if (co && keyEnv !== subEnv) {
      providerResult = `não cancelada no gateway: assinatura de ${subEnv === 'dev' ? 'sandbox' : 'produção'}, chave atual de outro ambiente`
    } else {
      try {
        // DELETE remove a assinatura e as cobranças pendentes; pagamentos já feitos continuam.
        await asaas(apiKey, keyEnv, 'DELETE', `/subscriptions/${sub.provider_subscription_id}`)
        providerResult = `asaas: ${sub.provider_subscription_id} removida`
      } catch (e) {
        if (e instanceof AsaasError && e.status === 404) {
          providerResult = `asaas: ${sub.provider_subscription_id} já estava removida`
        } else {
          const msg = e instanceof Error ? e.message : String(e)
          console.error('asaas cancel failed', msg)
          return json({ error: 'PROVIDER_CANCEL_FAILED', detail: msg.slice(0, 200) }, 502)
        }
      }
    }
  } else if (sub.provider === PROVIDER && sub.provider_subscription_id) {
    const apiKey = Deno.env.get('ABACATEPAY_API_KEY') ?? ''
    const { data: co } = await admin.from('billing_checkouts')
      .select('dev_mode').eq('organization_id', orgId).eq('status', 'completed')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    const subEnv = co?.dev_mode ? 'dev' : 'prod'
    if (!apiKey) {
      return json({ error: 'BILLING_NOT_CONFIGURED' }, 503)
    } else if (keyEnvironment(apiKey) !== subEnv) {
      // Ex.: assinatura criada em modo teste e a chave atual é de produção — não existe nesta conta.
      providerResult = `não cancelada no gateway: assinatura de ${subEnv === 'dev' ? 'modo teste' : 'produção'}, chave atual de outro ambiente`
    } else {
      try {
        await abacatepay(apiKey, 'POST', '/subscriptions/cancel', { id: sub.provider_subscription_id })
        providerResult = `abacatepay: ${sub.provider_subscription_id} cancelada`
      } catch (e) {
        const msg = e instanceof AbacatePayError ? e.message : String(e)
        if (/not active|not found|doesn't exist/i.test(msg)) {
          providerResult = `abacatepay: ${sub.provider_subscription_id} já estava inativa`
        } else {
          console.error('abacatepay cancel failed', msg)
          return json({ error: 'PROVIDER_CANCEL_FAILED', detail: msg.slice(0, 200) }, 502)
        }
      }
    }
  }

  const { error } = await userClient.rpc('admin_cancel_subscription', { p_org: orgId, p_reason: reason, p_provider_result: providerResult })
  if (error) return json({ error: error.message }, 400)
  return json({ ok: true, provider_result: providerResult })
})
