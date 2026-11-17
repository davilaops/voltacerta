// Edge Function: emissão, consulta e cancelamento de nota fiscal (Focus NFe).
//   { action: "issue",   purchase_id, kind: "nfce" | "nfse", cpf? }
//   { action: "refresh", invoice_id }
//   { action: "cancel",  invoice_id, justificativa }   (15 a 255 caracteres)
// A posse da venda/nota é validada no banco com o JWT do usuário (fiscal_prepare /
// fiscal_invoice_for_user). O token da Focus é lido só aqui, com o service role.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildNfce, buildNfse, focus, parseFocus, type FiscalSettings, type Prepared } from '../_shared/fiscal.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ORIGINS = (Deno.env.get('APP_URL') ?? '').split(',').map((u) => u.trim().replace(/\/$/, '')).filter(Boolean)
const KNOWN = ['FISCAL_NOT_CONFIGURED', 'FISCAL_DATA_MISSING', 'FISCAL_NO_ITEMS', 'INVOICE_ALREADY_ISSUED', 'SUBSCRIPTION_INACTIVE', 'FORBIDDEN', 'NOT_FOUND']

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
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  let b: { action?: string; purchase_id?: string; kind?: string; cpf?: string; invoice_id?: string; justificativa?: string }
  try {
    b = await req.json()
  } catch {
    return json({ error: 'INVALID_JSON' }, 400)
  }
  const dbError = (msg: string, detail?: string) => {
    const code = KNOWN.find((k) => msg.includes(k))
    return json({ error: code ?? 'FISCAL_ERROR', detail }, code === 'FORBIDDEN' ? 403 : 400)
  }
  const settingsOf = async (orgId: string) => {
    const { data } = await admin.from('org_integrations').select('*').eq('organization_id', orgId).maybeSingle()
    return data as (FiscalSettings & { fiscal_enabled: boolean }) | null
  }

  if (b.action === 'issue') {
    if (!UUID_RE.test(b.purchase_id ?? '') || (b.kind !== 'nfce' && b.kind !== 'nfse')) return json({ error: 'INVALID_INPUT' }, 400)
    const { data, error } = await userClient.rpc('fiscal_prepare', { p_purchase: b.purchase_id, p_kind: b.kind })
    if (error) return dbError(error.message, error.details ?? undefined)
    const prep = data as Prepared
    const s = await settingsOf(prep.organization_id)
    if (!s?.fiscal_enabled || !s.fiscal_token) return json({ error: 'FISCAL_NOT_CONFIGURED' }, 400)
    if (b.kind === 'nfse' && (!s.fiscal_im || !s.fiscal_city_code)) {
      return json({ error: 'FISCAL_DATA_MISSING', detail: 'Inscrição municipal e código do município (IBGE) são obrigatórios para NFS-e.' }, 400)
    }
    const built = b.kind === 'nfce' ? buildNfce(prep, s, { cpf: b.cpf }) : buildNfse(prep, s, { cpf: b.cpf })
    if (built.total <= 0) return json({ error: 'FISCAL_NO_ITEMS' }, 400)
    const ref = `vc-${b.kind}-${prep.purchase.id.slice(0, 8)}-${Date.now().toString(36)}`
    let res
    try {
      res = await focus(s.fiscal_environment, s.fiscal_token, 'POST', `/v2/${b.kind}?ref=${encodeURIComponent(ref)}`, built.body)
    } catch (e) {
      return json({ error: 'FISCAL_PROVIDER_ERROR', detail: (e as Error).message.slice(0, 200) }, 502)
    }
    const r = parseFocus(b.kind, s.fiscal_environment, res.status, res.data)
    const { data: id, error: recErr } = await admin.rpc('fiscal_record_invoice', {
      p_org: prep.organization_id, p_purchase: prep.purchase.id, p_kind: b.kind, p_ref: ref, p_environment: s.fiscal_environment,
      p_status: r.status, p_amount: built.total, p_numero: r.numero, p_serie: r.serie, p_chave: r.chave,
      p_url_pdf: r.url_pdf, p_url_xml: r.url_xml, p_message: r.message, p_user: user.id,
    })
    if (recErr) console.error('fiscal_record_invoice failed', recErr.message)
    return json({ ok: r.status !== 'erro', invoice_id: id, ...r }, r.status === 'erro' ? 422 : 200)
  }

  if (b.action === 'refresh' || b.action === 'cancel') {
    if (!UUID_RE.test(b.invoice_id ?? '')) return json({ error: 'INVALID_INPUT' }, 400)
    const { data, error } = await userClient.rpc('fiscal_invoice_for_user', { p_invoice: b.invoice_id })
    if (error) return dbError(error.message)
    const inv = data as { organization_id: string; purchase_id: string; kind: 'nfce' | 'nfse'; ref: string; environment: 'homologacao' | 'producao'; amount: number; status: string }
    const s = await settingsOf(inv.organization_id)
    if (!s?.fiscal_token) return json({ error: 'FISCAL_NOT_CONFIGURED' }, 400)
    let res
    if (b.action === 'cancel') {
      const just = (b.justificativa ?? '').trim()
      if (just.length < 15 || just.length > 255) return json({ error: 'INVALID_JUSTIFICATION' }, 400)
      if (inv.status !== 'autorizado') return json({ error: 'INVALID_STATUS_TRANSITION' }, 400)
      res = await focus(inv.environment, s.fiscal_token, 'DELETE', `/v2/${inv.kind}/${encodeURIComponent(inv.ref)}`, { justificativa: just })
    } else {
      res = await focus(inv.environment, s.fiscal_token, 'GET', `/v2/${inv.kind}/${encodeURIComponent(inv.ref)}`)
    }
    const r = parseFocus(inv.kind, inv.environment, res.status, res.data)
    // Cancelamento recusado mantém a nota autorizada
    const status = b.action === 'cancel' && r.status !== 'cancelado' ? 'autorizado' : r.status
    await admin.rpc('fiscal_record_invoice', {
      p_org: inv.organization_id, p_purchase: inv.purchase_id, p_kind: inv.kind, p_ref: inv.ref, p_environment: inv.environment,
      p_status: status, p_amount: inv.amount, p_numero: r.numero, p_serie: r.serie, p_chave: r.chave,
      p_url_pdf: r.url_pdf, p_url_xml: r.url_xml, p_message: r.message, p_user: user.id,
    })
    if (b.action === 'cancel' && r.status !== 'cancelado') return json({ error: 'CANCEL_REFUSED', detail: r.message }, 422)
    return json({ ok: true, ...r, status })
  }
  return json({ error: 'INVALID_INPUT' }, 400)
})
