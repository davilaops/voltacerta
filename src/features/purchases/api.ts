import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { rpc, supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { useOrg } from '@/features/org/OrgProvider'
import type { Purchase } from '@/types/models'

export interface PurchaseItemInput {
  product_id: string
  quantity: number
  unit_price: number
  discount: number
}

export interface CreatePurchaseInput {
  customer_id: string
  purchase_date: string
  items: PurchaseItemInput[]
  discount: number
  notes?: string
  request_id: string
}

export const PURCHASES_PAGE = 25

export function usePurchases(params: { from: string; to: string; page: number }) {
  const { org } = useOrg()
  return useQuery({
    queryKey: ['purchases', org.id, params],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, count, error } = await supabase
        .from('purchases')
        .select('*, customers(full_name), purchase_items(*, products(name, category))', { count: 'exact' })
        .eq('organization_id', org.id)
        .gte('purchase_date', params.from)
        .lte('purchase_date', params.to)
        .order('purchase_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(params.page * PURCHASES_PAGE, params.page * PURCHASES_PAGE + PURCHASES_PAGE - 1)
      if (error) throw error
      return { rows: (data ?? []) as Purchase[], count: count ?? 0 }
    },
  })
}

function invalidateAfterPurchase(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ['purchases', 'predictions', 'customers', 'customer', 'dashboard', 'recovery', 'reports']) {
    qc.invalidateQueries({ queryKey: [key] })
  }
}

/** Registro atômico no servidor (RPC create_purchase): itens + previsões em uma transação. */
export function useCreatePurchase() {
  const qc = useQueryClient()
  const { org } = useOrg()
  return useMutation({
    mutationFn: (v: CreatePurchaseInput) =>
      rpc<string>('create_purchase', {
        p_org: org.id,
        p_customer: v.customer_id,
        p_purchase_date: v.purchase_date,
        p_items: v.items,
        p_discount: v.discount,
        p_notes: v.notes || null,
        p_request_id: v.request_id,
      }),
    onSuccess: () => {
      toast.success('Compra registrada. Previsões de recompra atualizadas.')
      invalidateAfterPurchase(qc)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export function useDeletePurchase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => rpc<void>('delete_purchase', { p_purchase: id }),
    onSuccess: () => {
      toast.success('Compra excluída.')
      invalidateAfterPurchase(qc)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}
