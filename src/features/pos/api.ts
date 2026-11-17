import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { rpc, supabase, unwrap } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { useOrg } from '@/features/org/OrgProvider'
import type { CashSession, CashSummary, PaymentInput, Purchase } from '@/types/models'

export function useCashSummary() {
  const { org } = useOrg()
  return useQuery({
    queryKey: ['cash', org.id, 'summary'],
    queryFn: () => rpc<CashSummary | null>('cash_session_summary', { p_org: org.id, p_session: null }),
  })
}

export function useCashSessions() {
  const { org } = useOrg()
  return useQuery({
    queryKey: ['cash', org.id, 'sessions'],
    queryFn: async () =>
      unwrap(await supabase.from('cash_sessions').select('*').eq('organization_id', org.id).order('opened_at', { ascending: false }).limit(30)) as CashSession[],
  })
}

export function useSessionSales(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['cash', 'sales', sessionId],
    enabled: !!sessionId,
    queryFn: async () =>
      unwrap(
        await supabase.from('purchases')
          .select('*, customers(full_name), purchase_items(*, products(name, category)), purchase_services(*)')
          .eq('cash_session_id', sessionId!).order('created_at', { ascending: false }).limit(50),
      ) as Purchase[],
  })
}

const KEYS = ['cash', 'purchases', 'finance', 'stock', 'stock-movements', 'products', 'predictions', 'customers', 'customer', 'dashboard', 'recovery', 'reports', 'reminders']
const invalidate = (qc: ReturnType<typeof useQueryClient>) => KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }))

export function useOpenCash() {
  const qc = useQueryClient()
  const { org } = useOrg()
  return useMutation({
    mutationFn: (v: { opening: number; notes?: string }) => rpc<string>('open_cash_session', { p_org: org.id, p_opening: v.opening, p_notes: v.notes || null }),
    onSuccess: () => {
      toast.success('Caixa aberto.')
      invalidate(qc)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export function useCashMovement() {
  const qc = useQueryClient()
  const { org } = useOrg()
  return useMutation({
    mutationFn: (v: { kind: 'suprimento' | 'sangria'; amount: number; notes?: string }) =>
      rpc<string>('cash_movement', { p_org: org.id, p_kind: v.kind, p_amount: v.amount, p_notes: v.notes || null }),
    onSuccess: (_, v) => {
      toast.success(v.kind === 'sangria' ? 'Retirada registrada.' : 'Reforço registrado.')
      invalidate(qc)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export function useCloseCash() {
  const qc = useQueryClient()
  const { org } = useOrg()
  return useMutation({
    mutationFn: (v: { counted: number; notes?: string }) =>
      rpc<{ expected: number; counted: number; difference: number }>('close_cash_session', { p_org: org.id, p_counted: v.counted, p_notes: v.notes || null }),
    onSuccess: () => invalidate(qc),
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export interface CheckoutInput {
  customer_id: string | null
  items: { product_id: string; quantity: number; unit_price: number; discount: number }[]
  services: { service_id: string; quantity: number; unit_price: number; discount: number }[]
  discount: number
  payments: PaymentInput[]
  notes?: string
  request_id: string
  due_date?: string | null
}

export function useCheckout() {
  const qc = useQueryClient()
  const { org } = useOrg()
  return useMutation({
    mutationFn: (v: CheckoutInput) =>
      rpc<string>('pdv_checkout', {
        p_org: org.id, p_customer: v.customer_id, p_items: v.items, p_services: v.services, p_discount: v.discount,
        p_payments: v.payments, p_notes: v.notes || null, p_request_id: v.request_id, p_due_date: v.due_date || null,
      }),
    onSuccess: () => {
      toast.success('Venda registrada.')
      invalidate(qc)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}
