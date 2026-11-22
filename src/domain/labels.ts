import type {
  AppointmentStatus,
  AutoKind,
  FinanceCategory,
  PaymentMethod,
  ReminderKind,
  SaleChannel,
  Segment,
  StockKind,
  TemplateKind,
  ContactResult,
  CustomerSituation,
  MemberRole,
  PlanTier,
  PredictionStage,
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

/** Categorias de produto são texto livre: use productCategoryLabel (src/domain/business.ts). */

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

// ---------------------------------------------------------------------
// Módulos de gestão (categorias de serviço e funções: src/domain/business.ts)
// ---------------------------------------------------------------------
export const APPOINTMENT_STATUS: Record<AppointmentStatus, { label: string; tone: Tone }> = {
  requested: { label: 'Solicitado online', tone: 'warning' },
  scheduled: { label: 'Agendado', tone: 'info' },
  confirmed: { label: 'Confirmado', tone: 'brand' },
  in_progress: { label: 'Em atendimento', tone: 'warning' },
  done: { label: 'Concluído', tone: 'muted' },
  canceled: { label: 'Cancelado', tone: 'danger' },
  no_show: { label: 'Não compareceu', tone: 'danger' },
}

export const PAYMENT_METHOD: Record<PaymentMethod, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito',
  boleto: 'Boleto',
  fiado: 'Fiado (a receber)',
  transferencia: 'Transferência',
  outro: 'Outro',
  nao_informado: 'Não informado',
}

export const INCOME_CATEGORY: Partial<Record<FinanceCategory, string>> = {
  venda_produtos: 'Venda de produtos',
  servicos: 'Serviços',
  pacotes: 'Pacotes',
  outras_receitas: 'Outras receitas',
}
export const EXPENSE_CATEGORY: Partial<Record<FinanceCategory, string>> = {
  fornecedores: 'Fornecedores / mercadorias',
  aluguel: 'Aluguel',
  salarios: 'Salários e comissões',
  energia_agua: 'Energia e água',
  internet_telefone: 'Internet e telefone',
  impostos: 'Impostos e taxas',
  marketing: 'Marketing',
  manutencao: 'Manutenção',
  taxas_cartao: 'Taxas de cartão',
  outras_despesas: 'Outras despesas',
}
export const FINANCE_CATEGORY = { ...INCOME_CATEGORY, ...EXPENSE_CATEGORY } as Record<FinanceCategory, string>

export const STOCK_KIND: Record<StockKind, { label: string; tone: Tone }> = {
  entrada: { label: 'Entrada', tone: 'brand' },
  venda: { label: 'Venda', tone: 'info' },
  estorno_venda: { label: 'Estorno de venda', tone: 'neutral' },
  ajuste: { label: 'Ajuste', tone: 'warning' },
  perda: { label: 'Perda / avaria', tone: 'danger' },
  inventario: { label: 'Inventário', tone: 'neutral' },
}

export const SALE_CHANNEL: Record<SaleChannel, string> = {
  registro: 'Registro',
  pdv: 'Caixa',
  agenda: 'Agenda',
  pacote: 'Pacote',
}

export const REMINDER_KIND: Record<ReminderKind, { label: string; tone: Tone; template: TemplateKind }> = {
  aniversario: { label: 'Aniversário do pet', tone: 'brand', template: 'aniversario' },
  pos_venda: { label: 'Pós-venda', tone: 'info', template: 'pos_venda' },
  lembrete_agendamento: { label: 'Lembrete de agendamento', tone: 'warning', template: 'lembrete_agendamento' },
  retorno_servico: { label: 'Hora de voltar', tone: 'neutral', template: 'retorno_servico' },
  pacote_vencendo: { label: 'Pacote vencendo', tone: 'danger', template: 'pacote_vencendo' },
}

export const AUTO_KIND: Record<AutoKind, string> = {
  aniversario: 'Aniversário do pet',
  pos_venda: 'Pós-venda',
  lembrete_agendamento: 'Lembrete de agendamento (véspera)',
  retorno_servico: 'Hora do próximo serviço',
  pacote_vencendo: 'Pacote perto de vencer',
  recompra: 'Recompra de produto (no dia previsto)',
}

export const SEGMENT: Record<Segment, { label: string; tone: Tone; hint: string }> = {
  campeao: { label: 'Campeões', tone: 'brand', hint: 'Compraram nos últimos 30 dias e 4 ou mais vezes no ano' },
  fiel: { label: 'Fiéis', tone: 'info', hint: 'Compraram nos últimos 60 dias e 2 ou mais vezes no ano' },
  novo: { label: 'Novos', tone: 'neutral', hint: 'Primeira compra nos últimos 30 dias' },
  ocasional: { label: 'Ocasionais', tone: 'muted', hint: 'Compram de vez em quando' },
  em_risco: { label: 'Em risco', tone: 'warning', hint: 'Clientes frequentes sem comprar há 2 a 4 meses' },
  perdido: { label: 'Perdidos', tone: 'danger', hint: 'Sem comprar há mais de 4 meses' },
  sem_compras: { label: 'Sem compras', tone: 'muted', hint: 'Cadastrados, mas nunca compraram' },
}

export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'] as const
export const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const
