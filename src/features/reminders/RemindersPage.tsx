import * as React from 'react'
import { Link } from 'react-router-dom'
import { BellRing, Cake, CalendarClock, ExternalLink, Gift, MessageCircle, PhoneOff, Repeat, Send, ShoppingBag } from 'lucide-react'
import { Badge, Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
import { Segmented } from '@/components/ui/menu'
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/ui/states'
import { renderAgendaTemplate } from '@/features/agenda/AppointmentDialogs'
import { isoToLocal } from '@/features/agenda/api'
import { useWhatsAppRun } from '@/features/integrations/api'
import { useTemplates } from '@/features/replenishment/api'
import { useOrg } from '@/features/org/OrgProvider'
import { CONTACT_RESULT, REMINDER_KIND } from '@/domain/labels'
import { formatDate, formatPhone, formatRelativeDays } from '@/lib/format'
import { diffDaysISO } from '@/lib/dates'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { buildWhatsAppLink } from '@/lib/whatsapp'
import type { ContactResult, Reminder, ReminderKind } from '@/types/models'
import { useLogReminder, useReminders } from './api'

const ICON: Record<ReminderKind, typeof Cake> = {
  aniversario: Cake,
  pos_venda: ShoppingBag,
  lembrete_agendamento: CalendarClock,
  retorno_servico: Repeat,
  pacote_vencendo: Gift,
}

export function RemindersPage() {
  useDocumentTitle('Lembretes')
  const { ctx, isAdmin } = useOrg()
  const [days, setDays] = React.useState<'0' | '7' | '15'>('7')
  const [kind, setKind] = React.useState<ReminderKind | 'all'>('all')
  const q = useReminders(Number(days))
  const run = useWhatsAppRun()
  const [target, setTarget] = React.useState<Reminder | null>(null)
  const rows = (q.data ?? []).filter((r) => kind === 'all' || r.kind === kind)
  const counts = (q.data ?? []).reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.kind]: (acc[r.kind] ?? 0) + 1 }), {})

  return (
    <>
      <PageHeader
        title="Lembretes"
        description="Aniversários dos pets, pós-venda, lembretes de agendamento, hora do próximo banho e pacotes perto de vencer. Envie em um clique pelo WhatsApp."
        actions={isAdmin && ctx.integrations?.whatsapp && (
          <Button variant="secondary" loading={run.isPending} onClick={() => run.mutate()}><Send /> Enviar automáticos agora</Button>
        )}
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={kind === 'all'} onClick={() => setKind('all')}>Todos ({q.data?.length ?? 0})</FilterChip>
            {(Object.keys(REMINDER_KIND) as ReminderKind[]).map((k) => (
              <FilterChip key={k} active={kind === k} onClick={() => setKind(k)}>{REMINDER_KIND[k].label} ({counts[k] ?? 0})</FilterChip>
            ))}
          </div>
          <Segmented value={days} onChange={setDays} options={[{ value: '0', label: 'Hoje' }, { value: '7', label: '7 dias' }, { value: '15', label: '15 dias' }]} />
        </div>
        {q.isLoading ? <TableSkeleton /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !rows.length ? (
          <EmptyState icon={BellRing} title="Nenhum lembrete pendente" description="Cadastre a data de nascimento dos pets, serviços com retorno sugerido e use a agenda para receber lembretes aqui." />
        ) : (
          <div className="divide-y divide-border">
            {rows.map((r) => {
              const Icon = ICON[r.kind]
              const meta = REMINDER_KIND[r.kind]
              const rel = diffDaysISO(r.due_date, ctx.today)
              return (
                <div key={r.key} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md border border-border bg-surface-2 text-muted"><Icon className="size-4" /></div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link to={`/app/clientes/${r.customer_id}`} className="text-sm font-medium hover:text-brand">{r.customer_name}</Link>
                        <Badge tone={meta.tone} className="h-5 px-2 text-[11px]">{meta.label}</Badge>
                        {r.do_not_contact && <Badge tone="danger" className="h-5 px-2 text-[11px]">Não quer contato</Badge>}
                      </div>
                      <div className="mt-0.5 text-xs text-muted">
                        {[r.pet_name, r.service_name, r.detail].filter(Boolean).join(' · ')} · {rel === 0 ? 'hoje' : formatRelativeDays(rel)} ({formatDate(r.due_date)})
                      </div>
                    </div>
                  </div>
                  <Button size="sm" variant="whatsapp" onClick={() => setTarget(r)} disabled={r.do_not_contact && r.kind !== 'lembrete_agendamento'}>
                    <MessageCircle /> Enviar
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </Card>
      <ReminderDialog target={target} onClose={() => setTarget(null)} />
    </>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`h-8 rounded-full border px-3 text-[12.5px] transition-colors ${active ? 'border-brand/40 bg-brand/10 text-brand' : 'border-border text-muted hover:text-fg'}`}>
      {children}
    </button>
  )
}

function ReminderDialog({ target, onClose }: { target: Reminder | null; onClose: () => void }) {
  const { org, canWrite } = useOrg()
  const templates = useTemplates()
  const log = useLogReminder()
  const [templateId, setTemplateId] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [opened, setOpened] = React.useState(false)
  const [result, setResult] = React.useState<ContactResult>('respondeu')
  const [notes, setNotes] = React.useState('')

  const render = React.useCallback((body: string, r: Reminder) => {
    const when = r.starts_at ? isoToLocal(r.starts_at, org.timezone) : null
    return renderAgendaTemplate(body, {
      nome: r.customer_name, pet: r.pet_name, servico: r.service_name, pacote: r.service_name, loja: org.name,
      data: when ? formatDate(when.date).slice(0, 5) : formatDate(r.due_date).slice(0, 5), hora: when?.time ?? '',
    })
  }, [org.name, org.timezone])

  React.useEffect(() => {
    if (!target || !templates.data?.length) return
    const t = templates.data.find((x) => x.kind === REMINDER_KIND[target.kind].template) ?? templates.data[0]
    setTemplateId(t.id)
    setMessage(render(t.body, target))
    setOpened(false)
    setResult('respondeu')
    setNotes('')
  }, [target, templates.data, render])

  if (!target) return null
  const link = buildWhatsAppLink(target.phone, message)
  if (target.do_not_contact && target.kind !== 'lembrete_agendamento') {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()} title="Contato bloqueado" size="sm">
        <div className="flex gap-3 text-sm text-muted"><PhoneOff className="mt-0.5 size-5 shrink-0 text-danger" /><p>{target.customer_name} pediu para não receber contato comercial (LGPD).</p></div>
      </Dialog>
    )
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${REMINDER_KIND[target.kind].label} · ${target.customer_name.split(' ')[0]}`}
      description={target.phone ? `WhatsApp ${formatPhone(target.phone)}` : 'Cliente sem telefone cadastrado'}
      footer={opened ? (
        <>
          <Button variant="secondary" onClick={() => setOpened(false)}>Voltar</Button>
          <Button loading={log.isPending} disabled={!canWrite} onClick={() => log.mutate({ customer_id: target.customer_id, key: target.key, result, template_id: templateId || null, message, notes }, { onSuccess: onClose })}>Registrar</Button>
        </>
      ) : (
        <>
          <Button variant="secondary" onClick={() => setOpened(true)}>Já falei por outro meio</Button>
          {link ? (
            <Button variant="whatsapp" asChild><a href={link} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)}><MessageCircle /> Abrir WhatsApp <ExternalLink className="opacity-60" /></a></Button>
          ) : <Button disabled>Sem telefone válido</Button>}
        </>
      )}>
      {!opened ? (
        <div className="space-y-4">
          <Field label="Modelo" htmlFor="rm-t">
            <Select id="rm-t" value={templateId} onChange={(e) => {
              setTemplateId(e.target.value)
              const t = templates.data?.find((x) => x.id === e.target.value)
              if (t) setMessage(render(t.body, target))
            }}>
              {templates.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Mensagem" htmlFor="rm-m" hint="Revise antes de enviar. Você envia pelo seu WhatsApp."><Textarea id="rm-m" rows={5} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Resultado" htmlFor="rm-r">
            <Select id="rm-r" value={result} onChange={(e) => setResult(e.target.value as ContactResult)}>
              {Object.entries(CONTACT_RESULT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
          </Field>
          {target.kind === 'lembrete_agendamento' && <p className="text-[13px] text-muted">Se o cliente respondeu, o agendamento é marcado como confirmado.</p>}
          <Field label="Observações" htmlFor="rm-n" optional><Input id="rm-n" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
      )}
    </Dialog>
  )
}
