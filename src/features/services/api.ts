import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { rpc, supabase, unwrap } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { useOrg } from '@/features/org/OrgProvider'
import type { CustomerPackage, PaymentInput, Professional, Service, ServicePackage } from '@/types/models'

const invalidate = (qc: ReturnType<typeof useQueryClient>, keys: string[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }))

// ---------------------------------------------------------------------
// Serviços
// ---------------------------------------------------------------------
export function useServices(opts: { includeInactive?: boolean } = {}) {
  const { org } = useOrg()
  return useQuery({
    queryKey: ['services', org.id, opts.includeInactive ?? false],
    queryFn: async () => {
      let q = supabase.from('services').select('*').eq('organization_id', org.id).order('name')
      if (!opts.includeInactive) q = q.eq('active', true)
      return unwrap(await q) as Service[]
    },
  })
}

export type ServiceInput = Omit<Service, 'id' | 'organization_id' | 'created_at'>

export function useSaveService() {
  const qc = useQueryClient()
  const { org } = useOrg()
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: ServiceInput }) => {
      if (id) return unwrap(await supabase.from('services').update(values).eq('id', id).select().single()) as Service
      return unwrap(await supabase.from('services').insert({ ...values, organization_id: org.id }).select().single()) as Service
    },
    onSuccess: (_, v) => {
      toast.success(v.id ? 'Serviço atualizado.' : 'Serviço cadastrado.')
      invalidate(qc, ['services'])
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export function useDeleteService() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = unwrap(await supabase.from('services').delete().eq('id', id).select('id')) as unknown[]
      if (!res.length) throw new Error('FORBIDDEN')
    },
    onSuccess: () => {
      toast.success('Serviço excluído.')
      invalidate(qc, ['services'])
    },
    onError: (e) => {
      const code = (e as { code?: string }).code
      toast.error(code === '23503' ? 'Este serviço já tem atendimentos ou vendas. Desative-o em vez de excluir.' : errorMessage(e))
    },
  })
}

// ---------------------------------------------------------------------
// Profissionais
// ---------------------------------------------------------------------
export function useProfessionals(opts: { includeInactive?: boolean } = {}) {
  const { org } = useOrg()
  return useQuery({
    queryKey: ['professionals', org.id, opts.includeInactive ?? false],
    queryFn: async () => {
      let q = supabase.from('professionals').select('*').eq('organization_id', org.id).order('name')
      if (!opts.includeInactive) q = q.eq('active', true)
      return unwrap(await q) as Professional[]
    },
  })
}

export type ProfessionalInput = Omit<Professional, 'id' | 'organization_id'>

export function useSaveProfessional() {
  const qc = useQueryClient()
  const { org } = useOrg()
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: ProfessionalInput }) => {
      if (id) return unwrap(await supabase.from('professionals').update(values).eq('id', id).select().single()) as Professional
      return unwrap(await supabase.from('professionals').insert({ ...values, organization_id: org.id }).select().single()) as Professional
    },
    onSuccess: (_, v) => {
      toast.success(v.id ? 'Profissional atualizado.' : 'Profissional cadastrado.')
      invalidate(qc, ['professionals'])
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export function useDeleteProfessional() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = unwrap(await supabase.from('professionals').delete().eq('id', id).select('id')) as unknown[]
      if (!res.length) throw new Error('FORBIDDEN')
    },
    onSuccess: () => {
      toast.success('Profissional removido. Os atendimentos dele ficam sem profissional definido.')
      invalidate(qc, ['professionals', 'appointments'])
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

// ---------------------------------------------------------------------
// Pacotes
// ---------------------------------------------------------------------
export function usePackages(opts: { includeInactive?: boolean } = {}) {
  const { org } = useOrg()
  return useQuery({
    queryKey: ['service-packages', org.id, opts.includeInactive ?? false],
    queryFn: async () => {
      let q = supabase.from('service_packages').select('*, services(name)').eq('organization_id', org.id).order('name')
      if (!opts.includeInactive) q = q.eq('active', true)
      return unwrap(await q) as ServicePackage[]
    },
  })
}

export type PackageInput = Pick<ServicePackage, 'name' | 'service_id' | 'sessions' | 'price' | 'validity_days' | 'active'>

export function useSavePackage() {
  const qc = useQueryClient()
  const { org } = useOrg()
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: PackageInput }) => {
      if (id) return unwrap(await supabase.from('service_packages').update(values).eq('id', id).select().single())
      return unwrap(await supabase.from('service_packages').insert({ ...values, organization_id: org.id }).select().single())
    },
    onSuccess: (_, v) => {
      toast.success(v.id ? 'Pacote atualizado.' : 'Pacote cadastrado.')
      invalidate(qc, ['service-packages'])
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export function useCustomerPackages(customerId: string | null | undefined, onlyActive = true) {
  return useQuery({
    queryKey: ['customer-packages', customerId, onlyActive],
    enabled: !!customerId,
    queryFn: async () => {
      let q = supabase.from('customer_packages').select('*').eq('customer_id', customerId!).order('created_at', { ascending: false })
      if (onlyActive) q = q.eq('status', 'active')
      return unwrap(await q) as CustomerPackage[]
    },
  })
}

export function useSellPackage() {
  const qc = useQueryClient()
  const { org } = useOrg()
  return useMutation({
    mutationFn: (v: { customer_id: string; pet_id: string | null; package_id: string; payments: PaymentInput[]; due_date?: string | null; request_id: string }) =>
      rpc<string>('sell_package', {
        p_org: org.id, p_customer: v.customer_id, p_pet: v.pet_id, p_package: v.package_id,
        p_payments: v.payments, p_request_id: v.request_id, p_due_date: v.due_date || null,
      }),
    onSuccess: () => {
      toast.success('Pacote vendido. As sessões já podem ser usadas na agenda.')
      invalidate(qc, ['customer-packages', 'purchases', 'finance', 'cash', 'customer-insights'])
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export function useCancelCustomerPackage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => rpc<void>('cancel_customer_package', { p_id: id }),
    onSuccess: () => {
      toast.success('Pacote cancelado.')
      invalidate(qc, ['customer-packages', 'appointments', 'customer-insights'])
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}
