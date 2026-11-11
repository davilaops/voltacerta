import type {
  BusinessType,
  ContactResult,
  CustomerSituation,
  MemberRole,
  PlanTier,
  PredictionStage,
  ProductCategory,
  ProductUnit,
  Species,
  SubscriptionStatus,
} from '@/types/models'

export type Tone = 'neutral' | 'brand' | 'warning' | 'danger' | 'info' | 'muted'

export const STAGE: Record<PredictionStage, { label: string; tone: Tone }> = {
  prevista: { label: 'Prevista', tone: 'neutral' },
  proxima: { label: 'Próxima', tone: 'info' },
  hoje: { label: 'Hoje', tone: 'warning' },
  atrasada: { label: 'Atrasada', tone: 'danger' },
  contatada: { label: 'Contato realizado', tone: 'brand' },
  concluida: { label: 'Recompra concluída', tone: 'brand' },
  ignorada: { label: 'Ignorada', tone: 'muted' },
}

export const SITUATION: Record<CustomerSituation, { label: string; tone: Tone }> = {
  sem_compras: { label: 'Sem compras', tone: 'muted' },
  precisa_contato: { label: 'Precisa de contato', tone: 'danger' },
  proxima: { label: 'Recompra próxima', tone: 'warning' },
  em_dia: { label: 'Em dia', tone: 'brand' },
  inativo: { label: 'Inativo', tone: 'neutral' },
}

export const CATEGORY: Record<ProductCategory, string> = {
  racoes: 'Rações',
  petiscos: 'Petiscos',
  areia: 'Areia para gatos',
  medicamentos: 'Medicamentos',
  higiene: 'Higiene',
  acessorios: 'Acessórios',
  outros: 'Outros',
}

export const UNIT: Record<ProductUnit, string> = {
  kg: 'kg',
  g: 'g',
  l: 'L',
  ml: 'mL',
  un: 'unidade',
  cx: 'caixa',
  pct: 'pacote',
}

export const SPECIES: Record<Species, string> = {
  cao: 'Cão',
  gato: 'Gato',
  ave: 'Ave',
  roedor: 'Roedor',
  peixe: 'Peixe',
  reptil: 'Réptil',
  outro: 'Outro',
}

export const CONTACT_RESULT: Record<ContactResult, { label: string; tone: Tone }> = {
  respondeu: { label: 'Respondeu', tone: 'info' },
  nao_respondeu: { label: 'Não respondeu', tone: 'muted' },
  comprou: { label: 'Comprou', tone: 'brand' },
  sem_interesse: { label: 'Não tem interesse', tone: 'danger' },
  retornar_depois: { label: 'Retornar depois', tone: 'warning' },
}

export const ROLE: Record<MemberRole, string> = {
  owner: 'Proprietário',
  admin: 'Administrador',
  employee: 'Funcionário',
}

export const BUSINESS_TYPE: Record<BusinessType, string> = {
  pet_shop: 'Pet shop',
  loja_racao: 'Loja de rações',
  veterinario: 'Produtos veterinários',
  delivery: 'Pet shop com delivery',
  rede: 'Rede de lojas',
  outro: 'Outro',
}

export const SUBSCRIPTION_STATUS: Record<SubscriptionStatus, { label: string; tone: Tone }> = {
  trialing: { label: 'Período de teste', tone: 'info' },
  active: { label: 'Ativa', tone: 'brand' },
  past_due: { label: 'Pagamento atrasado', tone: 'warning' },
  canceled: { label: 'Cancelada', tone: 'danger' },
  expired: { label: 'Expirada', tone: 'danger' },
}

export const BR_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const

/** Nome de exibição do plano (preços e limites ficam na tabela public.plans). */
export const PLAN_NAME: Record<PlanTier, string> = { inicial: 'Inicial', profissional: 'Profissional', premium: 'Premium' }
