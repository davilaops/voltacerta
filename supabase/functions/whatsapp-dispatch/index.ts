// Edge Function: envio automático de mensagens pelo WhatsApp (API oficial da Meta).
// Duas formas de chamada:
//  1. Agendador (pg_cron/cron externo): header x-cron-secret = CRON_SECRET -> todas as
//     lojas com envio automático ligado.
//  2. Painel (proprietário/administrador autenticado):
//     { organization_id, action: "run" }                       -> envia agora as pendentes
//     { organization_id, action: "test", phone, kind }         -> mensagem de teste
// Regras de envio (consentimento, oposição, deduplicação) ficam no banco: whatsapp_pending().
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  TEMPLATE_PARAMS, buildTemplateBody, previewText, sendTemplate, type PendingMessage, type ReminderKind,
} from '../_shared/whatsapp.ts'
import { safeEqual } from '../_shared/billing.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_PER_RUN = 200
const ORIGINS = (Deno.env.get('APP_URL') ?? '').split(',').map((u) => u.trim().replace(/\/$/, '')).filter(Boolean)

type Integration = { whatsapp_enabled: boolean; whatsapp_phone_number_id: string | null; whatsapp_token: string | null; whatsapp_templates: Record<string, { name: string; language: string }> }

async function runOrg(admin: SupabaseClient, orgId: string) {
  const { data: integ } = await admin.from('org_integrations')
    .select('whatsapp_enabled, whatsapp_phone_number_id, whatsapp_token, whatsapp_templates')
    .eq('organization_id', orgId).maybeSingle<Integration>()
  if (!integ?.whatsapp_enabled || !integ.whatsapp_phone_number_id || !integ.whatsapp_token) return { sent: 0, failed: 0, skipped: 0 }
  const { data, error } = await admin.rpc('whatsapp_pending', { p_org: orgId })
  if (error) throw new Error(error.message)
  const pending = ((data ?? []) as PendingMessage[]).slice(0, MAX_PER_RUN)
  let sent = 0, failed = 0, skipped = 0
  for (const m of pending) {
    const body = buildTemplateBody(m)
    if (!body) { skipped++; continue }
    const r = await sendTemplate(integ.whatsapp_phone_number_id, integ.whatsapp_token, body)
    await admin.rpc('whatsapp_record_dispatch', {
      p_org: orgId, p_customer: m.customer_id, p_kind: m.kind, p_dedupe_key: m.dedupe_key,
      p_template: m.template?.name ?? null, p_status: r.ok ? 'sent' : 'failed',
      p_provider_id: r.ok ? r.id : null, p_error: r.ok ? null : r.error,
      p_prediction: m.prediction_id, p_message: previewText(m),
    })
    if (r.ok) sent++
    else failed++
  }
  await admin.from('org_integrations').update({ whatsapp_last_run_at: new Date().toISOString() }).eq('organization_id', orgId)
  return { sent, failed, skipped }
}

Deno.serve(async (req) => {
  const origin = (req.headers.get('Origin') ?? '').replace(/\/$/, '')
  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : (ORIGINS[0] ?? '*'),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  // 1. Agendador
  const cronSecret = Deno.env.get('CRON_SECRET') ?? ''
  const given = req.headers.get('x-cron-secret')
  if (given) {
    if (!cronSecret || !safeEqual(cronSecret, given)) return json({ error: 'INVALID_TOKEN' }, 401)
    const { data: orgs, error } = await admin.rpc('whatsapp_enabled_orgs')
    if (error) return json({ error: 'STORE_FAILED' }, 500)
    const results: Record<string, unknown> = {}
    for (const id of (orgs ?? []) as string[]) {
      try {
        results[id] = await runOrg(admin, id)
      } catch (e) {
        results[id] = { error: (e as Error).message.slice(0, 200) }
      }
    }
    return json({ ok: true, orgs: Object.keys(results).length, results })
  }

  // 2. Painel
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'NOT_AUTHENTICATED' }, 401)
  let body: { organization_id?: string; action?: string; phone?: string; kind?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'INVALID_JSON' }, 400)
  }
  const orgId = body.organization_id ?? ''
  if (!UUID_RE.test(orgId)) return json({ error: 'INVALID_INPUT' }, 400)
  // Só proprietário/administrador (validado no banco)
  const { error: authErr } = await userClient.rpc('get_integration_settings', { p_org: orgId })
  if (authErr) return json({ error: 'FORBIDDEN' }, 403)

  if (body.action === 'run') {
    try {
      return json({ ok: true, ...(await runOrg(admin, orgId)) })
    } catch (e) {
      return json({ error: 'DISPATCH_FAILED', detail: (e as Error).message.slice(0, 200) }, 500)
    }
  }

  if (body.action === 'test') {
    const kind = body.kind as ReminderKind
    if (!(kind in TEMPLATE_PARAMS)) return json({ error: 'INVALID_INPUT' }, 400)
    const { data: integ } = await admin.from('org_integrations')
      .select('whatsapp_enabled, whatsapp_phone_number_id, whatsapp_token, whatsapp_templates')
      .eq('organization_id', orgId).maybeSingle<Integration>()
    if (!integ?.whatsapp_phone_number_id || !integ.whatsapp_token) return json({ error: 'INTEGRATION_INCOMPLETE' }, 400)
    const template = integ.whatsapp_templates?.[kind]
    if (!template) return json({ error: 'TEMPLATE_NOT_CONFIGURED' }, 400)
    const digits = (body.phone ?? '').replace(/\D/g, '')
    const phone = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits
    const msg: PendingMessage = {
      dedupe_key: 'teste', kind, customer_id: '', customer_name: 'Cliente Teste', phone, pet_name: 'Rex',
      service_name: 'Banho', product_name: 'Ração', prediction_id: null, date: '10/12', time: '14:00', template,
    }
    const payload = buildTemplateBody(msg)
    if (!payload) return json({ error: 'INVALID_PHONE' }, 400)
    const r = await sendTemplate(integ.whatsapp_phone_number_id, integ.whatsapp_token, payload)
    return r.ok ? json({ ok: true, id: r.id }) : json({ error: 'WHATSAPP_ERROR', detail: r.error, code: r.code }, 502)
  }
  return json({ error: 'INVALID_INPUT' }, 400)
})
