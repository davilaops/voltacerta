/**
 * Dados e RPCs do painel Super Admin para o MODO DEMONSTRAÇÃO.
 * Somente para visualização local — não aplica nenhuma regra real.
 */
import { randomUUID } from 'node:crypto'

export const plans = [
  { id: 'inicial', name: 'Inicial', price_cents: 3990, currency: 'BRL', customer_limit: 100, features: { reports_full: false, history_advanced: false, reports_advanced: false }, highlights: ['Cadastro de produtos', 'Previsão de recompra', 'WhatsApp por link', 'Dashboard básico'], sort_order: 1, highlight: false, active: true },
  { id: 'profissional', name: 'Profissional', price_cents: 6990, currency: 'BRL', customer_limit: 500, features: { reports_full: true, history_advanced: true, reports_advanced: false }, highlights: ['Todas as funcionalidades', 'Relatórios completos', 'Histórico avançado'], sort_order: 2, highlight: true, active: true },
  { id: 'premium', name: 'Premium', price_cents: 27990, currency: 'BRL', customer_limit: null, features: { reports_full: true, history_advanced: true, reports_advanced: true }, highlights: ['Todas as funcionalidades', 'Relatórios avançados', 'Recursos futuros de automação'], sort_order: 3, highlight: false, active: true },
]

