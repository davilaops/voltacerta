import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { rpc, supabase, unwrap } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { useOrg } from '@/features/org/OrgProvider'
import type { ContactLog, Customer, CustomerSituation, CustomerView, Pet, PredictionView, Purchase } from '@/types/models'
import type { CustomerInput, PetInput } from './schemas'

export const PAGE_SIZE = 25

/** Remove caracteres que quebram o filtro `or` do PostgREST. */
export function sanitizeSearch(s: string): string {
  return s.replace(/[,()*%\\]/g, ' ').trim()
}

export function useCustomers(params: { search: string; situation: CustomerSituation | 'all'; page: number }) {
  const { org } = useOrg()
  return useQuery({
    queryKey: ['customers', org.id, params],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase
        .from('v_customers')
        .select('*', { count: 'exact' })
        .eq('organization_id', org.id)
        .order('full_name')
        .range(params.page * PAGE_SIZE, params.page * PAGE_SIZE + PAGE_SIZE - 1)
      const s = sanitizeSearch(params.search)
      if (s) {
        const digits = s.replace(/\D/g, '')
        q = digits.length >= 4 ? q.or(`phone_normalized.ilike.*${digits}*,full_name.ilike.*${s}*`) : q.ilike('full_name', `%${s}%`)
      }
      if (params.situation !== 'all') q = q.eq('situation', params.situation)
      const { data, count, error } = await q
      if (error) throw error
      return { rows: (data ?? []) as CustomerView[], count: count ?? 0 }
    },
  })
}

/** Busca rápida para seletores (compras, recompras). */
export function useCustomerSearch(search: string) {
  const { org } = useOrg()
  return useQuery({
    queryKey: ['customer-search', org.id, search],
    queryFn: async () => {
      let q = supabase.from('customers').select('id, full_name, phone').eq('organization_id', org.id).order('full_name').limit(20)
      const s = sanitizeSearch(search)
      if (s) {
        const digits = s.replace(/\D/g, '')
        q = digits.length >= 4 ? q.or(`phone_normalized.ilike.*${digits}*,full_name.ilike.*${s}*`) : q.ilike('full_name', `%${s}%`)
      }
      return unwrap(await q) as Pick<Customer, 'id' | 'full_name' | 'phone'>[]
    },
  })
}

export function useCustomer(id: string | undefined) {
  const { org } = useOrg()
  return useQuery({
    queryKey: ['customer', org.id, id],
    enabled: !!id,
    queryFn: async () => unwrap(await supabase.from('v_customers').select('*').eq('id', id!).maybeSingle()) as CustomerView | null,
  })
}

export function usePets(customerId: string | undefined) {
  return useQuery({
    queryKey: ['pets', customerId],
    enabled: !!customerId,
    queryFn: async () => unwrap(await supabase.from('pets').select('*').eq('customer_id', customerId!).order('created_at')) as Pet[],
  })
}

export function useCustomerPurchases(customerId: string | undefined) {
  return useQuery({
    queryKey: ['purchases', 'customer', customerId],
    enabled: !!customerId,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('purchases')
          .select('*, purchase_items(*, products(name, category))')
          .eq('customer_id', customerId!)
          .order('purchase_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(100),
      ) as Purchase[],
  })
}

export function useCustomerPredictions(customerId: string | undefined) {
  return useQuery({
    queryKey: ['predictions', 'customer', customerId],
    enabled: !!customerId,
    queryFn: async () =>
      unwrap(
        await supabase.from('v_predictions').select('*').eq('customer_id', customerId!).order('expected_date', { ascending: false }).limit(200),
      ) as PredictionView[],
  })
}

export function useCustomerContacts(customerId: string | undefined) {
  return useQuery({
    queryKey: ['contacts', 'customer', customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const logs = unwrap(
        await supabase.from('contact_logs').select('*').eq('customer_id', customerId!).order('contacted_at', { ascending: false }).limit(100),
      ) as ContactLog[]
      return attachProfiles(logs)
    },
  })
}

