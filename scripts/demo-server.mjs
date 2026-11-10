/**
 * SERVIDOR DE DEMONSTRAÇÃO — somente para visualizar a interface sem Supabase.
 *
 * Imita os endpoints do Supabase (Auth, PostgREST, RPC, Functions) usados
 * pelo app, respondendo com DADOS DE EXEMPLO em memória. Não é backend real:
 * não aplica RLS nem as regras de negócio do banco. Nunca use em produção.
 *
 * Uso:  node scripts/demo-server.mjs   (porta 54321)
 *       npm run dev -- --mode demo    (usa .env.demo)
 * Login de demonstração: demo@voltacerta.test / demo1234
 */
import http from 'node:http'
import { randomUUID } from 'node:crypto'

const PORT = 54321
const TZ = 'America/Sao_Paulo'
const DEMO_EMAIL = 'demo@voltacerta.test'
const DEMO_PASSWORD = 'demo1234'

// ---------- datas locais ----------
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
const addDays = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const diff = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000)
const ts = (iso, h = 10) => `${iso}T${String(h).padStart(2, '0')}:15:00-03:00`
let seed = 7
const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)

// ---------- dados de exemplo ----------
const USER_ID = '00000000-0000-4000-8000-000000000001'
const ORG_ID = '00000000-0000-4000-8000-0000000000aa'
const user = {
  id: USER_ID, aud: 'authenticated', role: 'authenticated', email: DEMO_EMAIL,
  user_metadata: { full_name: 'Rafael Moreira' }, app_metadata: { provider: 'email' }, created_at: ts(addDays(today, -60)),
}
const org = {
  id: ORG_ID, name: 'Pet Shop Amigo Fiel', owner_name: 'Rafael Moreira', phone: '(19) 3232-4545', address: 'Av. Brasil, 1200',
  city: 'Campinas', state: 'SP', business_type: 'pet_shop', logo_path: null, timezone: TZ, soon_days: 7, overdue_after_days: 0,
  lost_after_days: 30, default_duration_days: 30, history_min_intervals: 2, history_max_weight: 0.7, attribution_days: 30,
  onboarding_completed: true, created_at: ts(addDays(today, -60)),
}

const products = [
  ['Ração Golden Adulto 15kg', 'racoes', 'Golden', 189.9, 35, 15, 'kg'],
  ['Ração Premier Gatos Castrados 7,5kg', 'racoes', 'Premier', 214.5, 40, 7.5, 'kg'],
  ['Areia Pipicat Classic 4kg', 'areia', 'Pipicat', 22.9, 20, 4, 'kg'],
  ['Antipulgas NexGard M (1 tablete)', 'medicamentos', 'NexGard', 79.9, 30, 1, 'un'],
  ['Petisco Dreamies 40g', 'petiscos', 'Dreamies', 9.9, 10, 40, 'g'],
  ['Shampoo Neutro Pet Clean 700ml', 'higiene', 'Pet Clean', 24.9, 45, 700, 'ml'],
  ['Sachê Whiskas Carne 85g', 'racoes', 'Whiskas', 3.49, 2, 85, 'g'],
  ['Coleira Antipulgas Seresto', 'medicamentos', 'Seresto', 249.9, 240, 1, 'un'],
].map(([name, category, brand, price, days, size, unit], i) => ({
  id: `00000000-0000-4000-8000-00000000p${String(i).padStart(3, '0')}`.slice(0, 36).replace('p', '1'),
  organization_id: ORG_ID, name, category, brand, sku: `SKU-${100 + i}`, price, cost: Math.round(price * 0.62 * 100) / 100,
  size_value: size, unit, description: null, avg_duration_days: days, active: true, created_at: ts(addDays(today, -58)),
}))
products.forEach((p, i) => (p.id = `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`))

