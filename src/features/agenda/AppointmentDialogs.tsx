import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CalendarCheck, CheckCircle2, MessageCircle, Pencil, Play, UserPlus, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
import { CustomerPicker, type PickedCustomer } from '@/components/shared/CustomerPicker'
import { PaymentEditor, usePayments } from '@/components/shared/PaymentEditor'
import { usePets } from '@/features/customers/api'
import { useTemplates } from '@/features/replenishment/api'
import { useCustomerPackages, useProfessionals, useServices } from '@/features/services/api'
import { useOrg } from '@/features/org/OrgProvider'
import { APPOINTMENT_STATUS } from '@/domain/labels'
import { errorMessage } from '@/lib/errors'
import { formatCurrency, formatDate, formatPhone } from '@/lib/format'
import { moneyInput, parseMoney } from '@/lib/money'
import { supabase } from '@/lib/supabase'
import { buildWhatsAppLink } from '@/lib/whatsapp'
import { newRequestId } from '@/lib/utils'
import type { AppointmentView } from '@/types/models'
import { isoToLocal, localToISO, useCompleteAppointment, useSaveAppointment, useSetAppointmentStatus } from './api'

/** Substitui as variáveis dos modelos de mensagem da agenda. */
export function renderAgendaTemplate(body: string, v: { nome?: string | null; pet?: string | null; servico?: string | null; data?: string; hora?: string; loja?: string; pacote?: string | null }) {
  const map: Record<string, string> = {
    nome: v.nome?.trim().split(/\s+/)[0] ?? '',
    pet: v.pet?.trim() || 'seu pet',
    servico: v.servico ?? 'atendimento',
    data: v.data ?? '',
    hora: v.hora ?? '',
    loja: v.loja ?? '',
    pacote: v.pacote ?? 'pacote',
    produto: 'seus produtos',
  }
  return body.replace(/\{(nome|pet|servico|data|hora|loja|pacote|produto)\}/g, (_, k: string) => map[k])
}

