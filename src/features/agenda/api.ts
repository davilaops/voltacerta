import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { rpc, supabase, unwrap } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { useOrg } from '@/features/org/OrgProvider'
import type { AppointmentStatus, AppointmentView, PaymentInput } from '@/types/models'

/** Converte data local (YYYY-MM-DD) + hora (HH:MM) do fuso da loja em ISO com offset. */
export function localToISO(date: string, time: string, timeZone: string): string {
  // Descobre o deslocamento do fuso naquela data (Brasil hoje não tem horário de verão, mas não presumimos)
  const guess = new Date(`${date}T${time}:00Z`)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(guess)
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value)
  const asLocal = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
  const offsetMin = Math.round((asLocal - guess.getTime()) / 60000)
  return new Date(guess.getTime() - offsetMin * 60000).toISOString()
}

/** Data e hora locais (fuso da loja) de um timestamp. */
export function isoToLocal(iso: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

export function formatTime(iso: string, timeZone: string): string {
  return isoToLocal(iso, timeZone).time
}

/** Agendamentos entre duas datas locais (inclusive). */
export function useAppointments(from: string, to: string) {
  const { org } = useOrg()
  return useQuery({
    queryKey: ['appointments', org.id, from, to],
    queryFn: async () => {
      const start = localToISO(from, '00:00', org.timezone)
      const end = localToISO(to, '23:59', org.timezone)
      return unwrap(
        await supabase.from('v_appointments').select('*').eq('organization_id', org.id)
          .gte('starts_at', start).lte('starts_at', end).order('starts_at'),
      ) as AppointmentView[]
    },
  })
}

/** Solicitações online aguardando confirmação (qualquer data futura). */
export function usePendingRequests() {
  const { org } = useOrg()
  return useQuery({
    queryKey: ['appointments', org.id, 'requests'],
    queryFn: async () =>
      unwrap(
        await supabase.from('v_appointments').select('*').eq('organization_id', org.id).eq('status', 'requested')
          .gte('starts_at', new Date(Date.now() - 86400000).toISOString()).order('starts_at'),
      ) as AppointmentView[],
    refetchInterval: 60_000,
  })
}

export function useCustomerAppointments(customerId: string | undefined) {
  return useQuery({
    queryKey: ['appointments', 'customer', customerId],
    enabled: !!customerId,
    queryFn: async () =>
      unwrap(await supabase.from('v_appointments').select('*').eq('customer_id', customerId!).order('starts_at', { ascending: false }).limit(50)) as AppointmentView[],
  })
}

const KEYS = ['appointments', 'reminders', 'customer-packages', 'purchases', 'finance', 'cash', 'customer-insights', 'dashboard']
const invalidate = (qc: ReturnType<typeof useQueryClient>) => KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }))

export interface AppointmentInput {
  id?: string
  customer_id: string | null
  pet_id: string | null
  service_id: string
  professional_id: string | null
  starts_at: string
  duration_minutes: number | null
  price: number | null
  customer_package_id: string | null
  notes: string
}

export function useSaveAppointment() {
  const qc = useQueryClient()
  const { org } = useOrg()
  return useMutation({
    mutationFn: (v: AppointmentInput) =>
      rpc<string>('save_appointment', {
        p_org: org.id, p_id: v.id ?? null, p_customer: v.customer_id, p_pet: v.pet_id, p_service: v.service_id,
        p_professional: v.professional_id, p_starts_at: v.starts_at, p_duration_minutes: v.duration_minutes,
        p_price: v.price, p_customer_package: v.customer_package_id, p_notes: v.notes || null,
      }),
    onSuccess: (_, v) => {
      toast.success(v.id ? 'Agendamento atualizado.' : 'Agendamento criado.')
      invalidate(qc)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export function useSetAppointmentStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; status: Exclude<AppointmentStatus, 'done' | 'requested'>; reason?: string }) =>
      rpc<void>('set_appointment_status', { p_id: v.id, p_status: v.status, p_reason: v.reason ?? null }),
    onSuccess: () => invalidate(qc),
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export function useCompleteAppointment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; payments: PaymentInput[] | null; request_id: string; due_date?: string | null }) =>
      rpc<string | null>('complete_appointment', { p_id: v.id, p_payments: v.payments, p_request_id: v.request_id, p_due_date: v.due_date || null }),
    onSuccess: () => {
      toast.success('Atendimento concluído.')
      invalidate(qc)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}