const people = [
  ['Mariana Alves', '19988117722', ['Thor', 'cao', 'Golden Retriever']],
  ['Carlos Pereira', '19991234455', ['Mia', 'gato', 'SRD']],
  ['Juliana Costa', '19997651122', ['Bob', 'cao', 'Shih Tzu']],
  ['Fernanda Lima', '19992223344', ['Luna', 'gato', 'Siamês']],
  ['Roberto Santos', '19981112233', ['Rex', 'cao', 'Pastor Alemão']],
  ['Patrícia Gomes', '19993334455', ['Nina', 'gato', 'Persa']],
  ['André Ribeiro', '19984445566', ['Max', 'cao', 'Labrador']],
  ['Camila Rocha', '19995556677', ['Pipoca', 'cao', 'Poodle']],
  ['Lucas Martins', '19986667788', ['Frajola', 'gato', 'SRD']],
  ['Beatriz Souza', '19997778899', ['Mel', 'cao', 'Beagle']],
  ['Gustavo Araújo', '19988889900', ['Simba', 'gato', 'Maine Coon']],
  ['Aline Ferreira', '19989990011', ['Belinha', 'cao', 'Yorkshire']],
  ['Ricardo Oliveira', '19980001122', ['Toddy', 'cao', 'Dachshund']],
  ['Vanessa Carvalho', null, ['Kiara', 'gato', 'SRD']],
]

const customers = []
const pets = []
const purchases = []
const predictions = []
const contacts = []

// [índice produto, dias desde a última compra, qtd]
const plan = [
  [[0, 38, 1], [3, 33, 1]], [[1, 40, 1], [2, 20, 1]], [[0, 31, 1], [4, 6, 2]], [[2, 22, 1], [6, 12, 6]],
  [[0, 12, 1]], [[1, 34, 1]], [[0, 36, 1], [3, 8, 1]], [[5, 47, 1]], [[2, 19, 1]], [[0, 70, 1]],
  [[1, 15, 1], [2, 3, 2]], [[4, 9, 1]], [[7, 60, 1], [0, 29, 1]], [],
]

people.forEach(([name, phone, pet], i) => {
  const id = `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`
  const created = addDays(today, -55 + Math.floor(i * 3.5))
  customers.push({
    id, organization_id: ORG_ID, full_name: name, phone, phone_normalized: phone ? '55' + phone : null,
    email: i % 3 === 0 ? name.split(' ')[0].toLowerCase() + '@email.com' : null, notes: i === 0 ? 'Prefere contato à tarde.' : null,
    marketing_consent: i !== 5, consent_updated_at: i !== 5 ? ts(created) : null,
    do_not_contact: i === 5, do_not_contact_at: i === 5 ? ts(addDays(today, -10)) : null,
    created_at: ts(created, 9 + (i % 8)), updated_at: ts(created),
  })
  pets.push({ id: randomUUID(), organization_id: ORG_ID, customer_id: id, name: pet[0], species: pet[1], breed: pet[2], birth_date: null, notes: null, created_at: ts(created) })

  for (const [pi, ago, qty] of plan[i]) {
    const p = products[pi]
    // compra anterior (histórico) + compra atual
    for (const [k, when] of [[0, ago + p.avg_duration_days], [1, ago]].filter(([, w]) => w < 120)) {
      const date = addDays(today, -when)
      const purchaseId = randomUUID()
      const total = Math.round(p.price * qty * 100) / 100
      purchases.push({
        id: purchaseId, organization_id: ORG_ID, customer_id: id, purchase_date: date, subtotal: total, discount: 0, total,
        notes: null, created_at: ts(date, 11 + k), customers: { full_name: name },
        purchase_items: [{ id: randomUUID(), purchase_id: purchaseId, product_id: p.id, quantity: qty, unit_price: p.price, discount: 0, total, products: { name: p.name, category: p.category } }],
      })
      const exp = addDays(date, p.avg_duration_days * qty)
      if (k === 0) {
        const recovered = rand() > 0.45
        predictions.push(mkPred({ id, name, phone, pet: pet[0] }, p, qty, date, exp, 'completed', { recovered, recovered_amount: recovered ? total : 0, completed_at: ts(addDays(today, -ago)) }))
        if (recovered) contacts.push(mkContact(id, name, addDays(today, -ago - 2), 'comprou', p.name))
      } else {
        const contacted = i === 6 || i === 12
        predictions.push(mkPred({ id, name, phone, pet: pet[0] }, p, qty, date, exp, contacted ? 'contacted' : 'open', contacted ? { contacted_at: ts(addDays(today, -1)) } : {}))
        if (contacted) contacts.push(mkContact(id, name, addDays(today, -1), 'retornar_depois', p.name, addDays(today, 3)))
      }
    }
  }
})

