import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { rpc, supabase, unwrap } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { invokeFunction } from '@/lib/money'
import { useOrg } from '@/features/org/OrgProvider'
import type { AutoKind, IntegrationSettings, Invoice } from '@/types/models'

export function useIntegrationSettings(enabled = true) {
  const { org } = useOrg()
  return useQuery({
    queryKey: ['integrations', org.id],
    enabled,
    queryFn: () => rpc<IntegrationSettings>('get_integration_settings', { p_org: org.id }),
  })
}

export function useSaveWhatsApp() {
  const qc = useQueryClient()
  const { org } = useOrg()
  return useMutation({
    mutationFn: (v: { enabled: boolean; phone_number_id: string; token: string | null; templates: IntegrationSettings['whatsapp_templates']; auto_kinds: AutoKind[] }) =>
      rpc<void>('save_whatsapp_settings', {
        p_org: org.id, p_enabled: v.enabled, p_phone_number_id: v.phone_number_id, p_token: v.token,
        p_templates: v.templates, p_auto_kinds: v.auto_kinds,
      }),
    onSuccess: () => {
      toast.success('Configuração do WhatsApp salva.')
      qc.invalidateQueries({ queryKey: ['integrations'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export interface FiscalInput {
  enabled: boolean
  environment: 'homologacao' | 'producao'
  token: string | null
  cnpj: string
  ie: string
  im: string
  city_code: string
  simples: boolean
  icms_situation: string
  service_item: string
  municipal_tax_code: string
  iss_rate: number | null
}

export function useSaveFiscal() {
  const qc = useQueryClient()
  const { org } = useOrg()
  return useMutation({
    mutationFn: (v: FiscalInput) =>
      rpc<void>('save_fiscal_settings', {
        p_org: org.id, p_enabled: v.enabled, p_environment: v.environment, p_token: v.token, p_cnpj: v.cnpj,
        p_ie: v.ie, p_im: v.im, p_city_code: v.city_code, p_simples: v.simples, p_icms_situation: v.icms_situation,
        p_service_item: v.service_item, p_municipal_tax_code: v.municipal_tax_code, p_iss_rate: v.iss_rate,
      }),
    onSuccess: () => {
      toast.success('Configuração fiscal salva.')
      qc.invalidateQueries({ queryKey: ['integrations'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

const WA_ERRORS: Record<string, string> = {
  INTEGRATION_INCOMPLETE: 'Preencha o ID do número e o token antes de testar.',
  TEMPLATE_NOT_CONFIGURED: 'Informe o nome do modelo aprovado para este tipo de mensagem.',
  INVALID_PHONE: 'Telefone de teste inválido.',
  FORBIDDEN: 'Somente proprietários e administradores.',
}

export function useWhatsAppRun() {
  const qc = useQueryClient()
  const { org } = useOrg()
  return useMutation({
    mutationFn: () => invokeFunction<{ sent: number; failed: number; skipped: number }>('whatsapp-dispatch', { organization_id: org.id, action: 'run' }),
    onSuccess: (r) => {
      toast.success(r.sent || r.failed ? `${r.sent} mensagem(ns) enviada(s)${r.failed ? `, ${r.failed} com erro` : ''}.` : 'Nenhuma mensagem pendente agora.')
      for (const k of ['integrations', 'reminders', 'recovery', 'predictions']) qc.invalidateQueries({ queryKey: [k] })
    },
    onError: (e) => toast.error(WA_ERRORS[(e as Error).message] ?? errorMessage(e)),
  })
}

export function useWhatsAppTest() {
  const { org } = useOrg()
  return useMutation({
    mutationFn: (v: { phone: string; kind: AutoKind }) => invokeFunction<{ id: string }>('whatsapp-dispatch', { organization_id: org.id, action: 'test', ...v }),
    onSuccess: () => toast.success('Mensagem de teste enviada. Confira no WhatsApp.'),
    onError: (e) => {
      const err = e as Error & { details?: string }
      toast.error(WA_ERRORS[err.message] ?? (err.details ? `WhatsApp: ${err.details}` : errorMessage(e)))
    },
  })
}

// ---------------------------------------------------------------------
// Notas fiscais
// ---------------------------------------------------------------------
export function useInvoices(purchaseId?: string) {
  const { org } = useOrg()
  return useQuery({
    queryKey: ['invoices', org.id, purchaseId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('invoices').select('*').eq('organization_id', org.id).order('created_at', { ascending: false }).limit(100)
      if (purchaseId) q = q.eq('purchase_id', purchaseId)
      return unwrap(await q) as Invoice[]
    },
  })
}

function fiscalError(e: unknown): string {
  const err = e as Error & { details?: string }
  if (err.message === 'FISCAL_DATA_MISSING' && err.details) {
    try {
      const names = JSON.parse(err.details) as string[]
      if (Array.isArray(names)) return `Informe o NCM dos produtos: ${names.join(', ')}.`
    } catch {
      return err.details
    }
  }
  if (err.message === 'CANCEL_REFUSED') return `Cancelamento recusado: ${err.details ?? 'tente novamente'}`
  if (err.message === 'INVALID_JUSTIFICATION') return 'A justificativa precisa ter entre 15 e 255 caracteres.'
  if (err.message === 'FISCAL_PROVIDER_ERROR') return 'Não foi possível falar com o emissor de notas. Tente novamente.'
  return errorMessage(e)
}

export function useIssueInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { purchase_id: string; kind: 'nfce' | 'nfse'; cpf?: string }) =>
      invokeFunction<{ status: string; message: string | null }>('fiscal-invoice', { action: 'issue', ...v }),
    onSuccess: (r) => {
      if (r.status === 'autorizado') toast.success('Nota fiscal autorizada.')
      else if (r.status === 'processando') toast.success('Nota enviada. A prefeitura está processando; atualize em instantes.')
      qc.invalidateQueries({ queryKey: ['invoices'] })
    },
    onError: (e) => {
      toast.error(fiscalError(e))
      qc.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
}

export function useInvoiceAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { invoice_id: string; action: 'refresh' | 'cancel'; justificativa?: string }) => invokeFunction<{ status: string }>('fiscal-invoice', v),
    onSuccess: (r, v) => {
      toast.success(v.action === 'cancel' ? 'Nota cancelada.' : `Situação atualizada: ${r.status}.`)
      qc.invalidateQueries({ queryKey: ['invoices'] })
    },
    onError: (e) => toast.error(fiscalError(e)),
  })
}
