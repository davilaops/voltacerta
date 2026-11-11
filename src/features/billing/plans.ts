import { useQuery } from '@tanstack/react-query'
import { isSupabaseConfigured, supabase, unwrap } from '@/lib/supabase'
import type { PlanTier } from '@/types/models'

/** Plano vindo da tabela public.plans — fonte única de preços e limites. */
export interface Plan {
  id: PlanTier
  name: string
  price_cents: number
  currency: 'BRL'
  customer_limit: number | null
  features: { reports_full?: boolean; history_advanced?: boolean; reports_advanced?: boolean }
  highlights: string[]
  sort_order: number
  highlight: boolean
}

export function usePlans() {
  return useQuery({
    queryKey: ['plans'],
    enabled: isSupabaseConfigured,
    staleTime: 10 * 60_000,
    queryFn: async () => unwrap(await supabase.from('plans').select('*').order('sort_order')) as Plan[],
  })
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export const formatCents = (cents: number) => brl.format(cents / 100)

export const customerLimitLabel = (limit: number | null) => (limit == null ? 'Clientes ilimitados' : `Até ${limit} clientes`)
