import * as React from 'react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field, Textarea } from '@/components/ui/input'
import { Badge } from '@/components/ui/card'
import { SUBSCRIPTION_STATUS } from '@/domain/labels'
import type { SubscriptionStatus } from '@/types/models'

/** Diálogo que exige justificativa para ações administrativas (validada também no banco). */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  danger,
  loading,
  onConfirm,
  children,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description: string
  confirmLabel: string
  danger?: boolean
  loading?: boolean
  onConfirm: (reason: string) => void
  children?: React.ReactNode
}) {
  const [reason, setReason] = React.useState('')
  React.useEffect(() => {
    if (open) setReason('')
  }, [open])
  const valid = reason.trim().length >= 5
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant={danger ? 'danger' : 'primary'} disabled={!valid} loading={loading} onClick={() => onConfirm(reason.trim())}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {children}
        <Field label="Justificativa" htmlFor="reason" hint="Obrigatória (mín. 5 caracteres). Fica registrada na auditoria.">
          <Textarea id="reason" rows={3} maxLength={500} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  )
}

export function OrgStatusBadge({ status, suspended }: { status: SubscriptionStatus | null; suspended: boolean }) {
  if (suspended) return <Badge tone="danger" dot>Suspenso</Badge>
  if (!status) return <Badge tone="muted">Sem assinatura</Badge>
  const s = SUBSCRIPTION_STATUS[status]
  return <Badge tone={s.tone} dot>{s.label}</Badge>
}

export const ORG_STATUS_FILTERS = [
  { value: '', label: 'Todos os status' },
  { value: 'trialing', label: 'Em teste' },
  { value: 'active', label: 'Ativos' },
  { value: 'past_due', label: 'Atrasados' },
  { value: 'canceled', label: 'Cancelados' },
  { value: 'expired', label: 'Expirados' },
  { value: 'suspended', label: 'Suspensos' },
]
