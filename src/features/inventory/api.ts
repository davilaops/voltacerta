import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { rpc, supabase, unwrap } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { useOrg } from '@/features/org/OrgProvider'
import type { StockMovement, StockOverview } from '@/types/models'

export function useStockOverview(horizon: number) {
  const { org } = useOrg()
  return useQuery({
    queryKey: ['stock', org.id, horizon],
    queryFn: () => rpc<StockOverview>('stock_overview', { p_org: org.id, p_horizon_days: horizon }),
  })
}

export function useStockMovements(productId?: string | null) {
  const { org } = useOrg()
  return useQuery({
    queryKey: ['stock-movements', org.id, productId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('stock_movements').select('*, products(name, unit)').eq('organization_id', org.id)
        .order('created_at', { ascending: false }).limit(100)
      if (productId) q = q.eq('product_id', productId)
      return unwrap(await q) as StockMovement[]
    },
  })
}

export type AdjustKind = 'entrada' | 'perda' | 'ajuste' | 'inventario'

export function useStockAdjust() {
  const qc = useQueryClient()
  const { org } = useOrg()
  return useMutation({
    mutationFn: (v: { product_id: string; kind: AdjustKind; quantity: number; unit_cost?: number | null; notes?: string; update_cost?: boolean }) =>
      rpc<number>('stock_adjust', {
        p_org: org.id, p_product: v.product_id, p_kind: v.kind, p_quantity: v.quantity,
        p_unit_cost: v.unit_cost ?? null, p_notes: v.notes || null, p_update_cost: v.update_cost ?? false,
      }),
    onSuccess: (balance) => {
      toast.success(`Estoque atualizado. Saldo atual: ${Number(balance).toLocaleString('pt-BR')}.`)
      for (const k of ['stock', 'stock-movements', 'products']) qc.invalidateQueries({ queryKey: [k] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}
