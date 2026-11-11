import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { rpc, supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import type { MemberRole, PlanTier, SubscriptionStatus } from '@/types/models'

// Todas as chamadas abaixo são RPCs que validam is_super_admin() no banco.

export interface AdminOverview {
  organizations_total: number
  organizations_suspended: number
  users_total: number
  users_blocked: number
  subscriptions_active: number
  trials_active: number
  trials_ended: number
  subscriptions_past_due: number
  subscriptions_canceled: number
  mrr_received_cents: number
  test_received_cents?: number
  signups: { date: string; organizations: number; users: number }[]
}

export interface AdminOrgRow {
  id: string
  name: string
  city: string | null
  state: string | null
  created_at: string
  suspended_at: string | null
  suspended_reason: string | null
  plan: PlanTier | null
  status: SubscriptionStatus | null
  effective_status: SubscriptionStatus
  trial_ends_at: string | null
  current_period_end: string | null
  members: number
  customers: number
  owner_email: string | null
}

export interface AdminPayment {
  id: string
  organization_id: string | null
  organization_name?: string | null
  provider: string
  provider_payment_id: string
  plan: PlanTier | null
  amount_cents: number
  dev_mode?: boolean
  status: 'pending' | 'paid' | 'failed' | 'refunded' | 'canceled'
  paid_at: string | null
  period_start: string | null
  period_end: string | null
  created_at: string
}

export interface AdminAuditRow {
  id: number
  actor_id: string | null
  actor_email: string | null
  action: string
  target_type: string
  target_id: string | null
  reason: string | null
  details: Record<string, unknown>
  created_at: string
}

export interface AdminOrgDetail {
  organization: {
    id: string
    name: string
    owner_name: string | null
    phone: string | null
    city: string | null
    state: string | null
    business_type: string | null
    created_at: string
    onboarding_completed: boolean
    suspended_at: string | null
    suspended_reason: string | null
  }
  subscription: {
    plan: PlanTier
    status: SubscriptionStatus
    effective_status: SubscriptionStatus
    trial_started_at: string | null
    trial_ends_at: string | null
    current_period_start: string | null
    current_period_end: string | null
    provider: string | null
  } | null
  members: { user_id: string; role: MemberRole; email: string; full_name: string | null; created_at: string; blocked_at: string | null }[]
  counts: { customers: number; products: number; purchases: number; contacts: number }
  payments: AdminPayment[]
  audit: AdminAuditRow[]
}

export interface AdminUserRow {
  id: string
  email: string
  full_name: string | null
  created_at: string
  last_sign_in_at: string | null
  email_confirmed_at: string | null
  blocked_at: string | null
  blocked_reason: string | null
  super_admin: boolean
  organizations: { id: string; name: string; role: MemberRole }[]
}

type Paged<T> = { total: number; rows: T[] }
export const ADMIN_PAGE = 25

export const useAdminOverview = (from: string, to: string) =>
  useQuery({ queryKey: ['admin', 'overview', from, to], queryFn: () => rpc<AdminOverview>('admin_overview', { p_from: from, p_to: to }) })

export const useAdminOrganizations = (search: string, status: string, page: number) =>
  useQuery({
    queryKey: ['admin', 'orgs', search, status, page],
    placeholderData: keepPreviousData,
    queryFn: () => rpc<Paged<AdminOrgRow>>('admin_list_organizations', { p_search: search || null, p_status: status || null, p_limit: ADMIN_PAGE, p_offset: page * ADMIN_PAGE }),
  })

export const useAdminOrganization = (id: string | undefined) =>
  useQuery({ queryKey: ['admin', 'org', id], enabled: !!id, queryFn: () => rpc<AdminOrgDetail>('admin_get_organization', { p_org: id }) })

export const useAdminUsers = (search: string, page: number) =>
  useQuery({
    queryKey: ['admin', 'users', search, page],
    placeholderData: keepPreviousData,
    queryFn: () => rpc<Paged<AdminUserRow>>('admin_list_users', { p_search: search || null, p_limit: ADMIN_PAGE, p_offset: page * ADMIN_PAGE }),
  })

export const useAdminPayments = (page: number) =>
  useQuery({
    queryKey: ['admin', 'payments', page],
    placeholderData: keepPreviousData,
    queryFn: () => rpc<Paged<AdminPayment>>('admin_list_payments', { p_org: null, p_limit: ADMIN_PAGE, p_offset: page * ADMIN_PAGE }),
  })

export const useAdminAudit = (page: number) =>
  useQuery({
    queryKey: ['admin', 'audit', page],
    placeholderData: keepPreviousData,
    queryFn: () => rpc<Paged<AdminAuditRow>>('admin_list_audit', { p_limit: 50, p_offset: page * 50 }),
  })

/** Mutação administrativa: chama a RPC, mostra feedback e recarrega o painel. */
export function useAdminAction<V>(fn: string, toArgs: (v: V) => Record<string, unknown>, success: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: V) => rpc<void>(fn, toArgs(v)),
    onSuccess: () => {
      toast.success(success)
      qc.invalidateQueries({ queryKey: ['admin'] })
      qc.invalidateQueries({ queryKey: ['plans'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export const ACTION_LABEL: Record<string, string> = {
  promote_super_admin: 'Promoveu Super Admin',
  revoke_super_admin: 'Revogou Super Admin',
  suspend_organization: 'Suspendeu estabelecimento',
  reactivate_organization: 'Reativou estabelecimento',
  grant_trial: 'Concedeu período de teste',
  change_plan: 'Alterou plano',
  block_user: 'Bloqueou usuário',
  unblock_user: 'Desbloqueou usuário',
  update_plan: 'Editou plano',
  cancel_subscription: 'Encerrou assinatura',
  delete_organization: 'Excluiu estabelecimento',
}

export const PAYMENT_STATUS: Record<AdminPayment['status'], { label: string; tone: 'brand' | 'warning' | 'danger' | 'muted' }> = {
  paid: { label: 'Pago', tone: 'brand' },
  pending: { label: 'Pendente', tone: 'warning' },
  failed: { label: 'Falhou', tone: 'danger' },
  refunded: { label: 'Estornado', tone: 'muted' },
  canceled: { label: 'Cancelado', tone: 'muted' },
}

/** Encerra a assinatura: cancela na AbacatePay (Edge Function) e depois no banco. */
export function useCancelSubscription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { orgId: string; reason: string }) => {
      const { data, error } = await supabase.functions.invoke<{ ok?: boolean; provider_result?: string; error?: string }>(
        'admin-cancel-subscription',
        { body: { organization_id: v.orgId, reason: v.reason } },
      )
      if (error) {
        let code = error.message
        try {
          const body = await (error as { context?: Response }).context?.json()
          if (body?.error) code = body.error
        } catch {
          /* corpo indisponível */
        }
        throw new Error(code)
      }
      return data
    },
    onSuccess: (data) => {
      toast.success('Assinatura encerrada.', { description: data?.provider_result })
      qc.invalidateQueries({ queryKey: ['admin'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

/** Exclusão definitiva do estabelecimento (exige o nome digitado). */
export function useDeleteOrganization() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { orgId: string; reason: string; confirmName: string }) =>
      rpc<void>('admin_delete_organization', { p_org: v.orgId, p_reason: v.reason, p_confirm_name: v.confirmName }),
    onSuccess: () => {
      toast.success('Estabelecimento excluído.')
      qc.invalidateQueries({ queryKey: ['admin'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}
