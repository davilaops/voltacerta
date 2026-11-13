// Edge Function: webhook do Asaas (API v3).
// 1. Origem: header asaas-access-token = BILLING_WEBHOOK_SECRET (o "Token de autenticação"
//    cadastrado no webhook do Asaas), comparação em tempo constante.
// 2. Normaliza o evento e aplica via billing_apply_event (transação única, idempotente pelo id do evento).
// 3. Primeira cobrança vencida sem pagamento: remove a assinatura no Asaas para não gerar
//    novas faturas de uma assinatura abandonada.
// Respostas: 200 sempre que o evento foi registrado (mesmo ignorado); o Asaas pausa a fila
// após 15 falhas seguidas, então só devolvemos 5xx quando o banco falhar de fato.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { ASAAS_PROVIDER, AsaasError, asaas, asaasEnvironment, parseAsaasEvent, verifyAsaasToken } from '../_shared/asaas.ts'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  const secret = Deno.env.get('BILLING_WEBHOOK_SECRET') ?? ''
  const apiKey = Deno.env.get('ASAAS_API_KEY') ?? ''
  if (!secret || !apiKey) return json({ error: 'BILLING_NOT_CONFIGURED' }, 503)
  if (!verifyAsaasToken(secret, req.headers.get('asaas-access-token'))) return json({ error: 'INVALID_TOKEN' }, 401)

  const raw = await req.text()
  if (raw.length > 256_000) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413)
  const env = asaasEnvironment(apiKey, Deno.env.get('ASAAS_ENV'))

  let event
  try {
    event = parseAsaasEvent(JSON.parse(raw), env === 'dev')
  } catch (e) {
    return json({ error: e instanceof SyntaxError ? 'INVALID_JSON' : (e as Error).message }, 400)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const { data, error } = await admin.rpc('billing_apply_event', { p: event })
  if (error) {
    console.error('billing_apply_event failed', event.event_id, error.message)
    return json({ error: 'STORE_FAILED' }, 500) // Asaas reenvia
  }
  const result = data as { status: string; error?: string }
  if (result.status === 'error') console.warn('billing event not applied', event.event_id, event.event_type, result.error)

  // Assinatura abandonada: 1ª cobrança venceu e nunca houve pagamento → remove no Asaas.
  if (event.event_type === 'PAYMENT_OVERDUE' && event.subscription_id) {
    const { data: co } = await admin.from('billing_checkouts').select('id, status')
      .eq('provider', ASAAS_PROVIDER).eq('provider_checkout_id', event.subscription_id).maybeSingle()
    if (co?.status === 'pending') {
      try {
        await asaas(apiKey, env, 'DELETE', `/subscriptions/${event.subscription_id}`)
      } catch (e) {
        if (!(e instanceof AsaasError && e.status === 404)) console.warn('asaas: could not delete abandoned subscription', (e as Error).message)
      }
      await admin.from('billing_checkouts').update({ status: 'failed' }).eq('id', co.id).eq('status', 'pending')
    }
  }
  return json({ ok: true, status: result.status })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
