import * as React from 'react'
import { ExternalLink, MessageCircle, PhoneOff } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { CONTACT_RESULT } from '@/domain/labels'
import { useOrg } from '@/features/org/OrgProvider'
import { useLogContact, useTemplates } from '@/features/replenishment/api'
import { buildWhatsAppLink, renderTemplate } from '@/lib/whatsapp'
import { formatPhone } from '@/lib/format'
import type { ContactResult } from '@/types/models'

export interface ContactTarget {
  customerId: string
  customerName: string
  phone: string | null
  doNotContact?: boolean
  predictionId?: string | null
  productName?: string | null
  petName?: string | null
  /** Sugere o modelo "Cliente atrasado" */
  overdue?: boolean
}

/**
 * Fluxo de contato:
 * 1) escolher modelo e revisar a mensagem; 2) abrir o WhatsApp (wa.me);
 * 3) o contato só é registrado quando o usuário confirma e informa o resultado.
 */
export function ContactDialog({ target, onClose }: { target: ContactTarget | null; onClose: () => void }) {
  const { org, ctx, canWrite } = useOrg()
  const templates = useTemplates()
  const log = useLogContact()
  const [templateId, setTemplateId] = React.useState<string>('')
  const [message, setMessage] = React.useState('')
  const [opened, setOpened] = React.useState(false)
  const [result, setResult] = React.useState<ContactResult>('respondeu')
  const [followUp, setFollowUp] = React.useState('')
  const [notes, setNotes] = React.useState('')

  React.useEffect(() => {
    if (!target || !templates.data?.length) return
    const preferred =
      templates.data.find((t) => t.kind === (target.overdue ? 'atrasado' : target.productName ? 'reposicao' : 'atrasado')) ?? templates.data[0]
    setTemplateId(preferred.id)
    setMessage(renderTemplate(preferred.body, { nome: target.customerName, produto: target.productName, pet: target.petName, loja: org.name }))
    setOpened(false)
    setResult('respondeu')
    setFollowUp('')
    setNotes('')
  }, [target, templates.data, org.name])

  if (!target) return null
  const link = buildWhatsAppLink(target.phone, message)

  const changeTemplate = (id: string) => {
    setTemplateId(id)
    const t = templates.data?.find((x) => x.id === id)
    if (t) setMessage(renderTemplate(t.body, { nome: target.customerName, produto: target.productName, pet: target.petName, loja: org.name }))
  }

  const submit = () => {
    log.mutate(
      {
        customer_id: target.customerId,
        prediction_id: target.predictionId,
        template_id: templateId || null,
        message,
        result,
        follow_up_date: result === 'retornar_depois' ? followUp : null,
        notes,
      },
      { onSuccess: onClose },
    )
  }

  if (target.doNotContact) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()} title="Contato bloqueado" size="sm">
        <div className="flex gap-3 text-sm text-muted">
          <PhoneOff className="mt-0.5 size-5 shrink-0 text-danger" />
          <p>
            <strong className="text-fg">{target.customerName}</strong> pediu para não receber contato comercial. Respeitamos essa solicitação conforme a LGPD. Para alterar, edite o cadastro do cliente com a autorização dele.
          </p>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Contatar ${target.customerName.split(' ')[0]}`}
      description={target.phone ? `WhatsApp ${formatPhone(target.phone)}` : 'Cliente sem telefone cadastrado'}
      footer={
        opened ? (
          <>
            <Button variant="secondary" onClick={() => setOpened(false)}>
              Voltar
            </Button>
            <Button onClick={submit} loading={log.isPending} disabled={!canWrite || (result === 'retornar_depois' && !followUp)}>
              Registrar contato
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setOpened(true)}>
              Já contatei por outro meio
            </Button>
            {link ? (
              <Button variant="whatsapp" asChild>
                <a href={link} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)}>
                  <MessageCircle /> Abrir WhatsApp <ExternalLink className="opacity-60" />
                </a>
              </Button>
            ) : (
              <Button disabled>Sem telefone válido</Button>
            )}
          </>
        )
      }
    >
      {!opened ? (
        <div className="space-y-4">
          <Field label="Modelo de mensagem" htmlFor="tpl">
            <Select id="tpl" value={templateId} onChange={(e) => changeTemplate(e.target.value)}>
              {templates.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Mensagem" htmlFor="msg" hint="Revise antes de enviar. O envio é feito por você no WhatsApp.">
            <Textarea id="msg" rows={5} value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} />
          </Field>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="rounded-md border border-border bg-surface-2/60 px-3 py-2.5 text-[13px] text-muted">
            Depois de conversar com o cliente, informe o resultado. O contato só é registrado após a sua confirmação.
          </p>
          <Field label="Resultado do contato" htmlFor="result">
            <Select id="result" value={result} onChange={(e) => setResult(e.target.value as ContactResult)}>
              {Object.entries(CONTACT_RESULT).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          {result === 'retornar_depois' && (
            <Field label="Retornar em" htmlFor="fu">
              <Input id="fu" type="date" value={followUp} min={ctx.today} onChange={(e) => setFollowUp(e.target.value)} />
            </Field>
          )}
          {result === 'comprou' && (
            <p className="text-[13px] text-brand">Lembre-se de registrar a compra para concluir a recompra e contabilizar a venda recuperada.</p>
          )}
          <Field label="Observações" htmlFor="notes" optional>
            <Textarea id="notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      )}
    </Dialog>
  )
}
