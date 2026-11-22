// Tipos de domínio espelhando as tabelas/views do Supabase (ver supabase/migrations).

export type MemberRole = 'owner' | 'admin' | 'employee'
export type PlanTier = 'inicial' | 'profissional' | 'premium'
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'
export type PredictionStatus = 'open' | 'contacted' | 'completed' | 'ignored'
export type PredictionStage = 'prevista' | 'proxima' | 'hoje' | 'atrasada' | 'contatada' | 'concluida' | 'ignorada'
export type ContactResult = 'respondeu' | 'nao_respondeu' | 'comprou' | 'sem_interesse' | 'retornar_depois'
/** Texto livre (os códigos antigos de pet shop continuam válidos). */
export type ProductCategory = string
export type ProductUnit = 'kg' | 'g' | 'l' | 'ml' | 'un' | 'cx' | 'pct'
export type Species = 'cao' | 'gato' | 'ave' | 'roedor' | 'peixe' | 'reptil' | 'outro'
export type CustomerSituation = 'sem_compras' | 'precisa_contato' | 'proxima' | 'em_dia' | 'inativo'
/** Código do ramo (ver src/domain/business.ts). */
export type BusinessType = string

export interface Organization {
  id: string
  name: string
  owner_name: string | null
  phone: string | null
  address: string | null
  city: string | null
  state: string | null
  business_type: BusinessType | null
  logo_path: string | null
  timezone: string
  soon_days: number
  overdue_after_days: number
  lost_after_days: number
  default_duration_days: number
  history_min_intervals: number
  history_max_weight: number
  attribution_days: number
  onboarding_completed: boolean
  created_at: string
  // Agenda, loja online e lembretes (0013–0016)
  business_hours: BusinessHours
  slot_minutes: number
  public_slug: string | null
  catalog_enabled: boolean
  booking_enabled: boolean
  show_prices: boolean
  public_whatsapp: string | null
  public_description: string | null
  booking_min_notice_hours: number
  booking_days_ahead: number
  post_sale_days: number
}

/** 0 = domingo … 6 = sábado; null = fechado. */
export type BusinessHours = Record<string, [string, string] | null>

export interface OrgContext {
  role: MemberRole
  plan: PlanTier
  status: SubscriptionStatus
  effective_status: SubscriptionStatus
  trial_ends_at: string | null
  current_period_end: string | null
  can_write: boolean
  suspended: boolean
  suspended_reason: string | null
  trial_started_at: string | null
  customer_limit: number | null
  customer_count: number
  features: { reports_full: boolean; history_advanced: boolean; reports_advanced: boolean }
  integrations?: { fiscal: boolean; whatsapp: boolean }
  today: string
}

export interface Customer {
  id: string
  organization_id: string
  full_name: string
  phone: string | null
  phone_normalized: string | null
  email: string | null
  notes: string | null
  marketing_consent: boolean
  consent_updated_at: string | null
  do_not_contact: boolean
  do_not_contact_at: string | null
  created_at: string
  updated_at: string
}

export interface CustomerView extends Customer {
  pet_names: string
  pet_count: number
  purchases_count: number
  total_spent: number
  last_purchase_date: string | null
  last_product_name: string | null
  next_expected_date: string | null
  situation: CustomerSituation
}

export interface Pet {
  id: string
  organization_id: string
  customer_id: string
  name: string
  species: Species
  breed: string | null
  birth_date: string | null
  notes: string | null
  created_at: string
}

export interface Product {
  id: string
  organization_id: string
  name: string
  category: ProductCategory
  brand: string | null
  sku: string | null
  price: number
  cost: number | null
  size_value: number | null
  unit: ProductUnit
  description: string | null
  avg_duration_days: number | null
  active: boolean
  created_at: string
  track_stock: boolean
  stock_qty: number
  min_stock: number | null
  supplier: string | null
  lead_time_days: number
  catalog_visible: boolean
  ncm: string | null
  cfop: string
  fiscal_origin: number
}