function mkPred(c, p, qty, date, exp, status, extra) {
  return {
    id: randomUUID(), organization_id: ORG_ID, customer_id: c.id, product_id: p.id, source_purchase_id: randomUUID(),
    expected_date: exp, quantity: qty, expected_days: p.avg_duration_days * qty, base_days: p.avg_duration_days * qty,
    history_days: null, history_samples: 0, potential_value: Math.round(p.price * qty * 100) / 100, status,
    contacted_at: null, completed_at: null, completed_purchase_id: null, recovered: false, recovered_amount: 0, ignored_reason: null,
    created_at: ts(date), customer_name: c.name, customer_phone: c.phone, customer_phone_normalized: c.phone ? '55' + c.phone : null,
    customer_do_not_contact: c.id.endsWith('5'), product_name: p.name, product_category: p.category, product_price: p.price,
    last_purchase_date: date, pet_name: c.pet, ...extra,
  }
}
function mkContact(customerId, name, date, result, product, followUp = null) {
  return {
    id: randomUUID(), organization_id: ORG_ID, customer_id: customerId, prediction_id: null, template_id: null, channel: 'whatsapp_link',
    message: `Olá, ${name.split(' ')[0]}! Tudo bem? Estamos passando para saber se você está precisando repor ${product} para seu pet. Podemos separar para você!`,
    result, follow_up_date: followUp, notes: null, user_id: USER_ID, contacted_at: ts(date, 15), customers: { full_name: name },
  }
}

const templates = [
  ['Reposição', 'reposicao', 'Olá, {nome}! Tudo bem? Estamos passando para saber se você está precisando repor {produto} para seu pet. Podemos separar para você!'],
  ['Cliente atrasado', 'atrasado', 'Olá, {nome}! Sentimos sua falta por aqui. Está precisando de algum produto para seu pet? Estamos à disposição para ajudar!'],
  ['Recompra', 'recompra', 'Olá, {nome}! Está chegando o período de reposição de {produto}. Se precisar, podemos deixar seu pedido preparado!'],
].map(([name, kind, body]) => ({ id: randomUUID(), organization_id: ORG_ID, name, kind, body, is_default: true, created_at: ts(addDays(today, -60)) }))

// ---------- views derivadas ----------
function stageOf(p) {
  if (p.status === 'contacted') return 'contatada'
  if (p.status === 'completed') return 'concluida'
  if (p.status === 'ignored') return 'ignorada'
  const d = diff(p.expected_date, today)
  if (d < 0) return 'atrasada'
  if (d === 0) return 'hoje'
  return d <= org.soon_days ? 'proxima' : 'prevista'
}
const vPredictions = () =>
  predictions.map((p) => ({ ...p, days_until: diff(p.expected_date, today), stage: stageOf(p), is_lost: ['open', 'contacted'].includes(p.status) && diff(today, p.expected_date) > org.lost_after_days }))

