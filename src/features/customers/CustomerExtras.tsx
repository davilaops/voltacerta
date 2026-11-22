import { Gift, XCircle } from 'lucide-react'
import { Badge, Card, CardBody, CardHeader, Skeleton } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/dialog'
import { useCustomerAppointments, isoToLocal } from '@/features/agenda/api'
import { useCustomerInsights } from '@/features/reminders/api'
import { useCancelCustomerPackage } from '@/features/services/api'
import { useOrg } from '@/features/org/OrgProvider'
import { APPOINTMENT_STATUS } from '@/domain/labels'
import { productCategoryLabel } from '@/domain/business'
import { formatCurrency, formatDate, formatNumber } from '@/lib/format'

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** Análise de consumo: ticket, frequência, ranking, sazonalidade e categorias. */
export function InsightsCard({ customerId }: { customerId: string }) {
  const q = useCustomerInsights(customerId)
  const d = q.data
  const max = Math.max(1, ...(d?.monthly ?? []).map((m) => Number(m.total)))
  const cats = Object.entries(d?.by_category ?? {}).sort((a, b) => Number(b[1]) - Number(a[1]))
  const catTotal = cats.reduce((s, [, v]) => s + Number(v), 0)
  return (
    <Card>
      <CardHeader title="Análise de consumo" description="Como este cliente compra na sua loja" />
      <CardBody>
        {q.isLoading || !d ? <Skeleton className="h-40 w-full" /> : !d.purchases_count ? (
          <p className="text-sm text-subtle">Sem compras ainda.</p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Ticket médio" value={formatCurrency(d.avg_ticket)} />
              <Metric label="Compra a cada" value={d.avg_interval_days != null ? `${formatNumber(d.avg_interval_days)} dias` : '—'} />
              <Metric label="Gasto em 12 meses" value={formatCurrency(d.spent_12m)} />
              <Metric label="Ranking" value={d.percentile_12m != null ? `Top ${Math.max(1, 100 - Number(d.percentile_12m))}%` : '—'} hint="entre os clientes que compraram no ano" />
              <Metric label="Atendimentos" value={formatNumber(d.services_count)} />
              <Metric label="Faltas na agenda" value={formatNumber(d.no_show_count)} warn={d.no_show_count > 0} />
              <Metric label="Fiado em aberto" value={formatCurrency(d.receivable_open)} warn={Number(d.receivable_open) > 0} />
              <Metric label="Sem comprar há" value={d.days_since_last != null ? `${d.days_since_last} dias` : '—'} />
            </div>
            <div>
              <div className="mb-2 text-xs text-subtle">Gastos por mês (últimos 12 meses)</div>
              <div className="flex h-24 items-end gap-1">
                {d.monthly.map((m) => (
                  <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={`${m.month}: ${formatCurrency(m.total)}`}>
                    <div className="w-full rounded-t bg-brand/70" style={{ height: `${(Number(m.total) / max) * 80}px`, minHeight: Number(m.total) > 0 ? 3 : 0 }} />
                    <span className="text-[10px] text-subtle">{MONTHS[Number(m.month.slice(5, 7)) - 1]}</span>
                  </div>
                ))}
              </div>
            </div>
            {cats.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs text-subtle">Onde gasta</div>
                {cats.map(([k, v]) => (
                  <div key={k}>
                    <div className="flex justify-between text-[13px]"><span className="text-muted">{k === 'servicos' ? 'Serviços' : productCategoryLabel(k)}</span><span className="tabular">{formatCurrency(v)}</span></div>
                    <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-brand" style={{ width: `${catTotal ? (Number(v) / catTotal) * 100 : 0}%` }} /></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function Metric({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div title={hint}>
      <div className="text-[11px] text-subtle">{label}</div>
      <div className={`text-sm font-semibold tabular ${warn ? 'text-warning' : ''}`}>{value}</div>
    </div>
  )
}

export function PackagesCard({ customerId, onSell }: { customerId: string; onSell: () => void }) {
  const q = useCustomerInsights(customerId)
  const cancel = useCancelCustomerPackage()
  const confirm = useConfirm()
  const { isAdmin, ctx } = useOrg()
  const list = q.data?.packages ?? []
  return (
    <Card>
      <CardHeader title="Pacotes" action={<Button size="sm" variant="ghost" onClick={onSell}><Gift /> Vender</Button>} />
      <CardBody>
        {!list.length ? <p className="text-sm text-subtle">Nenhum pacote.</p> : (
          <ul className="space-y-2">
            {list.map((p) => {
              const expired = p.status === 'active' && p.expires_at < ctx.today
              return (
                <li key={p.id} className="rounded-md border border-border px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{p.name}</span>
                    {p.status === 'active' && !expired ? <Badge tone="brand">{p.sessions_total - p.sessions_used} restante(s)</Badge>
                      : <Badge tone="muted">{expired ? 'Vencido' : p.status === 'finished' ? 'Concluído' : 'Cancelado'}</Badge>}
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-brand" style={{ width: `${(p.sessions_used / p.sessions_total) * 100}%` }} /></div>
                  <div className="mt-1 flex items-center justify-between text-xs text-muted">
                    <span>{p.sessions_used}/{p.sessions_total} usadas · vence {formatDate(p.expires_at)}</span>
                    {isAdmin && p.status === 'active' && (
                      <button type="button" className="text-subtle hover:text-danger" aria-label="Cancelar pacote" onClick={async () => {
                        if (await confirm({ title: `Cancelar ${p.name}?`, description: 'As sessões restantes deixam de valer e agendamentos futuros com este pacote passam a ser cobrados. O valor recebido não é estornado automaticamente.', confirmLabel: 'Cancelar pacote', danger: true })) cancel.mutate(p.id)
                      }}><XCircle className="size-3.5" /></button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

export function AppointmentsList({ customerId }: { customerId: string }) {
  const { org } = useOrg()
  const q = useCustomerAppointments(customerId)
  if (q.isLoading) return <CardBody className="pt-4"><Skeleton className="h-24 w-full" /></CardBody>
  if (!q.data?.length) return <p className="px-5 py-8 text-center text-sm text-subtle">Nenhum atendimento na agenda.</p>
  return (
    <ul className="divide-y divide-border">
      {q.data.map((a) => {
        const l = isoToLocal(a.starts_at, org.timezone)
        const st = APPOINTMENT_STATUS[a.status]
        return (
          <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">{a.service_name}{a.pet_display_name ? ` · ${a.pet_display_name}` : ''}</div>
              <div className="text-xs text-muted">{formatDate(l.date)} às {l.time}{a.professional_name ? ` · ${a.professional_name}` : ''}{a.package_name ? ' · pacote' : ''}</div>
            </div>
            <Badge tone={st.tone}>{st.label}</Badge>
          </li>
        )
      })}
    </ul>
  )
}
