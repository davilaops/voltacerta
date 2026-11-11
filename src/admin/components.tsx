import * as React from 'react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { useCancelSubscription, useDeleteOrganization } from './api'
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
  confirmDisabled,
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
  confirmDisabled?: boolean
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
          <Button variant={danger ? 'danger' : 'primary'} disabled={!valid || confirmDisabled} loading={loading} onClick={() => onConfirm(reason.trim())}>
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

export type OrgRef = { id: string; name: string } | null

/** Encerrar assinatura: cancela na AbacatePay e corta o acesso imediatamente. */
export function CancelSubscriptionDialog({ org, onClose }: { org: OrgRef; onClose: () => void }) {
  const cancel = useCancelSubscription()
  return (
    <ReasonDialog
      open={!!org}
      onOpenChange={(o) => !o && onClose()}
      danger
      title="Encerrar assinatura"
      description={`A assinatura de “${org?.name ?? ''}” será cancelada agora: a AbacatePay para de cobrar e o estabelecimento fica somente leitura.`}
      confirmLabel="Encerrar assinatura"
      loading={cancel.isPending}
      onConfirm={(reason) => org && cancel.mutate({ orgId: org.id, reason }, { onSuccess: onClose })}
    >
      <p className="rounded-md border border-warning/25 bg-warning/5 px-3 py-2 text-[13px] text-warning">
        O cancelamento na AbacatePay é imediato e não pode ser desfeito. Para voltar, o cliente precisa assinar de novo.
      </p>
    </ReasonDialog>
  )
}

/** Exclusão definitiva: exige digitar o nome do estabelecimento. */
export function DeleteOrgDialog({ org, onClose, onDeleted }: { org: OrgRef; onClose: () => void; onDeleted?: () => void }) {
  const del = useDeleteOrganization()
  const [name, setName] = React.useState('')
  React.useEffect(() => {
    if (org) setName('')
  }, [org])
  const matches = !!org && name.trim() === org.name.trim()
  return (
    <ReasonDialog
      open={!!org}
      onOpenChange={(o) => !o && onClose()}
      danger
      title="Excluir estabelecimento"
      description="Apaga definitivamente o estabelecimento e todos os dados dele: clientes, pets, produtos, compras, previsões, contatos e equipe."
      confirmLabel="Excluir definitivamente"
      confirmDisabled={!matches}
      loading={del.isPending}
      onConfirm={(reason) =>
        org && del.mutate({ orgId: org.id, reason, confirmName: name }, { onSuccess: () => { onClose(); onDeleted?.() } })
      }
    >
      <p className="rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-[13px] text-[#ff8a8a]">
        Esta ação não pode ser desfeita. As contas de usuário continuam existindo e o histórico de pagamentos é mantido, sem vínculo. Se houver assinatura paga em vigor, encerre-a antes.
      </p>
      <Field label={`Digite “${org?.name ?? ''}” para confirmar`} htmlFor="confirm-name">
        <Input id="confirm-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
    </ReasonDialog>
  )
}
