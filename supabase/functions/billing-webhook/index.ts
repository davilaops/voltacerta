// Edge Function: recebe webhooks do gateway de pagamento.
// - Valida assinatura HMAC (BILLING_WEBHOOK_SECRET)
// - Idempotência: unique(provider, event_id) em payment_events
// - Registra todos os eventos; só altera a assinatura em eventos assinados e reconhecidos
import { createClient } from 'npm:@supabase/supabase-js@2'
import { parseProviderEvent, subscriptionUpdateFor, verifySignature } from '../_shared/billing.ts'

const PROVIDER = Deno.env.get('BILLING_PROVIDER') ?? 'abacatepay'
const SIGNATURE_HEADER = Deno.env.get('BILLING_SIGNATURE_HEADER') ?? 'x-webhook-signature'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  const secret = Deno.env.get('BILLING_WEBHOOK_SECRET')
  if (!secret) return json({ error: 'BILLING_NOT_CONFIGURED' }, 503)

  const raw = await req.text()
  if (raw.length > 256_000) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413)
  if (!(await verifySignature(secret, raw, req.headers.get(SIGNATURE_HEADER)))) {
    return json({ error: 'INVALID_SIGNATURE' }, 401)
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return json({ error: 'INVALID_JSON' }, 400)
  }

  let ev
  try {
    ev = parseProviderEvent(payload)
  } catch (e) {
    return json({ error: (e as Error).message }, 400)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  // Idempotência: um mesmo evento só é processado uma vez
  const { data: inserted, error: insErr } = await admin
    .from('payment_events')
    .upsert(
      { provider: PROVIDER, event_id: ev.eventId, event_type: ev.rawType, organization_id: ev.organizationId, payload },
      { onConflict: 'provider,event_id', ignoreDuplicates: true },
    )
    .select('id')
  if (insErr) return json({ error: 'STORE_FAILED' }, 500)
  if (!inserted || inserted.length === 0) return json({ ok: true, duplicate: true })

  const eventRowId = inserted[0].id
  const update = subscriptionUpdateFor(ev)
  let processError: string | null = null
  if (update && ev.organizationId) {
    const { error } = await admin
      .from('subscriptions')
      .update({
        ...update,
        provider: PROVIDER,
        ...(ev.providerCustomerId ? { provider_customer_id: ev.providerCustomerId } : {}),
        ...(ev.providerSubscriptionId ? { provider_subscription_id: ev.providerSubscriptionId } : {}),
      })
      .eq('organization_id', ev.organizationId)
    if (error) processError = error.message
  } else if (update) {
    processError = 'ORGANIZATION_NOT_IDENTIFIED'
  }

  await admin
    .from('payment_events')
    .update({ processed_at: processError ? null : new Date().toISOString(), error: processError })
    .eq('id', eventRowId)

  return json({ ok: !processError }, processError ? 500 : 200)
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
