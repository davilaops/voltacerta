/**
 * DEMONSTRAÇÃO dos módulos de gestão (estoque, agenda, pacotes, caixa,
 * financeiro, lembretes, loja online, integrações). Dados de exemplo em
 * memória para visualizar a interface — não aplica as regras reais do banco.
 */
import { randomUUID } from 'node:crypto'

export function createModulesDemo({ today, addDays, ts, org, products, customers, pets, purchases, predictions, contacts, templates, ORG_ID, TZ }) {
  const r2 = (v) => Math.round(v * 100) / 100
  const err = (code, status = 400) => Object.assign(new Error(code), { status })

  // ---------- organização e produtos: campos novos ----------
  Object.assign(org, {
    business_hours: { 0: null, 1: ['08:00', '18:00'], 2: ['08:00', '18:00'], 3: ['08:00', '18:00'], 4: ['08:00', '18:00'], 5: ['08:00', '18:00'], 6: ['08:00', '13:00'] },
    slot_minutes: 30, public_slug: 'amigo-fiel', catalog_enabled: true, booking_enabled: true, show_prices: true,
    public_whatsapp: '(19) 99876-5432', public_description: 'Banho e tosa com carinho, rações e acessórios. Leva e traz no bairro.',
    booking_min_notice_hours: 2, booking_days_ahead: 30, post_sale_days: 3,
  })
  const stockSeed = { 0: [6, 4, 'Distribuidora PetMais'], 1: [2, 3, 'Distribuidora PetMais'], 2: [18, 10, 'Atacado Areia Boa'], 3: [3, 5, 'VetFarma'], 4: [25, 10, null] }
  products.forEach((p, i) => {
    const s = stockSeed[i]
    Object.assign(p, {
      track_stock: !!s, stock_qty: s ? s[0] : 0, min_stock: s ? s[1] : null, supplier: s ? s[2] : null, lead_time_days: 5,
      catalog_visible: i < 6, ncm: i === 0 || i === 1 ? '23091000' : null, cfop: '5102', fiscal_origin: 0,
    })
  })
  pets[0].birth_date = `${Number(today.slice(0, 4)) - 4}${today.slice(4)}` // aniversário hoje
  pets[2].birth_date = `${Number(today.slice(0, 4)) - 2}${addDays(today, 3).slice(4)}`
  purchases.forEach((p) => { p.channel ??= 'registro'; p.cash_session_id ??= null; p.purchase_services ??= [] })

  const moreTemplates = [
    ['Aniversário do pet', 'aniversario', 'Olá, {nome}! Hoje é um dia especial: parabéns ao {pet}! 🎉 Que ele tenha muita saúde e alegria. Um abraço da equipe!'],
    ['Pós-venda', 'pos_venda', 'Olá, {nome}! Tudo certo com a sua compra? Se o {pet} gostou ou se tiver alguma dúvida, é só chamar. Obrigado pela preferência!'],
    ['Lembrete de agendamento', 'lembrete_agendamento', 'Olá, {nome}! Lembrando do {servico} do {pet} em {data} às {hora}. Podemos confirmar?'],
    ['Retorno de serviço', 'retorno_servico', 'Olá, {nome}! Já está na hora do próximo {servico} do {pet}. Quer que a gente reserve um horário?'],
    ['Pacote vencendo', 'pacote_vencendo', 'Olá, {nome}! O pacote {pacote} do {pet} vence em {data} e ainda tem sessões disponíveis. Vamos agendar?'],
  ]
  for (const [name, kind, body] of moreTemplates) templates.push({ id: randomUUID(), organization_id: ORG_ID, name, kind, body, is_default: true, created_at: ts(addDays(today, -60)) })

  // ---------- serviços, profissionais, pacotes ----------
  const services = [
    ['Banho porte pequeno', 'banho', 55, 60, 15], ['Banho e tosa higiênica', 'banho_tosa', 85, 90, 30],
    ['Tosa completa', 'tosa', 110, 120, 45], ['Hidratação de pelos', 'hidratacao', 40, 30, null],
  ].map(([name, category, price, duration_minutes, return_days]) => ({
    id: randomUUID(), organization_id: ORG_ID, name, category, price, duration_minutes, return_days, description: null,
    active: true, catalog_visible: true, bookable_online: true, created_at: ts(addDays(today, -50)),
  }))
  const professionals = [
    { id: randomUUID(), organization_id: ORG_ID, name: 'Ana Souza', role: 'tosador', phone: null, color: '#22c58b', work_days: [1, 2, 3, 4, 5, 6], work_start: '08:00:00', work_end: '18:00:00', active: true },
    { id: randomUUID(), organization_id: ORG_ID, name: 'Bruno Lima', role: 'banhista', phone: null, color: '#3b82f6', work_days: [1, 2, 3, 4, 5], work_start: '09:00:00', work_end: '17:00:00', active: true },
  ]
  const servicePackages = [{ id: randomUUID(), organization_id: ORG_ID, name: 'Plano mensal — 4 banhos', service_id: services[0].id, sessions: 4, price: 180, validity_days: 35, active: true, created_at: ts(addDays(today, -40)) }]
  const customerPackages = [{
    id: randomUUID(), organization_id: ORG_ID, customer_id: customers[2].id, pet_id: pets[2].id, package_id: servicePackages[0].id,
    service_id: services[0].id, name: servicePackages[0].name, sessions_total: 4, sessions_used: 3, price_paid: 180,
    purchased_at: addDays(today, -28), expires_at: addDays(today, 5), status: 'active', created_at: ts(addDays(today, -28)),
  }]
  const at = (date, hm) => new Date(`${date}T${hm}:00-03:00`).toISOString()
  const mkAppt = (ci, si, pi, date, hm, status, extra = {}) => {
    const svc = services[si]
    const starts = at(date, hm)
    return {
      id: randomUUID(), organization_id: ORG_ID, customer_id: ci == null ? null : customers[ci].id, pet_id: ci == null ? null : pets[ci].id,
      service_id: svc.id, professional_id: pi == null ? null : professionals[pi].id, starts_at: starts,
      ends_at: new Date(Date.parse(starts) + svc.duration_minutes * 60000).toISOString(), status, price: svc.price,
      customer_package_id: null, source: 'painel', requester_name: null, requester_phone: null, pet_name: null, notes: null,
      cancel_reason: null, completed_at: status === 'done' ? starts : null, created_at: ts(addDays(today, -3)), ...extra,
    }
  }
  const appointments = [
    mkAppt(0, 1, 0, today, '09:00', 'confirmed'), mkAppt(2, 0, 1, today, '10:00', 'scheduled', { customer_package_id: customerPackages[0].id, price: 0 }),
    mkAppt(4, 2, 0, today, '13:30', 'scheduled'), mkAppt(6, 3, 1, today, '15:00', 'in_progress'),
    mkAppt(7, 0, 1, addDays(today, 1), '09:30', 'scheduled'), mkAppt(9, 1, 0, addDays(today, 2), '11:00', 'confirmed'),
    mkAppt(1, 0, 0, addDays(today, -16), '10:00', 'done'),
    mkAppt(null, 0, 1, addDays(today, 1), '14:00', 'requested', { source: 'online', requester_name: 'Joana Pereira', requester_phone: '5519991112233', pet_name: 'Bidu' }),
  ]
  const vAppointments = () => appointments.map((a) => {
    const c = customers.find((x) => x.id === a.customer_id)
    const pe = pets.find((x) => x.id === a.pet_id)
    const s = services.find((x) => x.id === a.service_id)
    const pr = professionals.find((x) => x.id === a.professional_id)
    const cp = customerPackages.find((x) => x.id === a.customer_package_id)
    return {
      ...a, customer_name: c?.full_name ?? a.requester_name, customer_phone: c?.phone ?? a.requester_phone, customer_do_not_contact: c?.do_not_contact ?? null,
      pet_display_name: pe?.name ?? a.pet_name, service_name: s?.name, service_category: s?.category, professional_name: pr?.name ?? null,
      professional_color: pr?.color ?? null, package_name: cp?.name ?? null, package_sessions_total: cp?.sessions_total ?? null, package_sessions_used: cp?.sessions_used ?? null,
    }
  })

  // ---------- estoque ----------
  const stockMovements = products.filter((p) => p.track_stock).map((p) => ({
    id: randomUUID(), organization_id: ORG_ID, product_id: p.id, kind: 'entrada', quantity: p.stock_qty + 4, balance_after: p.stock_qty + 4,
    unit_cost: p.cost, purchase_id: null, notes: 'Pedido inicial', created_at: ts(addDays(today, -20)), products: { name: p.name, unit: p.unit },
  }))
  const moveStock = (p, kind, delta, notes = null, unitCost = null, purchaseId = null) => {
    p.stock_qty = r2(p.stock_qty + delta)
    stockMovements.unshift({ id: randomUUID(), organization_id: ORG_ID, product_id: p.id, kind, quantity: delta, balance_after: p.stock_qty, unit_cost: unitCost, purchase_id: purchaseId, notes, created_at: new Date().toISOString(), products: { name: p.name, unit: p.unit } })
  }

  // ---------- financeiro e caixa ----------
  const financeEntries = purchases.map((p) => ({
    id: randomUUID(), organization_id: ORG_ID, kind: 'income', category: 'venda_produtos', description: 'Venda de produtos', amount: p.total,
    due_date: p.purchase_date, paid_at: p.purchase_date, status: 'paid', payment_method: 'nao_informado', customer_id: p.customer_id,
    supplier: null, purchase_id: p.id, cash_session_id: null, notes: null, created_at: p.created_at, customers: p.customers,
  }))
  const expense = (description, category, amount, due, paid, supplier = null) => financeEntries.push({
    id: randomUUID(), organization_id: ORG_ID, kind: 'expense', category, description, amount, due_date: due, paid_at: paid ? due : null,
    status: paid ? 'paid' : 'pending', payment_method: paid ? 'pix' : null, customer_id: null, supplier, purchase_id: null, cash_session_id: null,
    notes: null, created_at: ts(addDays(today, -10)), customers: null,
  })
  expense('Aluguel da loja', 'aluguel', 2200, addDays(today, -12), true)
  expense('Pedido de rações', 'fornecedores', 1850.4, addDays(today, 4), false, 'Distribuidora PetMais')
  expense('Energia elétrica', 'energia_agua', 312.9, addDays(today, -2), false)
  financeEntries.push({
    id: randomUUID(), organization_id: ORG_ID, kind: 'income', category: 'venda_produtos', description: 'Venda fiado', amount: 89.9,
    due_date: addDays(today, 6), paid_at: null, status: 'pending', payment_method: 'fiado', customer_id: customers[3].id, supplier: null,
    purchase_id: null, cash_session_id: null, notes: null, created_at: ts(addDays(today, -4)), customers: { full_name: customers[3].full_name },
  })
  const cashSessions = [{ id: randomUUID(), organization_id: ORG_ID, status: 'closed', opening_amount: 100, opened_by: null, opened_at: ts(addDays(today, -1), 8), expected_amount: 412.5, counted_amount: 410, closed_by: null, closed_at: ts(addDays(today, -1), 18), notes: null }]
  const cashMovements = []
  const openSession = () => cashSessions.find((s) => s.status === 'open')
  const expectedCash = (s) => r2(s.opening_amount
    + financeEntries.filter((e) => e.cash_session_id === s.id && e.status === 'paid' && e.payment_method === 'dinheiro').reduce((t, e) => t + (e.kind === 'income' ? e.amount : -e.amount), 0)
    + cashMovements.filter((m) => m.session_id === s.id).reduce((t, m) => t + (m.kind === 'suprimento' ? m.amount : -m.amount), 0))

  function recordPayments(purchase, payments, date, dueDate, category, description) {
    const s = openSession()
    const list = payments?.length ? payments : [{ method: 'nao_informado', amount: purchase.total }]
    for (const pay of list) {
      const fiado = pay.method === 'fiado'
      financeEntries.unshift({
        id: randomUUID(), organization_id: ORG_ID, kind: 'income', category, description, amount: r2(pay.amount), due_date: fiado ? (dueDate ?? addDays(date, 30)) : date,
        paid_at: fiado ? null : date, status: fiado ? 'pending' : 'paid', payment_method: pay.method, customer_id: purchase.customer_id, supplier: null,
        purchase_id: purchase.id, cash_session_id: pay.method === 'dinheiro' ? s?.id ?? null : null, notes: null, created_at: new Date().toISOString(),
        customers: purchase.customers,
      })
    }
  }

  function createSale({ customerId, date, items = [], services: svcLines = [], discount = 0, notes = null, channel, sessionId = null }) {
    const c = customers.find((x) => x.id === customerId)
    const id = randomUUID()
    const purchaseItems = items.map((it) => {
      const p = products.find((x) => x.id === it.product_id)
      const total = r2(it.quantity * (it.unit_price ?? p.price) - (it.discount ?? 0))
      if (p.track_stock) moveStock(p, 'venda', -it.quantity, null, null, id)
      return { id: randomUUID(), purchase_id: id, product_id: p.id, quantity: it.quantity, unit_price: it.unit_price ?? p.price, discount: it.discount ?? 0, total, products: { name: p.name, category: p.category } }
    })
    const purchaseServices = svcLines.map((it) => {
      const s = services.find((x) => x.id === it.service_id)
      const qty = it.quantity ?? 1
      return { id: randomUUID(), service_id: s.id, appointment_id: it.appointment_id ?? null, customer_package_id: it.customer_package_id ?? null, description: it.description ?? s.name, quantity: qty, unit_price: it.unit_price ?? s.price, discount: it.discount ?? 0, total: r2(qty * (it.unit_price ?? s.price) - (it.discount ?? 0)) }
    })
    const subtotal = r2([...purchaseItems, ...purchaseServices].reduce((t, x) => t + x.total, 0))
    const purchase = {
      id, organization_id: ORG_ID, customer_id: customerId ?? null, purchase_date: date, subtotal, discount, total: r2(subtotal - discount), notes,
      created_at: new Date().toISOString(), customers: c ? { full_name: c.full_name } : null, purchase_items: purchaseItems, purchase_services: purchaseServices,
      channel, cash_session_id: sessionId,
    }
    purchases.unshift(purchase)
    return purchase
  }

  // ---------- lembretes, consumo, segmentos ----------
  function reminders(days) {
    const out = []
    const until = addDays(today, days)
    for (const pe of pets.filter((p) => p.birth_date)) {
      const bday = `${today.slice(0, 4)}${pe.birth_date.slice(4)}`
      if (bday >= today && bday <= until) {
        const c = customers.find((x) => x.id === pe.customer_id)
        out.push({ key: `aniversario:${pe.id}:${bday.slice(0, 4)}`, kind: 'aniversario', due_date: bday, customer_id: c.id, customer_name: c.full_name, phone: c.phone_normalized, marketing_consent: c.marketing_consent, do_not_contact: c.do_not_contact, pet_name: pe.name, service_name: null, appointment_id: null, starts_at: null, detail: `${Number(bday.slice(0, 4)) - Number(pe.birth_date.slice(0, 4))} ano(s)` })
      }
    }
    for (const p of purchases.filter((x) => x.customer_id && ['registro', 'pdv'].includes(x.channel))) {
      const due = addDays(p.purchase_date, org.post_sale_days)
      if (due >= addDays(today, -7) && due <= today) {
        const c = customers.find((x) => x.id === p.customer_id)
        out.push({ key: `pos_venda:${p.id}`, kind: 'pos_venda', due_date: due, customer_id: c.id, customer_name: c.full_name, phone: c.phone_normalized, marketing_consent: c.marketing_consent, do_not_contact: c.do_not_contact, pet_name: pets.find((x) => x.customer_id === c.id)?.name ?? null, service_name: null, appointment_id: null, starts_at: null, detail: `Compra de ${p.purchase_date.slice(8, 10)}/${p.purchase_date.slice(5, 7)}` })
      }
    }
    for (const a of vAppointments().filter((x) => x.customer_id && ['scheduled', 'confirmed'].includes(x.status))) {
      const d = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(a.starts_at))
      if ((d === today || d === addDays(today, 1)) && Date.parse(a.starts_at) > Date.now()) {
        const c = customers.find((x) => x.id === a.customer_id)
        out.push({ key: `agenda:${a.id}`, kind: 'lembrete_agendamento', due_date: d, customer_id: c.id, customer_name: c.full_name, phone: c.phone_normalized, marketing_consent: c.marketing_consent, do_not_contact: c.do_not_contact, pet_name: a.pet_display_name, service_name: a.service_name, appointment_id: a.id, starts_at: a.starts_at, detail: null })
      }
    }
    const c1 = customers[1]
    out.push({ key: `retorno:${c1.id}:${services[0].id}:${addDays(today, -1)}`, kind: 'retorno_servico', due_date: addDays(today, -1), customer_id: c1.id, customer_name: c1.full_name, phone: c1.phone_normalized, marketing_consent: true, do_not_contact: false, pet_name: pets[1].name, service_name: services[0].name, appointment_id: null, starts_at: null, detail: 'Último há 16 dias' })
    for (const cp of customerPackages.filter((x) => x.status === 'active' && x.expires_at <= addDays(today, Math.max(days, 7)))) {
      const c = customers.find((x) => x.id === cp.customer_id)
      out.push({ key: `pacote:${cp.id}`, kind: 'pacote_vencendo', due_date: cp.expires_at, customer_id: c.id, customer_name: c.full_name, phone: c.phone_normalized, marketing_consent: c.marketing_consent, do_not_contact: c.do_not_contact, pet_name: pets.find((x) => x.id === cp.pet_id)?.name ?? null, service_name: cp.name, appointment_id: null, starts_at: null, detail: `${cp.sessions_total - cp.sessions_used} sessão(ões) restante(s)` })
    }
    const handled = new Set(contacts.map((c) => c.reminder_key).filter(Boolean))
    return out.filter((x) => !handled.has(x.key)).sort((a, b) => a.due_date.localeCompare(b.due_date))
  }

  function insights(customerId) {
    const ps = purchases.filter((p) => p.customer_id === customerId).sort((a, b) => a.purchase_date.localeCompare(b.purchase_date))
    const total = r2(ps.reduce((t, p) => t + p.total, 0))
    const first = ps[0]?.purchase_date ?? null
    const last = ps.at(-1)?.purchase_date ?? null
    const top = {}
    const cats = {}
    ps.forEach((p) => {
      p.purchase_items.forEach((it) => {
        top[it.products.name] ??= { name: it.products.name, quantity: 0, total: 0, times: 0 }
        top[it.products.name].quantity += it.quantity
        top[it.products.name].total = r2(top[it.products.name].total + it.total)
        top[it.products.name].times++
        cats[it.products.category] = r2((cats[it.products.category] ?? 0) + it.total)
      })
      p.purchase_services.forEach((s) => (cats.servicos = r2((cats.servicos ?? 0) + s.total)))
    })
    const monthly = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(today + 'T12:00:00Z')
      d.setUTCDate(1)
      d.setUTCMonth(d.getUTCMonth() - (11 - i))
      const m = d.toISOString().slice(0, 7)
      return { month: m, total: r2(ps.filter((p) => p.purchase_date.startsWith(m)).reduce((t, p) => t + p.total, 0)) }
    })
    const diffDays = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000)
    return {
      total_spent: total, purchases_count: ps.length, avg_ticket: ps.length ? r2(total / ps.length) : 0, first_purchase: first, last_purchase: last,
      days_since_last: last ? diffDays(today, last) : null, avg_interval_days: ps.length > 1 ? Math.round((diffDays(last, first) / (ps.length - 1)) * 10) / 10 : null,
      spent_12m: total, percentile_12m: ps.length ? 70 : null, services_count: appointments.filter((a) => a.customer_id === customerId && a.status === 'done').length,
      no_show_count: 0, receivable_open: r2(financeEntries.filter((e) => e.customer_id === customerId && e.status === 'pending' && e.kind === 'income').reduce((t, e) => t + e.amount, 0)),
      top_products: Object.values(top).sort((a, b) => b.total - a.total).slice(0, 5), by_category: cats, monthly,
      packages: customerPackages.filter((x) => x.customer_id === customerId),
    }
  }

  function segments() {
    const diffDays = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000)
    const list = customers.map((c) => {
      const ps = purchases.filter((p) => p.customer_id === c.id)
      const last = ps.map((p) => p.purchase_date).sort().at(-1) ?? null
      const firstD = ps.map((p) => p.purchase_date).sort()[0] ?? null
      const freq = ps.length
      const monetary = r2(ps.reduce((t, p) => t + p.total, 0))
      const rec = last ? diffDays(today, last) : null
      const segment = !last ? 'sem_compras' : freq === 1 && diffDays(today, firstD) <= 30 ? 'novo' : rec <= 30 && freq >= 4 ? 'campeao' : rec <= 60 && freq >= 2 ? 'fiel' : rec > 60 && rec <= 120 && freq >= 2 ? 'em_risco' : rec > 120 ? 'perdido' : 'ocasional'
      return { id: c.id, name: c.full_name, phone: c.phone, do_not_contact: c.do_not_contact, segment, recency: rec, frequency: freq, monetary, avg_ticket: freq ? r2(monetary / freq) : null }
    })
    const summary = {}
    list.forEach((c) => {
      summary[c.segment] ??= { count: 0, revenue: 0 }
      summary[c.segment].count++
      summary[c.segment].revenue = r2(summary[c.segment].revenue + c.monetary)
    })
    return { summary, customers: list.sort((a, b) => b.monetary - a.monetary) }
  }

  function stockOverview(horizon) {
    const tracked = products.filter((p) => p.active && p.track_stock)
    const rows = tracked.map((p) => {
      const sold = purchases.filter((x) => x.purchase_date > addDays(today, -90)).flatMap((x) => x.purchase_items).filter((i) => i.product_id === p.id).reduce((t, i) => t + i.quantity, 0)
      const preds = predictions.filter((x) => x.product_id === p.id && ['open', 'contacted'].includes(x.status) && x.expected_date <= addDays(today, horizon + p.lead_time_days))
      const predicted = preds.reduce((t, x) => t + x.quantity, 0)
      const avg = Math.round((sold / 90) * 1000) / 1000
      const forecast = Math.max(predicted, r2(avg * (horizon + p.lead_time_days)))
      const suggested = Math.max(0, Math.ceil(forecast + (p.min_stock ?? 0) - p.stock_qty))
      return {
        id: p.id, name: p.name, category: p.category, brand: p.brand, unit: p.unit, supplier: p.supplier, cost: p.cost, price: p.price, stock_qty: p.stock_qty,
        min_stock: p.min_stock, lead_time_days: p.lead_time_days, window_days: horizon + p.lead_time_days, avg_daily: avg, sold_90: sold, predicted_qty: predicted,
        predicted_customers: new Set(preds.map((x) => x.customer_id)).size, forecast, suggested_qty: suggested, suggested_cost: r2(suggested * (p.cost ?? 0)),
        coverage_days: avg > 0 ? Math.floor(Math.max(p.stock_qty, 0) / avg) : null, low_stock: p.stock_qty <= (p.min_stock ?? 0),
      }
    }).sort((a, b) => b.suggested_qty - a.suggested_qty)
    return {
      today, horizon_days: horizon, products: rows,
      totals: { tracked: tracked.length, low_stock: rows.filter((r) => r.low_stock).length, stock_value: r2(tracked.reduce((t, p) => t + Math.max(p.stock_qty, 0) * (p.cost ?? 0), 0)), stock_sale_value: r2(tracked.reduce((t, p) => t + Math.max(p.stock_qty, 0) * p.price, 0)) },
    }
  }

  function financeReport(from, to) {
    const ps = purchases.filter((p) => p.purchase_date >= from && p.purchase_date <= to)
    const revenue = r2(ps.reduce((t, p) => t + p.total, 0))
    const prod = r2(ps.flatMap((p) => p.purchase_items).reduce((t, i) => t + i.total, 0))
    const cmv = r2(ps.flatMap((p) => p.purchase_items).reduce((t, i) => t + i.quantity * (products.find((x) => x.id === i.product_id)?.cost ?? 0), 0))
    const paid = (k) => financeEntries.filter((e) => e.kind === k && e.status === 'paid' && e.paid_at >= from && e.paid_at <= to)
    const pend = (k) => financeEntries.filter((e) => e.kind === k && e.status === 'pending')
    const sum = (l) => r2(l.reduce((t, e) => t + e.amount, 0))
    const group = (l, key) => l.reduce((acc, e) => ({ ...acc, [e[key] ?? 'nao_informado']: r2((acc[e[key] ?? 'nao_informado'] ?? 0) + e.amount) }), {})
    const days = []
    for (let d = from; d <= to; d = addDays(d, 1)) days.push(d)
    return {
      revenue, sales_count: ps.length, avg_ticket: ps.length ? r2(revenue / ps.length) : 0, products_revenue: prod,
      services_revenue: r2(ps.flatMap((p) => p.purchase_services).reduce((t, s) => t + s.total, 0)), discounts: r2(ps.reduce((t, p) => t + p.discount, 0)),
      products_cost: cmv, products_cost_missing: 0, gross_profit: r2(revenue - cmv), received: sum(paid('income')), paid_expenses: sum(paid('expense')),
      receivable_open: sum(pend('income')), receivable_overdue: sum(pend('income').filter((e) => e.due_date < today)),
      payable_open: sum(pend('expense')), payable_overdue: sum(pend('expense').filter((e) => e.due_date < today)),
      payable_next7: sum(pend('expense').filter((e) => e.due_date >= today && e.due_date <= addDays(today, 7))),
      by_method: group(paid('income'), 'payment_method'), expenses_by_category: group(paid('expense'), 'category'),
      series: days.map((d) => ({ date: d, revenue: r2(purchases.filter((p) => p.purchase_date === d).reduce((t, p) => t + p.total, 0)), received: sum(financeEntries.filter((e) => e.kind === 'income' && e.status === 'paid' && e.paid_at === d)), expenses: sum(financeEntries.filter((e) => e.kind === 'expense' && e.status === 'paid' && e.paid_at === d)) })),
    }
  }

  const integration = { whatsapp_enabled: false, whatsapp_phone_number_id: null, whatsapp_has_token: false, whatsapp_templates: {}, whatsapp_auto_kinds: [], whatsapp_last_run_at: null, fiscal_enabled: false, fiscal_environment: 'homologacao', fiscal_has_token: false, fiscal_cnpj: null, fiscal_ie: null, fiscal_im: null, fiscal_city_code: null, fiscal_simples: true, fiscal_icms_situation: '102', fiscal_service_item: '05.08', fiscal_municipal_tax_code: null, fiscal_iss_rate: null, dispatches_30d: { sent: 0, failed: 0 } }

  // ---------- RPCs ----------
  const rpc = {
    stock_overview: (b) => stockOverview(b.p_horizon_days ?? 30),
    stock_adjust: (b) => {
      const p = products.find((x) => x.id === b.p_product)
      if (!p) throw err('PRODUCT_NOT_FOUND')
      const q = Number(b.p_quantity)
      const delta = b.p_kind === 'entrada' ? q : b.p_kind === 'perda' ? -q : b.p_kind === 'inventario' ? q - p.stock_qty : q
      p.track_stock = true
      if (delta !== 0) moveStock(p, b.p_kind, delta, b.p_notes, b.p_unit_cost)
      if (b.p_update_cost && b.p_unit_cost != null) p.cost = b.p_unit_cost
      return p.stock_qty
    },
    cash_session_summary: () => {
      const s = openSession()
      if (!s) return null
      const sales = purchases.filter((p) => p.cash_session_id === s.id)
      const byMethod = financeEntries.filter((e) => sales.some((p) => p.id === e.purchase_id)).reduce((acc, e) => ({ ...acc, [e.payment_method]: r2((acc[e.payment_method] ?? 0) + e.amount) }), {})
      return { session: s, expected_cash: expectedCash(s), sales_count: sales.length, sales_total: r2(sales.reduce((t, p) => t + p.total, 0)), by_method: byMethod, movements: cashMovements.filter((m) => m.session_id === s.id), settled_cash: 0 }
    },
    open_cash_session: (b) => {
      if (openSession()) throw err('CASH_SESSION_ALREADY_OPEN')
      const s = { id: randomUUID(), organization_id: ORG_ID, status: 'open', opening_amount: Number(b.p_opening ?? 0), opened_by: null, opened_at: new Date().toISOString(), expected_amount: null, counted_amount: null, closed_by: null, closed_at: null, notes: b.p_notes }
      cashSessions.unshift(s)
      return s.id
    },
    cash_movement: (b) => {
      const s = openSession()
      if (!s) throw err('CASH_SESSION_REQUIRED')
      cashMovements.push({ id: randomUUID(), session_id: s.id, kind: b.p_kind, amount: Number(b.p_amount), notes: b.p_notes, created_at: new Date().toISOString() })
      return randomUUID()
    },
    close_cash_session: (b) => {
      const s = openSession()
      if (!s) throw err('CASH_SESSION_REQUIRED')
      const expected = expectedCash(s)
      Object.assign(s, { status: 'closed', expected_amount: expected, counted_amount: Number(b.p_counted), closed_at: new Date().toISOString() })
      return { expected, counted: Number(b.p_counted), difference: r2(Number(b.p_counted) - expected) }
    },
    pdv_checkout: (b) => {
      const s = openSession()
      if (!s) throw err('CASH_SESSION_REQUIRED')
      const sale = createSale({ customerId: b.p_customer, date: today, items: b.p_items ?? [], services: b.p_services ?? [], discount: Number(b.p_discount ?? 0), notes: b.p_notes, channel: 'pdv', sessionId: s.id })
      const paid = r2((b.p_payments ?? []).reduce((t, p) => t + p.amount, 0))
      if (Math.abs(paid - sale.total) > 0.01) { purchases.shift(); throw err('PAYMENT_MISMATCH') }
      recordPayments(sale, b.p_payments, today, b.p_due_date, (b.p_items ?? []).length ? 'venda_produtos' : 'servicos', 'Venda no caixa')
      return sale.id
    },
    finance_report: (b) => financeReport(b.p_from, b.p_to),
    save_finance_entry: (b) => {
      const row = { kind: b.p_kind, category: b.p_category, description: b.p_description, amount: Number(b.p_amount), due_date: b.p_due_date, paid_at: b.p_paid ? (b.p_paid_at ?? today) : null, status: b.p_paid ? 'paid' : 'pending', payment_method: b.p_method, customer_id: b.p_customer, supplier: b.p_supplier, notes: b.p_notes }
      const existing = financeEntries.find((e) => e.id === b.p_id)
      if (existing) Object.assign(existing, row)
      else financeEntries.unshift({ id: randomUUID(), organization_id: ORG_ID, purchase_id: null, cash_session_id: null, created_at: new Date().toISOString(), customers: null, ...row })
      return existing?.id ?? financeEntries[0].id
    },
    settle_finance_entry: (b) => { Object.assign(financeEntries.find((e) => e.id === b.p_id), { status: 'paid', paid_at: b.p_paid_at ?? today, payment_method: b.p_method }); return null },
    cancel_finance_entry: (b) => { Object.assign(financeEntries.find((e) => e.id === b.p_id), { status: 'canceled', paid_at: null }); return null },
    get_reminders: (b) => reminders(b.p_days_ahead ?? 7),
    log_reminder_contact: (b) => {
      const c = customers.find((x) => x.id === b.p_customer)
      contacts.unshift({ id: randomUUID(), organization_id: ORG_ID, customer_id: c.id, prediction_id: null, template_id: b.p_template, channel: 'whatsapp_link', message: b.p_message, result: b.p_result, follow_up_date: null, notes: b.p_notes, user_id: null, contacted_at: new Date().toISOString(), customers: { full_name: c.full_name }, reminder_key: b.p_key })
      if (b.p_key.startsWith('agenda:') && ['respondeu', 'comprou'].includes(b.p_result)) {
        const a = appointments.find((x) => x.id === b.p_key.slice(7))
        if (a?.status === 'scheduled') a.status = 'confirmed'
      }
      return randomUUID()
    },
    customer_insights: (b) => insights(b.p_customer),
    customer_segments: () => segments(),
    save_appointment: (b) => {
      const svc = services.find((x) => x.id === b.p_service)
      if (!svc) throw err('SERVICE_NOT_FOUND')
      const ends = new Date(Date.parse(b.p_starts_at) + (b.p_duration_minutes ?? svc.duration_minutes) * 60000).toISOString()
      if (b.p_professional && appointments.some((a) => a.id !== b.p_id && a.professional_id === b.p_professional && !['canceled', 'no_show'].includes(a.status) && a.starts_at < ends && a.ends_at > b.p_starts_at)) throw err('SCHEDULE_CONFLICT')
      const row = { customer_id: b.p_customer, pet_id: b.p_pet, service_id: svc.id, professional_id: b.p_professional, starts_at: new Date(b.p_starts_at).toISOString(), ends_at: ends, price: b.p_customer_package ? 0 : (b.p_price ?? svc.price), customer_package_id: b.p_customer_package, notes: b.p_notes }
      const existing = appointments.find((a) => a.id === b.p_id)
      if (existing) Object.assign(existing, row, { status: existing.status === 'requested' ? 'scheduled' : existing.status })
      else appointments.push({ id: randomUUID(), organization_id: ORG_ID, status: 'scheduled', source: 'painel', requester_name: null, requester_phone: null, pet_name: null, cancel_reason: null, completed_at: null, created_at: new Date().toISOString(), ...row })
      return existing?.id ?? appointments.at(-1).id
    },
    set_appointment_status: (b) => { Object.assign(appointments.find((a) => a.id === b.p_id), { status: b.p_status, cancel_reason: b.p_reason ?? null }); return null },
    complete_appointment: (b) => {
      const a = appointments.find((x) => x.id === b.p_id)
      let saleId = null
      if (a.customer_package_id) {
        const cp = customerPackages.find((x) => x.id === a.customer_package_id)
        cp.sessions_used++
        if (cp.sessions_used >= cp.sessions_total) cp.status = 'finished'
      } else if (a.price > 0) {
        const date = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(a.starts_at))
        const sale = createSale({ customerId: a.customer_id, date, services: [{ service_id: a.service_id, unit_price: a.price, appointment_id: a.id }], channel: 'agenda', sessionId: openSession()?.id ?? null })
        recordPayments(sale, b.p_payments, date, b.p_due_date, 'servicos', 'Atendimento')
        saleId = sale.id
      }
      Object.assign(a, { status: 'done', completed_at: new Date().toISOString() })
      return saleId
    },
    sell_package: (b) => {
      const pkg = servicePackages.find((x) => x.id === b.p_package)
      const cp = { id: randomUUID(), organization_id: ORG_ID, customer_id: b.p_customer, pet_id: b.p_pet, package_id: pkg.id, service_id: pkg.service_id, name: pkg.name, sessions_total: pkg.sessions, sessions_used: 0, price_paid: pkg.price, purchased_at: today, expires_at: addDays(today, pkg.validity_days), status: 'active', created_at: new Date().toISOString() }
      customerPackages.unshift(cp)
      const sale = createSale({ customerId: b.p_customer, date: today, services: [{ service_id: pkg.service_id, unit_price: pkg.price, customer_package_id: cp.id, description: `Pacote: ${pkg.name}` }], channel: 'pacote', sessionId: openSession()?.id ?? null })
      recordPayments(sale, b.p_payments, today, b.p_due_date, 'pacotes', `Pacote: ${pkg.name}`)
      return cp.id
    },
    cancel_customer_package: (b) => { customerPackages.find((x) => x.id === b.p_id).status = 'canceled'; return null },
    get_integration_settings: () => integration,
    save_whatsapp_settings: (b) => { Object.assign(integration, { whatsapp_phone_number_id: b.p_phone_number_id || null, whatsapp_has_token: integration.whatsapp_has_token || !!b.p_token, whatsapp_templates: b.p_templates, whatsapp_auto_kinds: b.p_auto_kinds }); if (b.p_enabled && !(integration.whatsapp_phone_number_id && integration.whatsapp_has_token)) throw err('INTEGRATION_INCOMPLETE'); integration.whatsapp_enabled = !!b.p_enabled; return null },
    save_fiscal_settings: (b) => { Object.assign(integration, { fiscal_environment: b.p_environment, fiscal_has_token: integration.fiscal_has_token || !!b.p_token, fiscal_cnpj: b.p_cnpj || null, fiscal_im: b.p_im || null, fiscal_city_code: b.p_city_code || null }); if (b.p_enabled && !(integration.fiscal_has_token && integration.fiscal_cnpj)) throw err('INTEGRATION_INCOMPLETE'); integration.fiscal_enabled = !!b.p_enabled; return null },
  }

  // ---------- Edge Functions ----------
  function publicStore() {
    return {
      name: org.name, description: org.public_description, whatsapp: org.public_whatsapp, address: org.address, city: org.city, state: org.state, logo_path: null,
      catalog_enabled: org.catalog_enabled, booking_enabled: org.booking_enabled, show_prices: org.show_prices, business_hours: org.business_hours,
      booking_days_ahead: org.booking_days_ahead, today,
      products: products.filter((p) => p.active && p.catalog_visible).map((p) => ({ id: p.id, name: p.name, category: p.category, brand: p.brand, price: p.price, size_value: p.size_value, unit: p.unit, description: p.description, available: p.track_stock ? p.stock_qty > 0 : null })),
      services: services.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, category: s.category, price: s.price, duration_minutes: s.duration_minutes, description: s.description, bookable: org.booking_enabled && s.bookable_online })),
    }
  }
  function publicSlots(serviceId, date) {
    const svc = services.find((s) => s.id === serviceId)
    const hours = org.business_hours[String(new Date(date + 'T12:00:00Z').getUTCDay())]
    if (!svc || !hours) return []
    const out = []
    const toMin = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))
    for (let m = toMin(hours[0]); m + svc.duration_minutes <= toMin(hours[1]); m += org.slot_minutes) {
      const hm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
      const starts = at(date, hm)
      const ends = new Date(Date.parse(starts) + svc.duration_minutes * 60000).toISOString()
      if (Date.parse(starts) < Date.now() + org.booking_min_notice_hours * 3600000) continue
      const free = professionals.some((p) => !appointments.some((a) => a.professional_id === p.id && !['canceled', 'no_show'].includes(a.status) && a.starts_at < ends && a.ends_at > starts))
      if (free) out.push(hm)
    }
    return out
  }
  function functions(path, method, url, body) {
    if (path === '/functions/v1/public-store') {
      if (method === 'GET') {
        if (url.searchParams.get('slug') !== org.public_slug) return [404, { error: 'NOT_FOUND' }]
        if (url.searchParams.get('service')) return [200, { slots: publicSlots(url.searchParams.get('service'), url.searchParams.get('date')) }]
        return [200, publicStore()]
      }
      const svc = services.find((s) => s.id === body?.service_id)
      if (!svc) return [400, { error: 'SERVICE_NOT_FOUND' }]
      if (!publicSlots(svc.id, body.date).includes(body.time)) return [400, { error: 'SLOT_UNAVAILABLE' }]
      appointments.push(mkAppt(null, services.indexOf(svc), 0, body.date, body.time, 'requested', { source: 'online', requester_name: body.name, requester_phone: '55' + String(body.phone).replace(/\D/g, ''), pet_name: body.pet_name || null, notes: body.notes || null }))
      return [200, { ok: true, booking: { service: svc.name, date: body.date, time: body.time } }]
    }
    if (path === '/functions/v1/whatsapp-dispatch') return [200, { ok: true, sent: 0, failed: 0, skipped: 0 }]
    if (path === '/functions/v1/fiscal-invoice') return [400, { error: 'FISCAL_NOT_CONFIGURED' }]
    return null
  }

  const tables = {
    services: () => services, professionals: () => professionals,
    service_packages: () => servicePackages.map((p) => ({ ...p, services: { name: services.find((s) => s.id === p.service_id)?.name } })),
    customer_packages: () => customerPackages, v_appointments: vAppointments, appointments: () => appointments,
    stock_movements: () => stockMovements, cash_sessions: () => cashSessions, finance_entries: () => financeEntries, invoices: () => [],
    purchase_services: () => purchases.flatMap((p) => p.purchase_services),
  }
  const writable = { services, professionals, service_packages: servicePackages }
  const writeDefaults = {
    services: { active: true, catalog_visible: true, bookable_online: true, return_days: null, description: null },
    professionals: { active: true, color: '#22c58b', work_days: [1, 2, 3, 4, 5, 6], work_start: '08:00', work_end: '18:00' },
    service_packages: { active: true },
  }
  const ctxExtra = () => ({ integrations: { fiscal: integration.fiscal_enabled, whatsapp: integration.whatsapp_enabled } })
  return { rpc, tables, writable, writeDefaults, functions, ctxExtra }
}
