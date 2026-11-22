// Edge Function: página pública do estabelecimento (catálogo e agendamento online).
// Sem login. As funções do banco usadas aqui só são executáveis pelo service role,
// então TODA entrada pública passa por esta função, que valida o formato e aplica
// um limite de requisições por IP (os limites por telefone/loja ficam no banco).
//   GET  ?slug=pet-amigo                         -> dados públicos da loja
//   GET  ?slug=pet-amigo&service=UUID&date=AAAA-MM-DD -> horários livres
//   POST { slug, service_id, date, time, name, phone, pet_name?, notes? } -> solicitação
import { createClient } from 'npm:@supabase/supabase-js@2'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (body: unknown, status = 200, cache = false) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': cache ? 'public, max-age=60' : 'no-store' },
  })

// Limite simples por IP (por instância): 60 leituras e 5 solicitações a cada 10 minutos
const hits = new Map<string, { n: number; reset: number }>()
function limited(key: string, max: number): boolean {
  const now = Date.now()
  const h = hits.get(key)
  if (!h || h.reset < now) {
    hits.set(key, { n: 1, reset: now + 10 * 60_000 })
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k)
    return false
  }
  h.n++
  return h.n > max
}

const KNOWN = ['BOOKING_UNAVAILABLE', 'SERVICE_NOT_FOUND', 'INVALID_NAME', 'INVALID_PHONE', 'INVALID_DATE', 'RATE_LIMITED', 'SLOT_UNAVAILABLE']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  if (req.method === 'GET') {
    if (limited(`r:${ip}`, 120)) return json({ error: 'RATE_LIMITED' }, 429)
    const url = new URL(req.url)
    const slug = (url.searchParams.get('slug') ?? '').toLowerCase()
    if (!SLUG_RE.test(slug)) return json({ error: 'NOT_FOUND' }, 404)
    const service = url.searchParams.get('service')
    const date = url.searchParams.get('date')
    if (service || date) {
      if (!service || !UUID_RE.test(service) || !date || !DATE_RE.test(date)) return json({ error: 'INVALID_INPUT' }, 400)
      const { data, error } = await admin.rpc('public_slots', { p_slug: slug, p_service: service, p_date: date })
      if (error) return json({ error: 'UNAVAILABLE' }, 500)
      return json({ slots: data ?? [] })
    }
    const { data, error } = await admin.rpc('public_store', { p_slug: slug })
    if (error) return json({ error: 'UNAVAILABLE' }, 500)
    if (!data) return json({ error: 'NOT_FOUND' }, 404)
    return json(data, 200, true)
  }

  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  if (limited(`w:${ip}`, 5)) return json({ error: 'RATE_LIMITED' }, 429)
  const raw = await req.text()
  if (raw.length > 4000) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413)
  let b: Record<string, unknown>
  try {
    b = JSON.parse(raw)
  } catch {
    return json({ error: 'INVALID_JSON' }, 400)
  }
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const slug = str(b.slug, 40).toLowerCase()
  const serviceId = str(b.service_id, 36)
  const date = str(b.date, 10)
  const time = str(b.time, 5)
  // Campo invisível no formulário: robôs preenchem, pessoas não
  if (str(b.website, 100)) return json({ ok: true })
  if (!SLUG_RE.test(slug) || !UUID_RE.test(serviceId) || !DATE_RE.test(date) || !TIME_RE.test(time)) {
    return json({ error: 'INVALID_INPUT' }, 400)
  }
  const { data, error } = await admin.rpc('public_request_booking', {
    p_slug: slug,
    p_service: serviceId,
    p_date: date,
    p_time: time,
    p_name: str(b.name, 120),
    p_phone: str(b.phone, 30),
    p_pet_name: str(b.pet_name, 80) || null,
    p_notes: str(b.notes, 500) || null,
  })
  if (error) {
    const code = KNOWN.find((k) => error.message.includes(k))
    if (code) return json({ error: code }, code === 'RATE_LIMITED' ? 429 : 400)
    console.error('public booking failed', error.message)
    return json({ error: 'UNAVAILABLE' }, 500)
  }
  return json({ ok: true, booking: data })
})
