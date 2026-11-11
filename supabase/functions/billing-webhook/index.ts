// Edge Function: webhook v2 da AbacatePay.
// 1. Origem: X-Webhook-Secret (ou ?webhookSecret=) = BILLING_WEBHOOK_SECRET, comparação em tempo constante.
// 2. Integridade: X-Webhook-Signature = HMAC-SHA256 base64 do corpo bruto com a chave pública
//    da AbacatePay (ABACATEPAY_WEBHOOK_PUBLIC_KEY, copiada da documentação oficial).
// 3. Aplica o evento via billing_apply_event (transação única, idempotente pelo id do evento).
// Códigos: 401 não é reenviado pelo provedor; 5xx é reenviado (5 s, 5 min, 30 min, 2 h, 5 h, 10 h).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { parseAbacateEvent, verifyWebhookSecret, verifyWebhookSignature } from '../_shared/billing.ts'

// Chave pública HMAC da AbacatePay — a mesma para todas as contas, publicada em
// https://docs.abacatepay.com/pages/notificacoes/seguranca (constante ABACATEPAY_PUBLIC_KEY).
// Não é segredo: prova só a integridade do corpo; a origem é provada pelo BILLING_WEBHOOK_SECRET.
// Fixada no código (não via secret) para evitar erro de cópia; se a AbacatePay trocá-la, atualize aqui.
const ABACATEPAY_PUBLIC_KEY =
  't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  const secret = Deno.env.get('BILLING_WEBHOOK_SECRET') ?? ''
  const publicKey = ABACATEPAY_PUBLIC_KEY
  if (!secret || !publicKey) return json({ error: 'BILLING_NOT_CONFIGURED' }, 503)

  const url = new URL(req.url)
  if (!verifyWebhookSecret(secret, req.headers.get('x-webhook-secret'), url.searchParams.get('webhookSecret'))) {
    return json({ error: 'INVALID_SECRET' }, 401)
  }

  const raw = await req.text()
  if (raw.length > 256_000) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413)
  if (!(await verifyWebhookSignature(publicKey, raw, req.headers.get('x-webhook-signature')))) {
    return json({ error: 'INVALID_SIGNATURE' }, 401)
  }

  let event
  try {
    event = parseAbacateEvent(JSON.parse(raw))
  } catch (e) {
    return json({ error: e instanceof SyntaxError ? 'INVALID_JSON' : (e as Error).message }, 400)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const { data, error } = await admin.rpc('billing_apply_event', { p: event })
  if (error) {
    console.error('billing_apply_event failed', event.event_id, error.message)
    return json({ error: 'STORE_FAILED' }, 500) // provedor reenvia
  }
  const result = data as { status: string; error?: string }
  if (result.status === 'error') console.warn('billing event not applied', event.event_id, event.event_type, result.error)
  // Evento registrado (mesmo com erro de negócio): 200 para não gerar reenvios inúteis;
  // o erro fica em payment_events.error para análise no painel admin.
  return json({ ok: true, status: result.status })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