function vCustomers() {
  return customers.map((c) => {
    const ps = purchases.filter((p) => p.customer_id === c.id).sort((a, b) => b.purchase_date.localeCompare(a.purchase_date))
    const active = predictions.filter((p) => p.customer_id === c.id && ['open', 'contacted'].includes(p.status))
    const next = active.map((p) => p.expected_date).sort()[0] ?? null
    const last = ps[0]?.purchase_date ?? null
    let situation = 'em_dia'
    if (!last) situation = 'sem_compras'
    else if (next && next <= today) situation = 'precisa_contato'
    else if (next && diff(next, today) <= org.soon_days) situation = 'proxima'
    else if (!next && diff(today, last) > org.lost_after_days) situation = 'inativo'
    const myPets = pets.filter((p) => p.customer_id === c.id)
    return {
      ...c, pet_names: myPets.map((p) => p.name).join(', '), pet_count: myPets.length, purchases_count: ps.length,
      total_spent: Math.round(ps.reduce((s, p) => s + p.total, 0) * 100) / 100, last_purchase_date: last,
      last_product_name: ps[0]?.purchase_items[0].products.name ?? null, next_expected_date: next, situation,
    }
  })
}

const ctx = () => ({
  role: 'owner', plan: 'profissional', status: 'trialing', effective_status: 'trialing', trial_ends_at: ts(addDays(today, 9)),
  current_period_end: null, can_write: true, customer_limit: 500, customer_count: customers.length,
  features: { reports_full: true, history_advanced: true, reports_advanced: false }, today,
})

function dashboard(from, to) {
  const vp = vPredictions()
  const recoveredRows = vp.filter((p) => p.recovered && p.completed_at.slice(0, 10) >= from && p.completed_at.slice(0, 10) <= to)
  const due = vp.filter((p) => p.expected_date >= from && p.expected_date <= today && p.status !== 'ignored')
  const days = []
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d)
  const vc = vCustomers()
  const situations = {}
  vc.forEach((c) => (situations[c.situation] = (situations[c.situation] ?? 0) + 1))
  const activity = [
    ...purchases.map((p) => ({ type: 'purchase', at: p.created_at, customer_name: p.customers.full_name, customer_id: p.customer_id, amount: p.total, detail: null })),
    ...contacts.map((c) => ({ type: 'contact', at: c.contacted_at, customer_name: c.customers.full_name, customer_id: c.customer_id, amount: null, detail: c.result })),
    ...customers.map((c) => ({ type: 'customer', at: c.created_at, customer_name: c.full_name, customer_id: c.id, amount: null, detail: null })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10)
  const count = (s) => vp.filter((p) => p.stage === s).length
  return {
    customers_total: customers.length,
    customers_new: customers.filter((c) => c.created_at.slice(0, 10) >= from).length,
    predictions_upcoming: vp.filter((p) => p.status === 'open' && p.days_until >= 0 && p.days_until <= org.soon_days).length,
    contact_today: new Set(vp.filter((p) => p.status === 'open' && p.days_until <= 0 && !p.customer_do_not_contact).map((p) => p.customer_id)).size,
    recovered_sales: recoveredRows.length,
    recovered_revenue: Math.round(recoveredRows.reduce((s, p) => s + p.recovered_amount, 0) * 100) / 100,
    repurchase_rate: due.length ? Math.round((due.filter((p) => p.status === 'completed').length / due.length) * 1000) / 10 : null,
    repurchase_due: due.length,
    repurchase_done: due.filter((p) => p.status === 'completed').length,
    series: days.map((d) => {
      const r = recoveredRows.filter((p) => p.completed_at.slice(0, 10) === d)
      return { date: d, recovered_sales: r.length, recovered_revenue: r.reduce((s, p) => s + p.recovered_amount, 0), customers_total: customers.filter((c) => c.created_at.slice(0, 10) <= d).length }
    }),
    pipeline: { prevista: count('prevista'), proxima: count('proxima'), hoje: count('hoje'), atrasada: count('atrasada'), contatada: count('contatada') },
    situations,
    activity,
  }
}

