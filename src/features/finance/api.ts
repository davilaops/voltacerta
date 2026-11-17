import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { rpc, supabase, unwrap } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { useOrg } from '@/features/org/OrgProvider'
import type { FinanceCategory, FinanceEntry, FinanceReport, PaymentMethod } from '@/types/models'

export function useFinanceReport(from: string, to: string) {
  const { org } = useOrg()
  return useQuery({
    queryKey: ['finance', org.id, 'report', from, to],
    placeholderData: keepPreviousData,
    queryFn: () => rpc<FinanceReport>('finance_report', { p_org: org.id, p_from: from, p_to: to }),
  })
}

export type EntryFilter =
  | { view: 'receivable' }
  | { view: 'payable' }
  | { view: 'all'; from: string; to: string }

export function useFinanceEntries(filter: EntryFilter) {
  const { org } = useOrg()
  return useQuery({
    queryKey: ['finance', org.id, 'entries', filter],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase.from('finance_entries').select('*, customers(full_name)').eq('organization_id', org.id)
      if (filter.view === 'receivable') q = q.eq('kind', 'income').eq('status', 'pending').order('due_date')
      else if (filter.view === 'payable') q = q.eq('kind', 'expense').eq('status', 'pending').order('due_date')
      else q = q.or(`and(paid_at.gte.${filter.from},paid_at.lte.${filter.to}),and(status.neq.paid,due_date.gte.${filter.from},due_date.lte.${filter.to})`)
        .order('due_date', { ascending: false }).order('created_at', { ascending: false })
      return unwrap(await q.limit(500)) as FinanceEntry[]
    },
  })
}

const invalidate = (qc: ReturnType<typeof useQueryClient>) => ['finance', 'cash', 'customer-insights'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))

export interface EntryInput {
  id?: string
  kind: 'income' | 'expense'
  category: FinanceCategory
  description: string
  amount: number
  due_date: string
  paid: boolean
  paid_at: string | null
  method: PaymentMethod | null
  customer_id: string | null
  supplier: string
  notes: string
}

export function useSaveEntry() {
  const qc = useQueryClient()
  const { org } = useOrg()
  return useMutation({
    mutationFn: (v: EntryInput) =>
      rpc<string>('save_finance_entry', {
        p_org: org.id, p_id: v.id ?? null, p_kind: v.kind, p_category: v.category, p_description: v.description,
        p_amount: v.amount, p_due_date: v.due_date, p_paid: v.paid, p_paid_at: v.paid ? v.paid_at : null,
        p_method: v.method, p_customer: v.customer_id, p_supplier: v.supplier || null, p_notes: v.notes || null,
      }),
    onSuccess: (_, v) => {
      toast.success(v.id ? 'Lançamento atualizado.' : 'Lançamento criado.')
      invalidate(qc)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export function useSettleEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; method: PaymentMethod; paid_at: string }) =>
      rpc<void>('settle_finance_entry', { p_id: v.id, p_method: v.method, p_paid_at: v.paid_at }),
    onSuccess: () => {
      toast.success('Baixa registrada.')
      invalidate(qc)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export function useCancelEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => rpc<void>('cancel_finance_entry', { p_id: id }),
    onSuccess: () => {
      toast.success('Lançamento cancelado.')
      invalidate(qc)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}