export interface PurchaseItem {
  id: string
  purchase_id: string
  product_id: string
  quantity: number
  unit_price: number
  discount: number
  total: number
  products?: { name: string; category: ProductCategory } | null
}

export type SaleChannel = 'registro' | 'pdv' | 'agenda' | 'pacote'

export interface PurchaseServiceLine {
  id: string
  service_id: string
  appointment_id: string | null
  customer_package_id: string | null
  description: string | null
  quantity: number
  unit_price: number
  discount: number
  total: number
}

export interface Purchase {
  id: string
  organization_id: string
  customer_id: string | null
  channel: SaleChannel
  cash_session_id: string | null
  purchase_services?: PurchaseServiceLine[]
  purchase_date: string
  subtotal: number
  discount: number
  total: number
  notes: string | null
  created_at: string
  customers?: { full_name: string } | null
  purchase_items?: PurchaseItem[]
}

export interface PredictionView {
  id: string
  organization_id: string
  customer_id: string
  product_id: string
  source_purchase_id: string
  expected_date: string
  quantity: number
  expected_days: number
  base_days: number
  history_days: number | null
  history_samples: number
  potential_value: number
  status: PredictionStatus
  contacted_at: string | null
  completed_at: string | null
  recovered: boolean
  recovered_amount: number
  customer_name: string
  customer_phone: string | null
  customer_phone_normalized: string | null
  customer_do_not_contact: boolean
  product_name: string
  product_category: ProductCategory
  product_price: number
  last_purchase_date: string
  pet_name: string | null
  days_until: number
  stage: PredictionStage
  is_lost: boolean
}

export interface ContactLog {
  id: string
  customer_id: string
  prediction_id: string | null
  template_id: string | null
  channel: string
  message: string | null
  result: ContactResult
  follow_up_date: string | null
  notes: string | null
  user_id: string | null
  contacted_at: string
  profiles?: { full_name: string | null; email: string | null } | null
}

export interface MessageTemplate {
  id: string
  organization_id: string
  name: string
  kind: TemplateKind
  body: string
  is_default: boolean
  created_at: string
}

export interface Member {
  organization_id: string
  user_id: string
  role: MemberRole
  created_at: string
  profiles: { full_name: string | null; email: string | null } | null
}

export interface Invitation {
  id: string
  email: string
  role: MemberRole
  created_at: string
}

export interface DashboardMetrics {
  customers_total: number
  customers_new: number
  predictions_upcoming: number
  contact_today: number
  recovered_sales: number
  recovered_revenue: number
  repurchase_rate: number | null
  repurchase_due: number
  repurchase_done: number
  series: { date: string; recovered_sales: number; recovered_revenue: number; customers_total: number }[]
  pipeline: Record<'prevista' | 'proxima' | 'hoje' | 'atrasada' | 'contatada', number>
  situations: Partial<Record<CustomerSituation, number>>
  activity: {
    type: 'purchase' | 'contact' | 'customer'
    at: string
    customer_name: string
    customer_id: string
    amount: number | null
    detail: string | null
  }[]
}

export type TemplateKind =
  | 'reposicao' | 'atrasado' | 'recompra' | 'custom'
  | 'aniversario' | 'pos_venda' | 'lembrete_agendamento' | 'retorno_servico' | 'pacote_vencendo'

// ---------------------------------------------------------------------
// Estoque
// ---------------------------------------------------------------------
export type StockKind = 'entrada' | 'venda' | 'estorno_venda' | 'ajuste' | 'perda' | 'inventario'

export interface StockMovement {
  id: string
  product_id: string
  kind: StockKind
  quantity: number
  balance_after: number
  unit_cost: number | null
  purchase_id: string | null
  notes: string | null
  created_at: string
  products?: { name: string; unit: ProductUnit } | null
}

export interface StockRow {
  id: string
  name: string
  category: ProductCategory
  brand: string | null
  unit: ProductUnit
  supplier: string | null
  cost: number | null
  price: number
  stock_qty: number
  min_stock: number | null
  lead_time_days: number
  window_days: number
  avg_daily: number
  sold_90: number
  predicted_qty: number
  predicted_customers: number
  forecast: number
  suggested_qty: number
  suggested_cost: number
  coverage_days: number | null
  low_stock: boolean
}

