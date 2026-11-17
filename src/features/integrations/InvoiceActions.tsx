import * as React from 'react'
import { ExternalLink, FileText, RefreshCw, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Textarea } from '@/components/ui/input'
import { useOrg } from '@/features/org/OrgProvider'
import type { Invoice, Purchase } from '@/types/models'
import { useInvoiceAction, useInvoices, useIssueInvoice } from './api'

const STATUS: Record<Invoice['status'], { label: string; tone: 'brand' | 'warning' | 'danger' | 'muted' }> = {
  autorizado: { label: 'Autorizada', tone: 'brand' },
  processando: { label: 'Processando', tone: 'warning' },
  erro: { label: 'Rejeitada', tone: 'danger' },
  cancelado: { label: 'Cancelada', tone: 'muted' },
}

/** Emissão e acompanhamento de NFC-e (produtos) e NFS-e (serviços) de uma venda. */
export function InvoiceActions({ purchase }: { purchase: Purchase }) {
  const { ctx, isAdmin, canWrite } = useOrg()
  const invoices = useInvoices(purchase.id)
  const issue = useIssueInvoice()
  const action = useInvoiceAction()
  const [askCpf, setAskCpf] = React.useState<null | 'nfce' | 'nfse'>(null)
  const [cpf, setCpf] = React.useState('')
  const [canceling, setCanceling] = React.useState<Invoice | null>(null)
  const [reason, setReason] = React.useState('')

  if (!ctx.integrations?.fiscal) return <span className="text-xs text-subtle">—</span>
  const list = invoices.data ?? []
  const active = (kind: 'nfce' | 'nfse') => list.find((i) => i.kind === kind && (i.status === 'autorizado' || i.status === 'processando'))
  const hasProducts = (purchase.purchase_items?.length ?? 0) > 0
  const hasServices = (purchase.purchase_services?.length ?? 0) > 0

  return (
    <div className="flex flex-col gap-1.5">
      {list.filter((i) => i.status !== 'erro' || !active(i.kind)).slice(0, 3).map((i) => (
        <div key={i.id} className="flex flex-wrap items-center gap-1.5">
          <Badge tone={STATUS[i.status].tone} className="h-5 px-2 text-[11px]">{i.kind === 'nfce' ? 'NFC-e' : 'NFS-e'} {i.numero ? `nº ${i.numero}` : ''} · {STATUS[i.status].label}</Badge>
          {i.environment === 'homologacao' && <span className="text-[10px] text-warning">teste</span>}
          {i.url_pdf && <a href={i.url_pdf} target="_blank" rel="noopener noreferrer" className="text-brand" aria-label="Abrir nota"><ExternalLink className="size-3.5" /></a>}
          {i.status === 'processando' && <button type="button" className="text-subtle hover:text-fg" aria-label="Atualizar situação" onClick={() => action.mutate({ invoice_id: i.id, action: 'refresh' })}><RefreshCw className="size-3.5" /></button>}
          {i.status === 'autorizado' && isAdmin && <button type="button" className="text-subtle hover:text-danger" aria-label="Cancelar nota" onClick={() => { setReason(''); setCanceling(i) }}><XCircle className="size-3.5" /></button>}
          {i.status === 'erro' && i.message && <span className="w-full text-[11px] text-danger">{i.message}</span>}
        </div>
      ))}
      {canWrite && (
        <div className="flex gap-1.5">
          {hasProducts && !active('nfce') && <Button size="sm" variant="secondary" loading={issue.isPending} onClick={() => { setCpf(''); setAskCpf('nfce') }}><FileText /> NFC-e</Button>}
          {hasServices && !active('nfse') && <Button size="sm" variant="secondary" loading={issue.isPending} onClick={() => { setCpf(''); setAskCpf('nfse') }}><FileText /> NFS-e</Button>}
        </div>
      )}

      {askCpf && (
        <Dialog open onOpenChange={(o) => !o && setAskCpf(null)} size="sm" title={askCpf === 'nfce' ? 'Emitir NFC-e (produtos)' : 'Emitir NFS-e (serviços)'}
          footer={<><Button variant="secondary" onClick={() => setAskCpf(null)}>Cancelar</Button>
            <Button loading={issue.isPending} onClick={() => issue.mutate({ purchase_id: purchase.id, kind: askCpf, cpf: cpf || undefined }, { onSettled: () => setAskCpf(null) })}>Emitir nota</Button></>}>
          <Field label="CPF/CNPJ do cliente na nota" htmlFor="inv-cpf" optional hint="Deixe em branco para consumidor não identificado.">
            <Input id="inv-cpf" inputMode="numeric" autoFocus value={cpf} onChange={(e) => setCpf(e.target.value)} />
          </Field>
        </Dialog>
      )}
      {canceling && (
        <Dialog open onOpenChange={(o) => !o && setCanceling(null)} size="sm" title="Cancelar nota fiscal"
          description={canceling.kind === 'nfce' ? 'A NFC-e só pode ser cancelada até 30 minutos após a emissão.' : 'Alguns municípios não permitem cancelar pela internet.'}
          footer={<><Button variant="secondary" onClick={() => setCanceling(null)}>Voltar</Button>
            <Button variant="danger" loading={action.isPending} disabled={reason.trim().length < 15}
              onClick={() => action.mutate({ invoice_id: canceling.id, action: 'cancel', justificativa: reason.trim() }, { onSuccess: () => setCanceling(null) })}>Cancelar nota</Button></>}>
          <Field label="Justificativa" htmlFor="inv-j" hint="Entre 15 e 255 caracteres.">
            <Textarea id="inv-j" rows={3} maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </Dialog>
      )}
    </div>
  )
}