// ---------------------------------------------------------------------
// Criar / editar agendamento
// ---------------------------------------------------------------------
export function AppointmentDialog({
  open, onOpenChange, appointment, defaults,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  appointment?: AppointmentView | null
  defaults?: { date?: string; time?: string; professional_id?: string; customer?: PickedCustomer | null }
}) {
  const { org, ctx, canWrite } = useOrg()
  const qc = useQueryClient()
  const services = useServices()
  const pros = useProfessionals()
  const save = useSaveAppointment()
  const [customer, setCustomer] = React.useState<PickedCustomer | null>(null)
  const pets = usePets(customer?.id)
  const packages = useCustomerPackages(customer?.id)
  const [f, setF] = React.useState({ pet_id: '', service_id: '', professional_id: '', date: ctx.today, time: '09:00', duration: '', price: '', package_id: '', notes: '' })
  const [creating, setCreating] = React.useState(false)
  const [newCust, setNewCust] = React.useState({ name: '', phone: '', pet: '' })
  const [submitted, setSubmitted] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setSubmitted(false)
    setCreating(false)
    if (appointment) {
      const l = isoToLocal(appointment.starts_at, org.timezone)
      const minutes = Math.round((Date.parse(appointment.ends_at) - Date.parse(appointment.starts_at)) / 60000)
      setCustomer(appointment.customer_id ? { id: appointment.customer_id, full_name: appointment.customer_name ?? '', phone: appointment.customer_phone } : null)
      setF({
        pet_id: appointment.pet_id ?? '', service_id: appointment.service_id, professional_id: appointment.professional_id ?? '',
        date: l.date, time: l.time, duration: String(minutes), price: moneyInput(appointment.price),
        package_id: appointment.customer_package_id ?? '', notes: appointment.notes ?? '',
      })
      setNewCust({ name: appointment.requester_name ?? '', phone: appointment.requester_phone ? formatPhone(appointment.requester_phone) : '', pet: appointment.pet_name ?? '' })
    } else {
      setCustomer(defaults?.customer ?? null)
      setF({ pet_id: '', service_id: '', professional_id: defaults?.professional_id ?? '', date: defaults?.date ?? ctx.today, time: defaults?.time ?? '09:00', duration: '', price: '', package_id: '', notes: '' })
      setNewCust({ name: '', phone: '', pet: '' })
    }
  }, [open, appointment, defaults, ctx.today, org.timezone])

  // Seleciona o pet do pedido online quando o cliente é vinculado
  React.useEffect(() => {
    if (!pets.data || f.pet_id) return
    if (pets.data.length === 1) setF((s) => ({ ...s, pet_id: pets.data![0].id }))
    else if (appointment?.pet_name) {
      const match = pets.data.find((p) => p.name.toLowerCase() === appointment.pet_name!.toLowerCase())
      if (match) setF((s) => ({ ...s, pet_id: match.id }))
    }
  }, [pets.data, appointment, f.pet_id])

  const service = services.data?.find((s) => s.id === f.service_id)
  const usablePackages = (packages.data ?? []).filter((p) => p.service_id === f.service_id && p.sessions_used < p.sessions_total && p.expires_at >= f.date)
  const pickService = (id: string) => {
    const s = services.data?.find((x) => x.id === id)
    setF((st) => ({ ...st, service_id: id, duration: s ? String(s.duration_minutes) : st.duration, price: s ? moneyInput(s.price) : st.price, package_id: '' }))
  }
  const isRequest = appointment?.status === 'requested'
  const duration = Number(f.duration)
  const price = parseMoney(f.price)
  const errors = {
    customer: !customer ? 'Selecione ou cadastre o cliente' : undefined,
    service: !f.service_id ? 'Escolha o serviço' : undefined,
    when: !f.date || !/^\d{2}:\d{2}$/.test(f.time) ? 'Informe data e hora' : undefined,
    duration: !(Number.isInteger(duration) && duration >= 10 && duration <= 720) ? 'Entre 10 e 720 minutos' : undefined,
    price: !f.package_id && !(price >= 0) ? 'Valor inválido' : undefined,
  }

  const createCustomer = async () => {
    if (newCust.name.trim().length < 2) return toast.error('Informe o nome do cliente.')
    const { data, error } = await supabase.from('customers').insert({ organization_id: org.id, full_name: newCust.name.trim(), phone: newCust.phone || null }).select('id, full_name, phone').single()
    if (error) return toast.error(errorMessage(error))
    let petId = ''
    if (newCust.pet.trim()) {
      const pet = await supabase.from('pets').insert({ organization_id: org.id, customer_id: data.id, name: newCust.pet.trim() }).select('id').single()
      if (!pet.error) petId = pet.data.id
    }
    qc.invalidateQueries({ queryKey: ['customers'] })
    qc.invalidateQueries({ queryKey: ['pets', data.id] })
    setCustomer(data)
    setF((s) => ({ ...s, pet_id: petId }))
    setCreating(false)
    toast.success('Cliente cadastrado.')
  }

  const submit = () => {
    setSubmitted(true)
    if (Object.values(errors).some(Boolean)) return
    save.mutate({
      id: appointment?.id, customer_id: customer?.id ?? null, pet_id: f.pet_id || null, service_id: f.service_id,
      professional_id: f.professional_id || null, starts_at: localToISO(f.date, f.time, org.timezone),
      duration_minutes: duration, price: f.package_id ? null : price, customer_package_id: f.package_id || null, notes: f.notes,
    }, { onSuccess: () => onOpenChange(false) })
  }
  const e: Partial<typeof errors> = submitted ? errors : {}

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg"
      title={isRequest ? 'Confirmar solicitação online' : appointment ? 'Editar agendamento' : 'Novo agendamento'}
      description={isRequest ? `Pedido de ${appointment?.requester_name} (${formatPhone(appointment?.requester_phone)})${appointment?.pet_name ? ` para ${appointment.pet_name}` : ''}. Vincule o cliente e confirme o horário.` : undefined}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={submit} loading={save.isPending} disabled={!canWrite}>{isRequest ? 'Confirmar agendamento' : appointment ? 'Salvar' : 'Agendar'}</Button></>}>
      <div className="space-y-4">
        <Field label="Cliente" error={e.customer}>
          {creating ? (
            <div className="space-y-2 rounded-md border border-border bg-bg/40 p-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <Input placeholder="Nome do tutor" value={newCust.name} onChange={(ev) => setNewCust({ ...newCust, name: ev.target.value })} aria-label="Nome do tutor" />
                <Input placeholder="Telefone com DDD" inputMode="tel" value={newCust.phone} onChange={(ev) => setNewCust({ ...newCust, phone: ev.target.value })} aria-label="Telefone" />
                <Input placeholder="Nome do pet" value={newCust.pet} onChange={(ev) => setNewCust({ ...newCust, pet: ev.target.value })} aria-label="Nome do pet" />
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>Voltar</Button>
                <Button size="sm" onClick={createCustomer}>Cadastrar cliente</Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <div className="flex-1"><CustomerPicker value={customer} onChange={(c) => { setCustomer(c); setF((s) => ({ ...s, pet_id: '', package_id: '' })) }} /></div>
              {!customer && <Button variant="secondary" onClick={() => setCreating(true)}><UserPlus /> Novo</Button>}
            </div>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pet" htmlFor="ap-pet" optional>
            <Select id="ap-pet" value={f.pet_id} onChange={(ev) => setF({ ...f, pet_id: ev.target.value })} disabled={!customer}>
              <option value="">{customer ? 'Selecione' : 'Escolha o cliente primeiro'}</option>
              {pets.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Serviço" htmlFor="ap-svc" error={e.service}>
            <Select id="ap-svc" value={f.service_id} onChange={(ev) => pickService(ev.target.value)}>
              <option value="">Selecione</option>
              {services.data?.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.duration_minutes} min</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Data" htmlFor="ap-date" error={e.when}><Input id="ap-date" type="date" value={f.date} onChange={(ev) => setF({ ...f, date: ev.target.value })} /></Field>
          <Field label="Hora" htmlFor="ap-time"><Input id="ap-time" type="time" step={300} value={f.time} onChange={(ev) => setF({ ...f, time: ev.target.value })} /></Field>
          <Field label="Duração (min)" htmlFor="ap-dur" error={e.duration}><Input id="ap-dur" inputMode="numeric" value={f.duration} onChange={(ev) => setF({ ...f, duration: ev.target.value })} /></Field>
          <Field label="Valor (R$)" htmlFor="ap-price" error={e.price}>
            <Input id="ap-price" inputMode="decimal" value={f.package_id ? 'Pacote' : f.price} disabled={!!f.package_id} onChange={(ev) => setF({ ...f, price: ev.target.value })} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Profissional" htmlFor="ap-pro" optional hint={pros.data?.length ? undefined : 'Cadastre profissionais em Serviços para evitar conflitos de horário.'}>
            <Select id="ap-pro" value={f.professional_id} onChange={(ev) => setF({ ...f, professional_id: ev.target.value })}>
              <option value="">Sem profissional definido</option>
              {pros.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Usar pacote" htmlFor="ap-pkg" optional hint={customer && f.service_id && !usablePackages.length ? 'Este cliente não tem pacote ativo deste serviço.' : undefined}>
            <Select id="ap-pkg" value={f.package_id} onChange={(ev) => setF({ ...f, package_id: ev.target.value })} disabled={!usablePackages.length}>
              <option value="">Não — cobrar avulso</option>
              {usablePackages.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.sessions_total - p.sessions_used} restante(s) · vence {formatDate(p.expires_at)}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Observações" htmlFor="ap-notes" optional>
          <Textarea id="ap-notes" rows={2} maxLength={1000} placeholder="Ex.: pet arisco, usar shampoo hipoalergênico" value={f.notes} onChange={(ev) => setF({ ...f, notes: ev.target.value })} />
        </Field>
        {service?.description && <p className="text-xs text-subtle">{service.description}</p>}
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------
// Detalhes + ações rápidas
// ---------------------------------------------------------------------
export function AppointmentDetail({ appointment, onClose, onEdit, onComplete }: { appointment: AppointmentView | null; onClose: () => void; onEdit: (a: AppointmentView) => void; onComplete: (a: AppointmentView) => void }) {
  const { org, canWrite } = useOrg()
  const setStatus = useSetAppointmentStatus()
  const templates = useTemplates()
  const [reason, setReason] = React.useState('')
  const [canceling, setCanceling] = React.useState<null | 'canceled' | 'no_show'>(null)
  React.useEffect(() => { setReason(''); setCanceling(null) }, [appointment])
  if (!appointment) return null
  const a = appointment
  const l = isoToLocal(a.starts_at, org.timezone)
  const end = isoToLocal(a.ends_at, org.timezone)
  const status = APPOINTMENT_STATUS[a.status]
  const open = !['done', 'canceled', 'no_show'].includes(a.status)
  const tpl = templates.data?.find((t) => t.kind === 'lembrete_agendamento')
  const message = tpl ? renderAgendaTemplate(tpl.body, { nome: a.customer_name, pet: a.pet_display_name, servico: a.service_name, data: formatDate(l.date).slice(0, 5), hora: l.time, loja: org.name }) : ''
  const wa = buildWhatsAppLink(a.customer_phone, message)
  const change = (status: 'confirmed' | 'in_progress' | 'scheduled' | 'canceled' | 'no_show', why?: string) =>
    setStatus.mutate({ id: a.id, status, reason: why }, { onSuccess: () => { toast.success('Agendamento atualizado.'); onClose() } })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${a.pet_display_name ?? 'Atendimento'} · ${a.service_name}`}
      description={`${formatDate(l.date)} das ${l.time} às ${end.time}`}
      footer={canceling ? (
        <>
          <Button variant="secondary" onClick={() => setCanceling(null)}>Voltar</Button>
          <Button variant="danger" loading={setStatus.isPending} onClick={() => change(canceling, reason)}>{canceling === 'canceled' ? 'Cancelar agendamento' : 'Marcar falta'}</Button>
        </>
      ) : undefined}>
      {canceling ? (
        <Field label="Motivo" htmlFor="why" optional><Input id="why" autoFocus maxLength={300} value={reason} onChange={(ev) => setReason(ev.target.value)} /></Field>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone} dot>{status.label}</Badge>
            {a.source === 'online' && <Badge tone="info">Agendado pela internet</Badge>}
            {a.package_name && <Badge tone="brand">Pacote · sessão {Math.min((a.package_sessions_used ?? 0) + (a.status === 'done' ? 0 : 1), a.package_sessions_total ?? 0)}/{a.package_sessions_total}</Badge>}
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-subtle">Cliente</dt><dd className="font-medium">{a.customer_name ?? '—'}</dd></div>
            <div><dt className="text-xs text-subtle">Telefone</dt><dd>{formatPhone(a.customer_phone)}</dd></div>
            <div><dt className="text-xs text-subtle">Profissional</dt><dd>{a.professional_name ?? 'Não definido'}</dd></div>
            <div><dt className="text-xs text-subtle">Valor</dt><dd className="tabular">{a.customer_package_id ? 'Pacote' : formatCurrency(a.price)}</dd></div>
          </dl>
          {a.notes && <p className="rounded-md border border-border bg-surface-2/50 px-3 py-2 text-[13px] text-muted">{a.notes}</p>}
          {a.cancel_reason && <p className="text-[13px] text-danger">Motivo: {a.cancel_reason}</p>}
          {canWrite && (
            <div className="grid gap-2 sm:grid-cols-2">
              {a.status === 'requested' && <Button className="sm:col-span-2" onClick={() => onEdit(a)}><CalendarCheck /> Confirmar solicitação</Button>}
              {a.status === 'scheduled' && <Button variant="secondary" loading={setStatus.isPending} onClick={() => change('confirmed')}><CalendarCheck /> Cliente confirmou</Button>}
              {['scheduled', 'confirmed'].includes(a.status) && <Button variant="secondary" loading={setStatus.isPending} onClick={() => change('in_progress')}><Play /> Iniciar atendimento</Button>}
              {['scheduled', 'confirmed', 'in_progress'].includes(a.status) && <Button onClick={() => onComplete(a)}><CheckCircle2 /> Concluir{a.customer_package_id ? '' : ' e receber'}</Button>}
              {open && a.status !== 'requested' && <Button variant="secondary" onClick={() => onEdit(a)}><Pencil /> Editar / remarcar</Button>}
              {wa && !a.customer_do_not_contact && open && (
                <Button variant="whatsapp" asChild><a href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle /> Lembrar pelo WhatsApp</a></Button>
              )}
              {open && <Button variant="ghost" onClick={() => setCanceling('canceled')}><XCircle /> Cancelar</Button>}
              {open && a.status !== 'requested' && <Button variant="ghost" onClick={() => setCanceling('no_show')}>Não compareceu</Button>}
              {['canceled', 'no_show'].includes(a.status) && <Button variant="secondary" loading={setStatus.isPending} onClick={() => change('scheduled')}>Reabrir agendamento</Button>}
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}

// ---------------------------------------------------------------------
// Concluir atendimento (consome pacote ou recebe pagamento)
// ---------------------------------------------------------------------
export function CompleteAppointmentDialog({ appointment, onClose }: { appointment: AppointmentView | null; onClose: () => void }) {
  const { ctx } = useOrg()
  const complete = useCompleteAppointment()
  const total = appointment && !appointment.customer_package_id ? Number(appointment.price) : 0
  const pay = usePayments(total)
  const { reset } = pay
  const [requestId, setRequestId] = React.useState(newRequestId)
  React.useEffect(() => {
    if (appointment) {
      reset()
      setRequestId(newRequestId())
    }
  }, [appointment, reset])
  if (!appointment) return null
  const usesPackage = !!appointment.customer_package_id
  const ready = usesPackage || total <= 0 || (pay.valid && (!pay.hasFiado || pay.dueDate))
  const submit = () =>
    complete.mutate({ id: appointment.id, payments: usesPackage || total <= 0 ? null : pay.effective, request_id: requestId, due_date: pay.dueDate },
      { onSuccess: onClose })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Concluir atendimento"
      description={`${appointment.pet_display_name ?? ''} · ${appointment.service_name}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={submit} loading={complete.isPending} disabled={!ready}>{usesPackage ? 'Concluir e usar sessão' : total > 0 ? `Concluir e receber ${formatCurrency(total)}` : 'Concluir'}</Button></>}>
      {usesPackage ? (
        <p className="text-sm text-muted">
          Será usada 1 sessão do pacote <strong className="text-fg">{appointment.package_name}</strong> ({(appointment.package_sessions_used ?? 0) + 1} de {appointment.package_sessions_total}). Nenhum valor é cobrado agora.
        </p>
      ) : total > 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">O valor entra no financeiro e, se o caixa estiver aberto, no caixa do dia.</p>
          <PaymentEditor total={total} state={pay} minDueDate={ctx.today} />
        </div>
      ) : (
        <p className="text-sm text-muted">Atendimento sem cobrança.</p>
      )}
    </Dialog>
  )
}