function report(kind, from, to) {
  const inRange = (d) => d >= from && d <= to
  const ps = purchases.filter((p) => inRange(p.purchase_date))
  const vp = vPredictions()
  switch (kind) {
    case 'sales_by_period': {
      const by = {}
      ps.forEach((p) => {
        by[p.purchase_date] ??= { date: p.purchase_date, purchases: 0, revenue: 0, customers: new Set() }
        by[p.purchase_date].purchases++
        by[p.purchase_date].revenue += p.total
        by[p.purchase_date].customers.add(p.customer_id)
      })
      return Object.values(by).sort((a, b) => a.date.localeCompare(b.date)).map((r) => ({ ...r, revenue: Math.round(r.revenue * 100) / 100, customers: r.customers.size }))
    }
    case 'top_products': {
      const by = {}
      ps.forEach((p) => p.purchase_items.forEach((it) => {
        by[it.product_id] ??= { product: it.products.name, category: it.products.category, quantity: 0, revenue: 0, purchases: 0 }
        by[it.product_id].quantity += it.quantity
        by[it.product_id].revenue += it.total
        by[it.product_id].purchases++
      }))
      return Object.values(by).sort((a, b) => b.revenue - a.revenue)
    }
    case 'top_customers': {
      const by = {}
      ps.forEach((p) => {
        const c = customers.find((x) => x.id === p.customer_id)
        by[c.id] ??= { customer: c.full_name, phone: c.phone, purchases: 0, revenue: 0, last_purchase: p.purchase_date }
        by[c.id].purchases++
        by[c.id].revenue += p.total
        if (p.purchase_date > by[c.id].last_purchase) by[c.id].last_purchase = p.purchase_date
      })
      return Object.values(by).sort((a, b) => b.purchases - a.purchases || b.revenue - a.revenue)
    }
    case 'inactive_customers':
      return vCustomers().filter((c) => c.last_purchase_date && c.last_purchase_date < from).map((c) => ({ customer: c.full_name, phone: c.phone, last_purchase: c.last_purchase_date, days_inactive: diff(today, c.last_purchase_date), lifetime_revenue: c.total_spent }))
    case 'completed_repurchases':
      return vp.filter((p) => p.status === 'completed' && inRange(p.completed_at.slice(0, 10))).map((p) => ({ customer: p.customer_name, product: p.product_name, expected_date: p.expected_date, purchase_date: p.completed_at.slice(0, 10), days_vs_expected: diff(p.completed_at.slice(0, 10), p.expected_date), recovered: p.recovered, purchase_total: p.potential_value }))
    case 'lost_opportunities':
      return vp.filter((p) => p.is_lost && inRange(p.expected_date)).map((p) => ({ customer: p.customer_name, phone: p.customer_phone, product: p.product_name, expected_date: p.expected_date, days_overdue: -p.days_until, potential_value: p.potential_value, reason: 'sem recompra' }))
    case 'recovered_revenue':
      return vp.filter((p) => p.recovered && inRange(p.completed_at.slice(0, 10))).map((p) => ({ purchase_date: p.completed_at.slice(0, 10), customer: p.customer_name, product: p.product_name, amount: p.recovered_amount }))
    case 'recovery_rate': {
      const due = vp.filter((p) => p.expected_date >= from && p.expected_date <= today && p.status !== 'ignored')
      const contacted = due.filter((p) => p.recovered || p.contacted_at).length
      const completed = due.filter((p) => p.status === 'completed').length
      const recovered = due.filter((p) => p.recovered).length
      return [{ predictions_due: due.length, contacted, completed, recovered, repurchase_rate: due.length ? Math.round((completed / due.length) * 1000) / 10 : null, recovery_rate: contacted ? Math.round((recovered / contacted) * 1000) / 10 : null }]
    }
    default:
      return []
  }
}

