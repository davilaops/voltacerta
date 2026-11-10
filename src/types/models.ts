// Tipos de domínio espelhando as tabelas/views do Supabase (ver supabase/migrations).

export type MemberRole = 'owner' | 'admin' | 'staff'
export type PlanTier = 'inicial' | 'profissional' | 'premium'
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'
export type PredictionStatus = 'open' | 'contacted' | 'completed' | 'ignored'
export type PredictionStage = 'prevista' | 'proxima' | 'hoje' | 'atrasada' | 'contatada' | 'concluida' | 'ignorada'
export type ContactResult = 'respondeu' | 'nao_respondeu' | 'comprou' | 'sem_interesse' | 'retornar_depois'
export type ProductCategory = 'racoes' | 'petiscos' | 'areia' | 'medicamentos' | 'higiene' | 'acessorios' | 'outros'
export type ProductUnit = 'kg' | 'g' | 'l' | 'ml' | 'un' | 'cx' | 'pct'
export type Species = 'cao' | 'gato' | 'ave' | 'roedor' | 'peixe' | 'reptil' | 'outro'
export type CustomerSituation = 'sem_compras' | 'precisa_contato' | 'proxima' | 'em_dia' | 'inativo'
export type BusinessType = 'pet_shop' | 'loja_racao' | 'veterinario' | 'delivery' | 'rede' | 'outro'

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
}

export interface OrgContext {
  role: MemberRole
  plan: PlanTier
  status: SubscriptionStatus
  effective_status: SubscriptionStatus
  trial_ends_at: string | null
  current_period_end: string | null
  can_write: boolean
  customer_limit: number | null
  customer_count: number
  features: { reports_full: boolean; history_advanced: boolean; reports_advanced: boolean }
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

export interface Purchase {
  id: string
  organization_id: string
  customer_id: string
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
  kind: 'reposicao' | 'atrasado' | 'recompra' | 'custom'
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
