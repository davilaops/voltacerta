import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { rpc } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { useOrg } from '@/features/org/OrgProvider'
import type { ContactResult, CustomerInsights, CustomerSegments, Reminder } from '@/types/models'

export function useReminders(daysAhead = 7) {
  const { org } = useOrg()
  return useQuery({
    queryKey: ['reminders', org.id, daysAhead],
    queryFn: () => rpc<Reminder[]>('get_reminders', { p_org: org.id, p_days_ahead: daysAhead }),
  })
}

export function useLogReminder() {
  const qc = useQueryClient()
  const { org } = useOrg()
  return useMutation({
    mutationFn: (v: { customer_id: string; key: string; result: ContactResult; template_id: string | null; message: string; notes?: string }) =>
      rpc<string>('log_reminder_contact', {
        p_org: org.id, p_customer: v.customer_id, p_key: v.key, p_result: v.result,
        p_template: v.template_id, p_message: v.message, p_notes: v.notes || null,
      }),
    onSuccess: () => {
      toast.success('Contato registrado.')
      for (const k of ['reminders', 'appointments', 'customer']) qc.invalidateQueries({ queryKey: [k] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export function useCustomerInsights(customerId: string | undefined) {
  return useQuery({
    queryKey: ['customer-insights', customerId],
    enabled: !!customerId,
    queryFn: () => rpc<CustomerInsights>('customer_insights', { p_customer: customerId }),
  })
}

export function useCustomerSegments() {
  const { org } = useOrg()
  return useQuery({
    queryKey: ['segments', org.id],
    queryFn: () => rpc<CustomerSegments>('customer_segments', { p_org: org.id }),
  })
}
