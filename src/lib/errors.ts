/** Traduz erros do Supabase/Postgres para mensagens claras em português. */
const MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: 'Sua sessão expirou. Entre novamente.',
  FORBIDDEN: 'Você não tem permissão para esta ação.',
  SUBSCRIPTION_INACTIVE: 'Sua assinatura não está ativa. Regularize o plano para continuar registrando dados.',
  PLAN_LIMIT_CUSTOMERS: 'Você atingiu o limite de clientes do seu plano. Faça upgrade para cadastrar mais.',
  PLAN_FEATURE_UNAVAILABLE: 'Este recurso não está disponível no seu plano.',
  CUSTOMER_NOT_FOUND: 'Cliente não encontrado.',
  PRODUCT_NOT_FOUND: 'Produto não encontrado.',
  NOT_FOUND: 'Registro não encontrado.',
  INVALID_DATE: 'Data inválida. Compras não podem ter data futura.',
  INVALID_ITEMS: 'Verifique os itens da compra (quantidade e preço).',
  INVALID_DISCOUNT: 'O desconto não pode ser maior que o valor da compra.',
  INVALID_PHONE: 'Telefone inválido. Informe DDD + número.',
  INVALID_PERIOD: 'Período inválido.',
  CUSTOMER_OPTED_OUT: 'Este cliente pediu para não receber contato comercial.',
  RATE_LIMITED: 'Muitas ações em pouco tempo. Aguarde um instante e tente novamente.',
  INVALID_STATUS_TRANSITION: 'Não é possível alterar o status desta previsão.',
  INVALID_ROLE_CHANGE: 'Alteração de papel não permitida.',
  ORG_LIMIT_REACHED: 'Limite de estabelecimentos por conta atingido.',
  ORG_ALREADY_EXISTS: 'Você já possui um estabelecimento. Para adicionar outro, use o seletor de estabelecimentos no painel.',
  USER_BLOCKED: 'Seu acesso está bloqueado. Fale com o suporte.',
  REASON_REQUIRED: 'Informe uma justificativa (mínimo de 5 caracteres).',
  SUBSCRIPTION_ALREADY_ACTIVE: 'A assinatura está ativa e paga; não é possível convertê-la em teste.',
  CANNOT_BLOCK_SELF: 'Você não pode bloquear a sua própria conta.',
  CANNOT_BLOCK_ADMIN: 'Não é possível bloquear outro Super Admin.',
  INVALID_DAYS: 'Informe entre 1 e 90 dias.',
  INVALID_PRICE: 'Preço inválido.',
  INVALID_LIMIT: 'Limite inválido.',
  BILLING_NOT_CONFIGURED: 'Pagamentos ainda não estão configurados neste ambiente.',
  BILLING_ADAPTER_PENDING: 'A integração com o gateway de pagamento ainda não foi concluída.',
  BILLING_PROVIDER_ERROR: 'Não foi possível abrir o pagamento agora. Tente novamente em instantes.',
  DOCUMENT_REQUIRED: 'Informe o CPF ou CNPJ para gerar a cobrança.',
  INVALID_DOCUMENT: 'CPF ou CNPJ inválido. Confira os números.',
  PAYMENT_PROCESSING: 'Seu pagamento já foi recebido e está sendo confirmado. Aguarde alguns minutos e atualize a página.',
  ALREADY_SUBSCRIBED: 'Você já assina este plano.',
  PLAN_CHANGE_REQUIRES_SUPPORT: 'Você já tem uma assinatura ativa. Para trocar de plano, fale com o suporte.',
  CANNOT_DELETE_SELF: 'Você não pode excluir a sua própria conta.',
  CANNOT_DELETE_ADMIN: 'Não é possível excluir um Super Admin.',
  USER_OWNS_ORGANIZATION: 'Esta pessoa é proprietária de um estabelecimento. Exclua o estabelecimento antes.',
  CONFIRMATION_MISMATCH: 'O texto digitado não confere. Confira e tente novamente.',
  SUBSCRIPTION_ACTIVE: 'Há uma assinatura paga em vigor. Encerre a assinatura antes de excluir.',
  PROVIDER_CANCEL_FAILED: 'O gateway de pagamento não confirmou o cancelamento. Nada foi alterado; tente novamente.',
  ORG_SUSPENDED: 'Este estabelecimento está suspenso.',
}

const CONSTRAINTS: Record<string, string> = {
  customers_org_phone_uq: 'Já existe um cliente com este telefone.',
  products_org_sku_uq: 'Já existe um produto com este código/SKU.',
  organization_invitations_pending_uq: 'Já existe um convite pendente para este e-mail.',
  data_deletion_requests_pending_uq: 'Já existe uma solicitação em andamento.',
}

const AUTH: Record<string, string> = {
  'Invalid login credentials': 'E-mail ou senha incorretos.',
  'Email not confirmed': 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.',
  'User already registered': 'Já existe uma conta com este e-mail.',
  'Password should be at least': 'A senha é muito curta.',
}

export function errorMessage(err: unknown): string {
  if (!err) return 'Ocorreu um erro inesperado.'
  const e = err as { message?: string; details?: string; code?: string }
  const msg = e.message ?? String(err)
  for (const [key, text] of Object.entries(MESSAGES)) if (msg.includes(key)) return text
  for (const [key, text] of Object.entries(CONSTRAINTS)) if (msg.includes(key) || e.details?.includes(key)) return text
  for (const [key, text] of Object.entries(AUTH)) if (msg.includes(key)) return text
  if (e.code === '23503') return 'Este registro está vinculado a outros dados e não pode ser excluído.'
  if (e.code === '23505') return 'Registro duplicado.'
  if (e.code === '42501' || msg.includes('row-level security')) return 'Você não tem permissão para esta ação.'
  if (/fetch|network/i.test(msg)) return 'Falha de conexão. Verifique sua internet.'
  if (/rate limit/i.test(msg)) return 'Muitas tentativas. Aguarde alguns minutos.'
  return 'Não foi possível concluir a operação. Tente novamente.'
}

export function isAuthError(err: unknown): boolean {
  const msg = (err as { message?: string })?.message ?? ''
  return /JWT expired|NOT_AUTHENTICATED|invalid claim|refresh_token/i.test(msg)
}