// ---------- mini PostgREST ----------
const tables = {
  organization_members: () => [{ organization_id: ORG_ID, user_id: USER_ID, role: 'owner', created_at: org.created_at, organizations: org }],
  organizations: () => [org],
  profiles: () => [{ id: USER_ID, full_name: 'Rafael Moreira', email: DEMO_EMAIL }],
  customers: () => customers,
  v_customers: vCustomers,
  pets: () => pets,
  products: () => products,
  purchases: () => purchases,
  v_predictions: vPredictions,
  replenishment_predictions: vPredictions,
  contact_logs: () => contacts,
  message_templates: () => templates,
  organization_invitations: () => [],
  data_deletion_requests: () => [],
  subscriptions: () => [],
}

// Tabelas base que aceitam escrita no modo demonstração (as views derivam delas)
const writable = { products, customers, pets, message_templates: templates, organizations: [org] }
const writeDefaults = {
  products: { active: true, unit: 'un', category: 'outros', price: 0 },
  customers: { marketing_consent: false, do_not_contact: false, notes: null, email: null },
  pets: { species: 'cao', breed: null, birth_date: null, notes: null },
  message_templates: { kind: 'custom', is_default: false },
}

function applyFilters(rows, params) {
  let out = rows
  for (const [key, raw] of params) {
    if (['select', 'order', 'offset', 'limit', 'or', 'columns', 'on_conflict'].includes(key)) continue
    const m = raw.match(/^(eq|neq|gt|gte|lt|lte|in|is|ilike|like)\.(.*)$/)
    if (!m) continue
    const [, op, val] = m
    out = out.filter((r) => {
      const v = r[key]
      const s = v == null ? null : String(v)
      switch (op) {
        case 'eq': return s === val
        case 'neq': return s !== val
        case 'gt': return s != null && s > val
        case 'gte': return s != null && s >= val
        case 'lt': return s != null && s < val
        case 'lte': return s != null && s <= val
        case 'in': return val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/"/g, '')).includes(s)
        case 'is': return val === 'null' ? v == null : s === val
        case 'ilike': case 'like': return s != null && new RegExp('^' + val.replace(/[%*]/g, '.*') + '$', 'i').test(s)
        default: return true
      }
    })
  }
  const or = params.get('or')
  if (or) {
    const terms = or.replace(/^\(|\)$/g, '').split(',').map((t) => t.match(/^(\w+)\.ilike\.(.*)$/)).filter(Boolean)
    out = out.filter((r) => terms.some(([, k, v]) => r[k] != null && new RegExp('^' + v.replace(/[%*]/g, '.*') + '$', 'i').test(String(r[k]))))
  }
  const order = params.get('order')
  if (order) {
    const [col, dir] = order.split(',')[0].split('.')
    out = [...out].sort((a, b) => String(a[col] ?? '').localeCompare(String(b[col] ?? ''), 'pt-BR', { numeric: true }) * (dir === 'desc' ? -1 : 1))
  }
  return out
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
function session() {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24
  return {
    access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_ID, role: 'authenticated', email: DEMO_EMAIL, exp, aud: 'authenticated' })}.demo`,
    token_type: 'bearer', expires_in: 3600 * 24, expires_at: exp, refresh_token: 'demo-refresh', user,
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, X-Total-Count')
  if (req.method === 'OPTIONS') return send(res, 204)

  const url = new URL(req.url, `http://localhost:${PORT}`)
  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || 'null') : null
  const path = url.pathname

  // Auth
  if (path === '/auth/v1/token') {
    if (url.searchParams.get('grant_type') === 'password' && (body?.email !== DEMO_EMAIL || body?.password !== DEMO_PASSWORD))
      return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' })
    return send(res, 200, session())
  }
  if (path === '/auth/v1/user') return send(res, 200, user)
  if (path === '/auth/v1/logout') return send(res, 204)
  if (path.startsWith('/auth/v1/')) return send(res, 200, {})

  // Functions
  if (path.startsWith('/functions/v1/')) return send(res, 503, { error: 'BILLING_NOT_CONFIGURED' })

  // RPC
  if (path.startsWith('/rest/v1/rpc/')) {
    const fn = path.split('/').pop()
    switch (fn) {
      case 'get_org_context': return send(res, 200, ctx())
      case 'accept_pending_invitations': return send(res, 200, 0)
      case 'dashboard_metrics': return send(res, 200, dashboard(body.p_from, body.p_to))
      case 'get_report': return send(res, 200, report(body.p_kind, body.p_from, body.p_to))
      case 'export_customer_data': return send(res, 200, { demo: true, customer: customers.find((c) => c.id === body.p_customer) })
      case 'log_contact': {
        const c = customers.find((x) => x.id === body.p_customer)
        const p = predictions.find((x) => x.id === body.p_prediction)
        if (p && p.status === 'open') Object.assign(p, { status: 'contacted', contacted_at: new Date().toISOString() })
        contacts.unshift({ ...mkContact(c.id, c.full_name, today, body.p_result, p?.product_name ?? 'produtos'), message: body.p_message, contacted_at: new Date().toISOString() })
        return send(res, 200, randomUUID())
      }
      case 'set_prediction_status': {
        const p = predictions.find((x) => x.id === body.p_prediction)
        if (p) p.status = body.p_status === 'ignored' ? 'ignored' : p.contacted_at ? 'contacted' : 'open'
        return send(res, 200, null)
      }
      default: return send(res, 200, randomUUID())
    }
  }

  // Tabelas / views
  if (path.startsWith('/rest/v1/')) {
    const table = path.split('/').pop()
    const source = tables[table]
    if (!source) return send(res, 404, { message: `Tabela ${table} não existe no modo demonstração` })
    const single = (req.headers.accept ?? '').includes('vnd.pgrst.object')

    if (req.method === 'GET' || req.method === 'HEAD') {
      const all = applyFilters(source(), url.searchParams)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const limit = Number(url.searchParams.get('limit') ?? all.length)
      const page = all.slice(offset, offset + limit)
      const headers = { 'Content-Range': `${offset}-${offset + page.length - 1}/${all.length}` }
      if (single) return page[0] ? send(res, 200, page[0], headers) : send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' })
      return send(res, 200, page, headers)
    }
    // Escritas: persistem em memória enquanto o servidor estiver rodando
    const store = writable[table]
    const row = Array.isArray(body) ? body[0] : body
    if (req.method === 'POST') {
      const result = { id: randomUUID(), organization_id: ORG_ID, created_at: new Date().toISOString(), ...(writeDefaults[table] ?? {}), ...(row ?? {}) }
      if (table === 'customers') result.phone_normalized = result.phone ? '55' + String(result.phone).replace(/\D/g, '').replace(/^55/, '') : null
      store?.push(result)
      return send(res, 201, single ? result : [result])
    }
    const targets = store ? applyFilters(store, url.searchParams) : []
    if (req.method === 'PATCH') {
      targets.forEach((t) => Object.assign(t, row, { updated_at: new Date().toISOString() }))
      if (table === 'organizations') Object.assign(org, row)
      return send(res, 200, single ? targets[0] ?? null : targets)
    }
    if (req.method === 'DELETE') {
      if (table === 'products' && targets.some((t) => purchases.some((p) => p.purchase_items.some((i) => i.product_id === t.id))))
        return send(res, 409, { code: '23503', message: 'update or delete on table "products" violates foreign key constraint' })
      for (const t of targets) store.splice(store.indexOf(t), 1)
      return send(res, 200, targets.map((t) => ({ id: t.id })))
    }
    return send(res, 405, { message: 'método não suportado no modo demonstração' })
  }

  send(res, 404, { message: 'not found' })
})

server.listen(PORT, () => {
  console.log(`[demo] API de demonstração em http://localhost:${PORT}`)
  console.log(`[demo] Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`)
})
