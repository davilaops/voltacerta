import * as React from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight, Globe, Plus } from 'lucide-react'
import { Badge, Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/menu'
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/ui/states'
import { useOrg } from '@/features/org/OrgProvider'
import { useProfessionals, useServices } from '@/features/services/api'
import { APPOINTMENT_STATUS, WEEKDAYS, WEEKDAYS_SHORT } from '@/domain/labels'
import { addDaysISO } from '@/lib/dates'
import { formatCurrency, formatDate } from '@/lib/format'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { cn } from '@/lib/utils'
import type { AppointmentView } from '@/types/models'
import { formatTime, isoToLocal, useAppointments, usePendingRequests } from './api'
import { AppointmentDetail, AppointmentDialog, CompleteAppointmentDialog } from './AppointmentDialogs'

const weekday = (iso: string) => new Date(iso + 'T12:00:00Z').getUTCDay()
const startOfWeek = (iso: string) => addDaysISO(iso, -((weekday(iso) + 6) % 7)) // segunda-feira

export function AgendaPage() {
  useDocumentTitle('Agenda')
  const { org, ctx, canWrite } = useOrg()
  const [view, setView] = React.useState<'dia' | 'semana'>('dia')
  const [date, setDate] = React.useState(ctx.today)
  const from = view === 'dia' ? date : startOfWeek(date)
  const to = view === 'dia' ? date : addDaysISO(from, 6)
  const q = useAppointments(from, to)
  const requests = usePendingRequests()
  const pros = useProfessionals()
  const services = useServices()
  const [dialog, setDialog] = React.useState<{ open: boolean; appointment: AppointmentView | null; defaults?: { date?: string; time?: string; professional_id?: string } }>({ open: false, appointment: null })
  const [detail, setDetail] = React.useState<AppointmentView | null>(null)
  const [completing, setCompleting] = React.useState<AppointmentView | null>(null)
  const [showCanceled, setShowCanceled] = React.useState(false)

  const step = view === 'dia' ? 1 : 7
  const rows = (q.data ?? []).filter((a) => showCanceled || !['canceled', 'no_show'].includes(a.status))
  const dayTotal = rows.filter((a) => a.status !== 'canceled' && a.status !== 'no_show' && !a.customer_package_id).reduce((s, a) => s + Number(a.price), 0)
  const hours = org.business_hours?.[String(weekday(date))]

  const openNew = (defaults?: { date?: string; time?: string; professional_id?: string }) => setDialog({ open: true, appointment: null, defaults })
  const card = (a: AppointmentView, compact = false) => {
    const st = APPOINTMENT_STATUS[a.status]
    return (
      <button key={a.id} type="button" onClick={() => setDetail(a)}
        className={cn('w-full rounded-md border border-border bg-surface-2/40 px-3 py-2 text-left transition-colors hover:border-border-strong hover:bg-surface-2',
          ['canceled', 'no_show'].includes(a.status) && 'opacity-50 line-through', a.status === 'done' && 'opacity-70')}
        style={{ borderLeft: `3px solid ${a.professional_color ?? 'var(--color-border-strong, #444)'}` }}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold tabular">{formatTime(a.starts_at, org.timezone)}–{formatTime(a.ends_at, org.timezone)}</span>
          {!compact && <Badge tone={st.tone} className="h-5 px-2 text-[11px]">{st.label}</Badge>}
        </div>
        <div className="mt-0.5 truncate text-[13px] font-medium">{a.pet_display_name ?? a.customer_name ?? 'Sem nome'}</div>
        <div className="truncate text-xs text-muted">{a.service_name}{!compact && a.customer_name ? ` · ${a.customer_name}` : ''}</div>
        {compact && <div className="mt-1"><Badge tone={st.tone} className="h-5 px-2 text-[10px]">{st.label}</Badge></div>}
      </button>
    )
  }

  // Colunas do dia: um por profissional ativo + "sem profissional"
  const columns = [
    ...(pros.data ?? []).map((p) => ({ id: p.id, name: p.name, color: p.color, items: rows.filter((a) => a.professional_id === p.id) })),
    { id: '', name: 'Sem profissional', color: '#64748b', items: rows.filter((a) => !a.professional_id || !(pros.data ?? []).some((p) => p.id === a.professional_id)) },
  ].filter((c) => c.id || c.items.length || !(pros.data ?? []).length)

  return (
    <>
      <PageHeader
        title="Agenda"
        description="Atendimentos marcados com cada profissional. Conclua o atendimento para registrar o pagamento e usar sessões de pacotes."
        actions={canWrite && <Button onClick={() => openNew({ date })} disabled={!services.data?.length}><Plus /> Novo agendamento</Button>}
      />

      {!!requests.data?.length && (
        <Card className="mb-4 border-warning/30">
          <div className="flex items-center gap-2 px-5 pt-4 text-sm font-semibold text-warning"><Globe className="size-4" /> {requests.data.length} solicitação(ões) online aguardando confirmação</div>
          <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {requests.data.map((a) => {
              const l = isoToLocal(a.starts_at, org.timezone)
              return (
                <button key={a.id} type="button" onClick={() => setDetail(a)} className="rounded-md border border-border bg-surface-2/40 px-3 py-2 text-left hover:border-border-strong">
                  <div className="text-[13px] font-medium">{a.requester_name}{a.pet_name ? ` · ${a.pet_name}` : ''}</div>
                  <div className="text-xs text-muted">{a.service_name} · {formatDate(l.date)} às {l.time}</div>
                </button>
              )
            })}
          </div>
        </Card>
      )}

      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="icon-sm" aria-label="Anterior" onClick={() => setDate(addDaysISO(date, -step))}><ChevronLeft /></Button>
            <Button variant="secondary" size="sm" onClick={() => setDate(ctx.today)}>Hoje</Button>
            <Button variant="secondary" size="icon-sm" aria-label="Próximo" onClick={() => setDate(addDaysISO(date, step))}><ChevronRight /></Button>
            <Input type="date" aria-label="Escolher data" className="h-8 w-[150px] sm:h-8" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <span className="hidden text-sm font-medium sm:inline">
              {view === 'dia' ? `${WEEKDAYS[weekday(date)]}, ${formatDate(date)}` : `${formatDate(from)} – ${formatDate(to)}`}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[13px] text-muted">
              <input type="checkbox" className="accent-[#22c58b]" checked={showCanceled} onChange={(e) => setShowCanceled(e.target.checked)} /> Mostrar cancelados
            </label>
            <Segmented value={view} onChange={setView} options={[{ value: 'dia', label: 'Dia' }, { value: 'semana', label: 'Semana' }]} />
          </div>
        </div>

        {q.isLoading ? <TableSkeleton /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !services.data?.length ? (
          <EmptyState icon={CalendarDays} title="Cadastre seus serviços primeiro" description="A agenda usa os serviços cadastrados, com preço e duração."
            action={<Button asChild><Link to="/app/servicos">Cadastrar serviços</Link></Button>} />
        ) : view === 'dia' ? (
          <div className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
              <span>{hours ? `Funcionamento: ${hours[0]}–${hours[1]}` : 'Fechado neste dia (ajuste em Configurações → Agenda)'}</span>
              <span>{rows.filter((a) => !['canceled', 'no_show'].includes(a.status)).length} atendimento(s) · {formatCurrency(dayTotal)} previsto (avulsos)</span>
            </div>
            {!rows.length ? (
              <EmptyState icon={CalendarDays} title="Nenhum atendimento neste dia" description="Clique em “Novo agendamento” ou escolha outra data." className="py-10"
                action={canWrite ? <Button variant="secondary" onClick={() => openNew({ date })}><Plus /> Agendar</Button> : undefined} />
            ) : (
              <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(220px, 1fr))` }}>
                {columns.map((c) => (
                  <div key={c.id || 'none'} className="min-w-0">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-[13px] font-semibold"><span className="size-2.5 rounded-full" style={{ background: c.color }} />{c.name}</span>
                      {canWrite && c.id && <Button variant="ghost" size="icon-sm" aria-label={`Agendar com ${c.name}`} onClick={() => openNew({ date, professional_id: c.id })}><Plus /></Button>}
                    </div>
                    <div className="space-y-2">
                      {c.items.length ? c.items.map((a) => card(a)) : <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-subtle">Livre</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-7">
            {Array.from({ length: 7 }).map((_, i) => {
              const d = addDaysISO(from, i)
              const items = rows.filter((a) => isoToLocal(a.starts_at, org.timezone).date === d)
              return (
                <div key={d} className="min-w-0">
                  <button type="button" onClick={() => { setDate(d); setView('dia') }}
                    className={cn('mb-2 w-full rounded-md px-2 py-1 text-left text-[13px] font-semibold hover:bg-surface-2', d === ctx.today && 'text-brand')}>
                    {WEEKDAYS_SHORT[weekday(d)]} {d.slice(8, 10)}/{d.slice(5, 7)}
                    <span className="ml-1 text-xs font-normal text-subtle">({items.length})</span>
                  </button>
                  <div className="space-y-1.5">{items.map((a) => card(a, true))}</div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <AppointmentDialog open={dialog.open} appointment={dialog.appointment} defaults={dialog.defaults} onOpenChange={(o) => setDialog((s) => ({ ...s, open: o }))} />
      <AppointmentDetail
        appointment={detail}
        onClose={() => setDetail(null)}
        onEdit={(a) => { setDetail(null); setDialog({ open: true, appointment: a }) }}
        onComplete={(a) => { setDetail(null); setCompleting(a) }}
      />
      <CompleteAppointmentDialog appointment={completing} onClose={() => setCompleting(null)} />
    </>
  )
}