/** Junta o nome do responsável (profiles visíveis via RLS para membros da mesma organização). */
export async function attachProfiles(logs: ContactLog[]): Promise<ContactLog[]> {
  const ids = [...new Set(logs.map((l) => l.user_id).filter(Boolean))] as string[]
  if (!ids.length) return logs
  const profiles = unwrap(await supabase.from('profiles').select('id, full_name, email').in('id', ids)) as { id: string; full_name: string | null; email: string | null }[]
  const map = new Map(profiles.map((p) => [p.id, p]))
  return logs.map((l) => ({ ...l, profiles: l.user_id ? map.get(l.user_id) ?? null : null }))
}

function cleanCustomer(v: CustomerInput) {
  return {
    full_name: v.full_name,
    phone: v.phone || null,
    email: v.email || null,
    notes: v.notes || null,
    marketing_consent: v.marketing_consent,
    do_not_contact: v.do_not_contact,
  }
}

export function useSaveCustomer() {
  const qc = useQueryClient()
  const { org } = useOrg()
  return useMutation({
    mutationFn: async ({ id, values, pet }: { id?: string; values: CustomerInput; pet?: PetInput | null }) => {
      if (id) {
        return unwrap(await supabase.from('customers').update(cleanCustomer(values)).eq('id', id).select().single()) as Customer
      }
      const customer = unwrap(
        await supabase.from('customers').insert({ ...cleanCustomer(values), organization_id: org.id }).select().single(),
      ) as Customer
      if (pet?.name) {
        const { error } = await supabase.from('pets').insert(cleanPet(pet, customer.id, org.id))
        if (error) toast.error(`Cliente salvo, mas o pet não foi cadastrado: ${errorMessage(error)}`)
      }
      return customer
    },
    onSuccess: (_, vars) => {
      toast.success(vars.id ? 'Cliente atualizado.' : 'Cliente cadastrado.')
      qc.invalidateQueries({ queryKey: ['customers'] })
      qc.invalidateQueries({ queryKey: ['customer'] })
      qc.invalidateQueries({ queryKey: ['customer-search'] })
      qc.invalidateQueries({ queryKey: ['org-context'] })
      qc.invalidateQueries({ queryKey: ['pets'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export function useDeleteCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = unwrap(await supabase.from('customers').delete().eq('id', id).select('id'))
      if (!res || (res as unknown[]).length === 0) throw new Error('FORBIDDEN')
    },
    onSuccess: () => {
      toast.success('Cliente e dados associados excluídos.')
      qc.invalidateQueries()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

function cleanPet(v: PetInput, customerId: string, orgId: string) {
  return {
    organization_id: orgId,
    customer_id: customerId,
    name: v.name,
    species: v.species,
    breed: v.breed || null,
    birth_date: v.birth_date || null,
    notes: v.notes || null,
  }
}

export function useSavePet(customerId: string) {
  const qc = useQueryClient()
  const { org } = useOrg()
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: PetInput }) => {
      const row = cleanPet(values, customerId, org.id)
      if (id) unwrap(await supabase.from('pets').update(row).eq('id', id).select().single())
      else unwrap(await supabase.from('pets').insert(row).select().single())
    },
    onSuccess: (_, v) => {
      toast.success(v.id ? 'Pet atualizado.' : 'Pet adicionado.')
      qc.invalidateQueries({ queryKey: ['pets', customerId] })
      qc.invalidateQueries({ queryKey: ['customer'] })
      qc.invalidateQueries({ queryKey: ['customers'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export function useDeletePet(customerId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await supabase.from('pets').delete().eq('id', id).select('id'))
    },
    onSuccess: () => {
      toast.success('Pet removido.')
      qc.invalidateQueries({ queryKey: ['pets', customerId] })
      qc.invalidateQueries({ queryKey: ['customer'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export async function exportCustomerData(customerId: string) {
  return rpc<unknown>('export_customer_data', { p_customer: customerId })
}