export interface StockOverview {
  today: string
  horizon_days: number
  products: StockRow[]
  totals: { tracked: number; low_stock: number; stock_value: number; stock_sale_value: number }
}

// ---------------------------------------------------------------------
// Serviços, profissionais, pacotes e agenda
// ---------------------------------------------------------------------
export type ServiceCategory = string
export type ProfessionalRole = string
export type AppointmentStatus = 'requested' | 'scheduled' | 'confirmed' | 'in_progress' | 'done' | 'canceled' | 'no_show'

export interface Service {
  id: string
  organization_id: string
  name: string
  category: ServiceCategory
  price: number
  duration_minutes: number
  return_days: number | null
  description: string | null
  active: boolean
  catalog_visible: boolean
  bookable_online: boolean
  created_at: string
}

export interface Professional {
  id: string
  organization_id: string
  name: string
  role: ProfessionalRole
  phone: string | null
  color: string
  work_days: number[]
  work_start: string
  work_end: string
  active: boolean
}

export interface ServicePackage {
  id: string
  organization_id: string
  name: string
  service_id: string
  sessions: number
  price: number
  validity_days: number
  active: boolean
  services?: { name: string } | null
}

export interface CustomerPackage {
  id: string
  customer_id: string
  pet_id: string | null
  package_id: string | null
  service_id: string
  name: string
  sessions_total: number
  sessions_used: number
  price_paid: number
  purchased_at: string
  expires_at: string
  status: 'active' | 'finished' | 'canceled'
}

export interface AppointmentView {
  id: string
  organization_id: string
  customer_id: string | null
  pet_id: string | null
  service_id: string
  professional_id: string | null
  starts_at: string
  ends_at: string
  status: AppointmentStatus
  price: number
  customer_package_id: string | null
  source: 'painel' | 'online'
  requester_name: string | null
  requester_phone: string | null
  pet_name: string | null
  notes: string | null
  cancel_reason: string | null
  completed_at: string | null
  customer_name: string | null
  customer_phone: string | null
  customer_do_not_contact: boolean | null
  pet_display_name: string | null
  service_name: string
  service_category: ServiceCategory
  professional_name: string | null
  professional_color: string | null
  package_name: string | null
  package_sessions_total: number | null
  package_sessions_used: number | null
}

// ---------------------------------------------------------------------
// Caixa e financeiro
// ---------------------------------------------------------------------
export type PaymentMethod = 'dinheiro' | 'pix' | 'cartao_credito' | 'cartao_debito' | 'boleto' | 'fiado' | 'transferencia' | 'outro' | 'nao_informado'
export type FinanceCategory =
  | 'venda_produtos' | 'servicos' | 'pacotes' | 'outras_receitas'
  | 'fornecedores' | 'aluguel' | 'salarios' | 'energia_agua' | 'internet_telefone' | 'impostos'
  | 'marketing' | 'manutencao' | 'taxas_cartao' | 'outras_despesas'

export interface PaymentInput {
  method: Exclude<PaymentMethod, 'nao_informado'>
  amount: number
}

export interface CashSession {
  id: string
  status: 'open' | 'closed'
  opening_amount: number
  opened_by: string | null
  opened_at: string
  expected_amount: number | null
  counted_amount: number | null
  closed_at: string | null
  notes: string | null
}

export interface CashMovement {
  id: string
  kind: 'suprimento' | 'sangria'
  amount: number
  notes: string | null
  created_at: string
}

export interface CashSummary {
  session: CashSession
  expected_cash: number
  sales_count: number
  sales_total: number
  by_method: Partial<Record<PaymentMethod, number>>
  movements: CashMovement[]
  settled_cash: number
}

