import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { rpc, supabase, unwrap } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { useOrg } from '@/features/org/OrgProvider'
import type { ContactResult, MessageTemplate, PredictionStage, PredictionView, ProductCategory } from '@/types/models'

export type StageTab = 'todas' | 'proximas' | 'hoje' | 'atrasadas' | 'contatadas' | 'concluidas'

export const TAB_STAGES: Record<StageTab, PredictionStage[]> = {
  todas: ['prevista', 'proxima', 'hoje', 'atrasada', 'contatada'],
  proximas: ['proxima'],
  hoje: ['hoje'],
  atrasadas: ['atrasada'],
  contatadas: ['contatada'],
  concluidas: ['concluida'],
}

export interface PredictionFilters {
  from?: string
  to?: string
  productId?: string
  category?: ProductCategory | ''
  customerId?: string
  sort: 'expected_date' | 'potential_value'
  ascending: boolean
}

/** Carrega previsões ativas + concluídas recentes; abas filtram no cliente (contagens por aba). */
export function usePredictions(filters: PredictionFilters) {
  const { org } = useOrg()
  return useQuery({
    queryKey: ['predictions', org.id, filters],
    queryFn: async () => {
      let q = supabase
        .from('v_predictions')
        .select('*')
        .eq('organization_id', org.id)
        .neq('status', 'ignored')
        .order(filters.sort, { ascending: filters.ascending })
        .limit(1000)
      if (filters.from) q = q.gte('expected_date', filters.from)
      if (filters.to) q = q.lte('expected_date', filters.to)
      if (filters.productId) q = q.eq('product_id', filters.productId)
      if (filters.category) q = q.eq('product_category', filters.category)
      if (filters.customerId) q = q.eq('customer_id', filters.customerId)
      return unwrap(await q) as PredictionView[]
    },
  })
}

/** Fila de recuperação: previsões abertas vencendo/atrasadas + contatadas aguardando. */
export function useRecoveryQueue() {
  const { org, ctx } = useOrg()
  return useQuery({
    queryKey: ['recovery', org.id],
    queryFn: async () => {
      const limitDate = new Date(ctx.today + 'T12:00:00Z')
      limitDate.setUTCDate(limitDate.getUTCDate() + org.soon_days)
      return unwrap(
        await supabase
          .from('v_predictions')
          .select('*')
          .eq('organization_id', org.id)
          .in('status', ['open', 'contacted'])
          .lte('expected_date', limitDate.toISOString().slice(0, 10))
          .order('expected_date', { ascending: true })
          .limit(500),
      ) as PredictionView[]
    },
  })
}

export function useTemplates() {
  const { org } = useOrg()
  return useQuery({
    queryKey: ['templates', org.id],
    queryFn: async () =>
      unwrap(await supabase.from('message_templates').select('*').eq('organization_id', org.id).order('is_default', { ascending: false }).order('created_at')) as MessageTemplate[],
  })
}

export function useSetPredictionStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; status: 'ignored' | 'open'; reason?: string }) =>
      rpc<void>('set_prediction_status', { p_prediction: v.id, p_status: v.status, p_reason: v.reason ?? null }),
    onSuccess: (_, v) => {
      toast.success(v.status === 'ignored' ? 'Oportunidade ignorada.' : 'Oportunidade reaberta.')
      for (const k of ['predictions', 'recovery', 'dashboard', 'customer', 'customers']) qc.invalidateQueries({ queryKey: [k] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export interface LogContactInput {
  customer_id: string
  prediction_id?: string | null
  template_id?: string | null
  message?: string | null
  result: ContactResult
  follow_up_date?: string | null
  notes?: string | null
}

export function useLogContact() {
  const qc = useQueryClient()
  const { org } = useOrg()
  return useMutation({
    mutationFn: (v: LogContactInput) =>
      rpc<string>('log_contact', {
        p_org: org.id,
        p_customer: v.customer_id,
        p_result: v.result,
        p_prediction: v.prediction_id ?? null,
        p_template: v.template_id ?? null,
        p_message: v.message ?? null,
        p_follow_up: v.follow_up_date || null,
        p_notes: v.notes || null,
      }),
    onSuccess: () => {
      toast.success('Contato registrado.')
      for (const k of ['predictions', 'recovery', 'dashboard', 'contacts', 'customer', 'customers']) qc.invalidateQueries({ queryKey: [k] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}
