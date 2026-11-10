// Edge Function: inicia a assinatura de um plano.
// Valida o usuário (JWT) e exige papel owner na organização.
// A chamada ao gateway NÃO está implementada: os endpoints do provedor
// devem ser integrados a partir da documentação oficial. Até lá, a função
// responde explicitamente que a cobrança não está configurada.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  })
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return json({ error: 'NOT_AUTHENTICATED' }, 401)

  let body: { organization_id?: string; plan?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'INVALID_JSON' }, 400)
  }
  if (!body.organization_id || !['inicial', 'profissional', 'premium'].includes(body.plan ?? '')) {
    return json({ error: 'INVALID_INPUT' }, 400)
  }

  // RLS garante que só membros leem o vínculo; exigimos papel owner.
  const { data: member } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', body.organization_id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (member?.role !== 'owner') return json({ error: 'FORBIDDEN' }, 403)

  if (!Deno.env.get('ABACATEPAY_API_KEY')) return json({ error: 'BILLING_NOT_CONFIGURED' }, 503)

  // TODO(go-live): criar a cobrança recorrente no provedor (conforme a documentação
  // oficial), enviando metadata { organization_id, plan }, e retornar a URL de pagamento.
  return json({ error: 'BILLING_ADAPTER_PENDING' }, 501)
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