export interface FinanceEntry {
  id: string
  organization_id: string
  kind: 'income' | 'expense'
  category: FinanceCategory
  description: string
  amount: number
  due_date: string
  paid_at: string | null
  status: 'pending' | 'paid' | 'canceled'
  payment_method: PaymentMethod | null
  customer_id: string | null
  supplier: string | null
  purchase_id: string | null
  notes: string | null
  created_at: string
  customers?: { full_name: string } | null
}

export interface FinanceReport {
  revenue: number
  sales_count: number
  avg_ticket: number
  products_revenue: number
  services_revenue: number
  discounts: number
  products_cost: number
  products_cost_missing: number
  gross_profit: number
  received: number
  paid_expenses: number
  receivable_open: number
  receivable_overdue: number
  payable_open: number
  payable_overdue: number
  payable_next7: number
  by_method: Partial<Record<PaymentMethod, number>>
  expenses_by_category: Partial<Record<FinanceCategory, number>>
  series: { date: string; revenue: number; received: number; expenses: number }[]
}

// ---------------------------------------------------------------------
// Lembretes, consumo e segmentos
// ---------------------------------------------------------------------
export type ReminderKind = 'aniversario' | 'pos_venda' | 'lembrete_agendamento' | 'retorno_servico' | 'pacote_vencendo'

export interface Reminder {
  key: string
  kind: ReminderKind
  due_date: string
  customer_id: string
  customer_name: string
  phone: string | null
  marketing_consent: boolean
  do_not_contact: boolean
  pet_name: string | null
  service_name: string | null
  appointment_id: string | null
  starts_at: string | null
  detail: string | null
}

export interface CustomerInsights {
  total_spent: number
  purchases_count: number
  avg_ticket: number
  first_purchase: string | null
  last_purchase: string | null
  days_since_last: number | null
  avg_interval_days: number | null
  spent_12m: number
  percentile_12m: number | null
  services_count: number
  no_show_count: number
  receivable_open: number
  top_products: { name: string; quantity: number; total: number; times: number }[]
  by_category: Record<string, number>
  monthly: { month: string; total: number }[]
  packages: Pick<CustomerPackage, 'id' | 'name' | 'sessions_total' | 'sessions_used' | 'expires_at' | 'status' | 'pet_id' | 'service_id'>[]
}

export type Segment = 'campeao' | 'fiel' | 'novo' | 'ocasional' | 'em_risco' | 'perdido' | 'sem_compras'

export interface CustomerSegments {
  summary: Partial<Record<Segment, { count: number; revenue: number }>>
  customers: {
    id: string
    name: string
    phone: string | null
    do_not_contact: boolean
    segment: Segment
    recency: number | null
    frequency: number
    monetary: number
    avg_ticket: number | null
  }[]
}

// ---------------------------------------------------------------------
// Integrações e nota fiscal
// ---------------------------------------------------------------------
export type AutoKind = ReminderKind | 'recompra'

export interface IntegrationSettings {
  whatsapp_enabled: boolean
  whatsapp_phone_number_id: string | null
  whatsapp_has_token: boolean
  whatsapp_templates: Partial<Record<AutoKind, { name: string; language: string }>>
  whatsapp_auto_kinds: AutoKind[]
  whatsapp_last_run_at: string | null
  fiscal_enabled: boolean
  fiscal_environment: 'homologacao' | 'producao'
  fiscal_has_token: boolean
  fiscal_cnpj: string | null
  fiscal_ie: string | null
  fiscal_im: string | null
  fiscal_city_code: string | null
  fiscal_simples: boolean
  fiscal_icms_situation: string
  fiscal_service_item: string
  fiscal_municipal_tax_code: string | null
  fiscal_iss_rate: number | null
  dispatches_30d: { sent: number; failed: number }
}

export interface Invoice {
  id: string
  purchase_id: string | null
  kind: 'nfce' | 'nfse'
  environment: 'homologacao' | 'producao'
  status: 'processando' | 'autorizado' | 'erro' | 'cancelado'
  amount: number
  numero: string | null
  serie: string | null
  chave: string | null
  url_pdf: string | null
  url_xml: string | null
  message: string | null
  created_at: string
}