export function createAdminDemo({ today, addDays, ts, mainOrg, mainUser, customersCount }) {
  const iso = (d, h = 10) => ts(d, h)
  const effective = (s) => (s.status === 'trialing' && s.trial_ends_at < new Date().toISOString() ? 'expired' : s.status)

  const users = [
    { id: mainUser.id, email: mainUser.email, full_name: 'Rafael Moreira', created_at: iso(addDays(today, -60)), last_sign_in_at: new Date().toISOString(), email_confirmed_at: iso(addDays(today, -60)), blocked_at: null, blocked_reason: null, super_admin: true },
  ]
  const orgs = [
    { ...mainOrg, sub: { plan: 'profissional', status: 'trialing', trial_started_at: iso(addDays(today, -5)), trial_ends_at: iso(addDays(today, 9)), current_period_start: null, current_period_end: null, provider: null }, customers: customersCount, members: [{ user_id: mainUser.id, role: 'owner' }] },
  ]
  const extra = [
    ['Casa do Pet Bauru', 'Bauru', 'SP', 'premium', 'active', -48, 'Larissa Prado'],
    ['Mundo Animal Express', 'Curitiba', 'PR', 'profissional', 'active', -40, 'Thiago Nunes'],
    ['Agropet Serra Verde', 'Uberlândia', 'MG', 'inicial', 'past_due', -35, 'Marcos Teixeira'],
    ['Pet Shop Patinhas', 'Recife', 'PE', 'profissional', 'trialing', -20, 'Joana Lima'],
    ['Bicho Feliz', 'Goiânia', 'GO', 'inicial', 'trialing', -30, 'Renato Alves'],
    ['Rações do Zé', 'Londrina', 'PR', 'inicial', 'canceled', -55, 'José Ferreira'],
    ['Vet & Cia Delivery', 'Porto Alegre', 'RS', 'profissional', 'trialing', -3, 'Paula Rocha'],
  ]
  const payments = []
  extra.forEach(([name, city, state, plan, status, ago, owner], i) => {
    const id = `30000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    const uid = `40000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    const email = owner.split(' ')[0].toLowerCase() + '@' + name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 12) + '.com.br'
    users.push({ id: uid, email, full_name: owner, created_at: iso(addDays(today, ago), 9 + i), last_sign_in_at: iso(addDays(today, -i), 14), email_confirmed_at: iso(addDays(today, ago)), blocked_at: null, blocked_reason: null, super_admin: false })
    const trialEnd = status === 'trialing' ? (i === 4 ? addDays(today, -2) : addDays(today, 14 + ago)) : addDays(today, ago + 14)
    orgs.push({
      id, name, owner_name: owner, phone: null, city, state, business_type: 'pet_shop', created_at: iso(addDays(today, ago), 9 + i), onboarding_completed: true,
      suspended_at: null, suspended_reason: null,
      sub: { plan, status, trial_started_at: iso(addDays(today, ago)), trial_ends_at: iso(trialEnd), current_period_start: status === 'active' ? iso(addDays(today, -12)) : null, current_period_end: ['active', 'past_due'].includes(status) ? iso(addDays(today, status === 'active' ? 18 : -3)) : null, provider: ['active', 'past_due', 'canceled'].includes(status) ? 'abacatepay' : null },
      customers: 20 + i * 17, members: [{ user_id: uid, role: 'owner' }],
    })
    if (status === 'active') {
      const price = plans.find((p) => p.id === plan).price_cents
      payments.push({ id: randomUUID(), organization_id: id, organization_name: name, provider: 'abacatepay', provider_payment_id: `bill_demo_${i}`, plan, amount_cents: price, currency: 'BRL', status: 'paid', paid_at: iso(addDays(today, -12)), period_start: iso(addDays(today, -12)), period_end: iso(addDays(today, 18)), created_at: iso(addDays(today, -12)) })
    }
    if (status === 'past_due') {
      payments.push({ id: randomUUID(), organization_id: id, organization_name: name, provider: 'abacatepay', provider_payment_id: `bill_demo_${i}`, plan, amount_cents: 3990, currency: 'BRL', status: 'failed', paid_at: null, period_start: null, period_end: null, created_at: iso(addDays(today, -3)) })
    }
  })
  const audit = [{ id: 1, actor_id: null, actor_email: 'system:cli', action: 'promote_super_admin', target_type: 'user', target_id: mainUser.id, reason: 'Promoção via procedimento de backend', details: { email: mainUser.email }, created_at: iso(addDays(today, -59)) }]
  let auditSeq = 2
  const log = (action, target_type, target_id, reason, details = {}) =>
    audit.unshift({ id: auditSeq++, actor_id: mainUser.id, actor_email: mainUser.email, action, target_type, target_id, reason, details, created_at: new Date().toISOString() })

  const orgRow = (o) => ({
    id: o.id, name: o.name, city: o.city, state: o.state, created_at: o.created_at, suspended_at: o.suspended_at, suspended_reason: o.suspended_reason,
    plan: o.sub.plan, status: o.sub.status, effective_status: effective(o.sub), trial_ends_at: o.sub.trial_ends_at, current_period_end: o.sub.current_period_end,
    members: o.members.length, customers: o.customers, owner_email: users.find((u) => u.id === o.members[0].user_id)?.email ?? null,
  })
  const userRow = (u) => ({ ...u, organizations: orgs.filter((o) => o.members.some((m) => m.user_id === u.id)).map((o) => ({ id: o.id, name: o.name, role: o.members.find((m) => m.user_id === u.id).role })) })
  const page = (rows, b) => ({ total: rows.length, rows: rows.slice(b.p_offset ?? 0, (b.p_offset ?? 0) + (b.p_limit ?? 25)) })
  const reason = (r) => {
    if (!r || r.trim().length < 5) throw Object.assign(new Error('REASON_REQUIRED'), { status: 400 })
    return r.trim()
  }
  const find = (id) => {
    const o = orgs.find((x) => x.id === id)
    if (!o) throw Object.assign(new Error('NOT_FOUND'), { status: 404 })
    return o
  }

  const rpc = {
    get_account_status: () => ({ authenticated: true, blocked: false, blocked_reason: null, super_admin: true }),
    admin_overview: (b) => {
      const days = []
      for (let d = b.p_from; d <= b.p_to; d = addDays(d, 1)) days.push(d)
      const eff = orgs.map((o) => effective(o.sub))
      return {
        organizations_total: orgs.length, organizations_suspended: orgs.filter((o) => o.suspended_at).length,
        users_total: users.length, users_blocked: users.filter((u) => u.blocked_at).length,
        subscriptions_active: eff.filter((s) => s === 'active').length, trials_active: eff.filter((s) => s === 'trialing').length,
        trials_ended: orgs.filter((o) => ['trialing', 'expired'].includes(o.sub.status) && effective(o.sub) === 'expired').length,
        subscriptions_past_due: eff.filter((s) => s === 'past_due').length, subscriptions_canceled: eff.filter((s) => s === 'canceled').length,
        mrr_received_cents: payments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount_cents, 0),
        signups: days.map((d) => ({ date: d, organizations: orgs.filter((o) => o.created_at.slice(0, 10) === d).length, users: users.filter((u) => u.created_at.slice(0, 10) === d).length })),
      }
    },
    admin_list_organizations: (b) => {
      const s = (b.p_search ?? '').toLowerCase()
      let rows = orgs.map(orgRow).filter((o) => !s || o.name.toLowerCase().includes(s) || (o.owner_email ?? '').includes(s) || (o.city ?? '').toLowerCase().includes(s))
      if (b.p_status === 'suspended') rows = rows.filter((o) => o.suspended_at)
      else if (b.p_status) rows = rows.filter((o) => o.effective_status === b.p_status)
      return page(rows.sort((a, c) => c.created_at.localeCompare(a.created_at)), b)
    },
    admin_get_organization: (b) => {
      const o = find(b.p_org)
      return {
        organization: { id: o.id, name: o.name, owner_name: o.owner_name, phone: o.phone, city: o.city, state: o.state, business_type: o.business_type, created_at: o.created_at, onboarding_completed: true, suspended_at: o.suspended_at, suspended_reason: o.suspended_reason },
        subscription: { ...o.sub, effective_status: effective(o.sub) },
        members: o.members.map((m) => { const u = users.find((x) => x.id === m.user_id); return { ...m, email: u.email, full_name: u.full_name, created_at: u.created_at, blocked_at: u.blocked_at } }),
        counts: { customers: o.customers, products: 8, purchases: o.customers * 2, contacts: Math.round(o.customers / 2) },
        payments: payments.filter((p) => p.organization_id === o.id),
        audit: audit.filter((a) => a.target_id === o.id),
      }
    },
    admin_suspend_organization: (b) => { const r = reason(b.p_reason); const o = find(b.p_org); o.suspended_at = new Date().toISOString(); o.suspended_reason = r; log('suspend_organization', 'organization', o.id, r) },
    admin_reactivate_organization: (b) => { const r = reason(b.p_reason); const o = find(b.p_org); o.suspended_at = null; o.suspended_reason = null; log('reactivate_organization', 'organization', o.id, r) },
    admin_grant_trial: (b) => {
      const r = reason(b.p_reason); const o = find(b.p_org)
      if (o.sub.status === 'active') throw Object.assign(new Error('SUBSCRIPTION_ALREADY_ACTIVE'), { status: 400 })
      o.sub.status = 'trialing'; o.sub.trial_started_at = new Date().toISOString(); o.sub.trial_ends_at = iso(addDays(today, Number(b.p_days)))
      log('grant_trial', 'subscription', o.id, r, { days: b.p_days })
    },
    admin_change_plan: (b) => { const r = reason(b.p_reason); const o = find(b.p_org); const from = o.sub.plan; o.sub.plan = b.p_plan; log('change_plan', 'subscription', o.id, r, { from, to: b.p_plan }) },
    admin_list_users: (b) => {
      const s = (b.p_search ?? '').toLowerCase()
      return page(users.filter((u) => !s || u.email.includes(s) || (u.full_name ?? '').toLowerCase().includes(s)).map(userRow).sort((a, c) => c.created_at.localeCompare(a.created_at)), b)
    },
    admin_block_user: (b) => { const r = reason(b.p_reason); const u = users.find((x) => x.id === b.p_user); u.blocked_at = new Date().toISOString(); u.blocked_reason = r; log('block_user', 'user', u.id, r) },
    admin_unblock_user: (b) => { const r = reason(b.p_reason); const u = users.find((x) => x.id === b.p_user); u.blocked_at = null; u.blocked_reason = null; log('unblock_user', 'user', u.id, r) },
    admin_list_payments: (b) => page(payments.filter((p) => !b.p_org || p.organization_id === b.p_org), b),
    admin_list_audit: (b) => page(audit, b),
    admin_update_plan: (b) => {
      const r = reason(b.p_reason); const p = plans.find((x) => x.id === b.p_plan)
      log('update_plan', 'plan', p.id, r, { price_cents: { from: p.price_cents, to: b.p_price_cents } })
      p.price_cents = b.p_price_cents; p.customer_limit = b.p_customer_limit
    },
  }
  return { rpc }
}
