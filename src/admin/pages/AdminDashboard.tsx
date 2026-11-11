import { Link } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Building2, CircleDollarSign, Clock, CreditCard, Hourglass, UserRound, type LucideIcon } from 'lucide-react'
import { Card, CardBody, CardHeader, Skeleton } from '@/components/ui/card'
import { ErrorState, PageHeader } from '@/components/ui/states'
import { PeriodFilter, usePeriod } from '@/components/shared/PeriodFilter'
import { useAdminOverview } from '../api'
import { formatCents } from '@/features/billing/plans'
import { formatDate, formatNumber, formatShortDate } from '@/lib/format'
import { todayISO } from '@/lib/dates'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

function Kpi({ label, value, icon: Icon, hint, to, tone }: { label: string; value: string; icon: LucideIcon; hint?: string; to?: string; tone?: string }) {
  const body = (
    <Card className="h-full p-4 transition-colors hover:border-border-strong sm:p-5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-muted">{label}</span>
        <Icon className={tone ?? 'size-4 text-subtle'} />
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular">{value}</div>
      {hint && <div className="mt-1 text-xs text-subtle">{hint}</div>}
    </Card>
  )
  return to ? <Link to={to}>{body}</Link> : body
}

export function AdminDashboard() {
  useDocumentTitle('Admin · Visão geral')
  const today = todayISO()
  const [period, setPeriod] = usePeriod(today)
  const q = useAdminOverview(period.from, period.to)
  const o = q.data

  return (
    <>
      <PageHeader title="Visão geral da plataforma" description="Indicadores globais calculados a partir do banco." actions={<PeriodFilter value={period} onChange={setPeriod} today={today} />} />
      {q.error ? (
        <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {q.isLoading || !o ? (
              Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[104px] w-full" />)
            ) : (
              <>
                <Kpi label="Estabelecimentos" icon={Building2} value={formatNumber(o.organizations_total)} hint={o.organizations_suspended ? `${o.organizations_suspended} suspenso(s)` : 'Nenhum suspenso'} to="/estabelecimentos" />
                <Kpi label="Usuários" icon={UserRound} value={formatNumber(o.users_total)} hint={o.users_blocked ? `${o.users_blocked} bloqueado(s)` : 'Nenhum bloqueado'} to="/usuarios" />
                <Kpi label="Assinaturas ativas" icon={CreditCard} value={formatNumber(o.subscriptions_active)} tone="size-4 text-brand" to="/assinaturas" />
                <Kpi label="Receita recebida (30 dias)" icon={CircleDollarSign} value={formatCents(o.mrr_received_cents)} hint={o.test_received_cents ? `Somente pagamentos reais · ${formatCents(o.test_received_cents)} em modo teste fora da conta` : 'Somente pagamentos confirmados'} tone="size-4 text-brand" />
                <Kpi label="Trials ativos" icon={Hourglass} value={formatNumber(o.trials_active)} />
                <Kpi label="Trials encerrados" icon={Clock} value={formatNumber(o.trials_ended)} hint="Sem conversão em assinatura" />
                <Kpi label="Assinaturas atrasadas" icon={AlertTriangle} value={formatNumber(o.subscriptions_past_due)} tone="size-4 text-warning" />
                <Kpi label="Canceladas" icon={CreditCard} value={formatNumber(o.subscriptions_canceled)} />
              </>
            )}
          </div>
          <Card>
            <CardHeader title="Evolução de cadastros" description="Novos estabelecimentos e usuários por dia" />
            <CardBody className="h-72">
              {q.isLoading || !o ? (
                <Skeleton className="h-full w-full" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={o.signups} margin={{ left: -20, right: 8, top: 4 }}>
                    <defs>
                      <linearGradient id="orgs" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#22C58B" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="#22C58B" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1e2a40" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={formatShortDate} stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: '#111827', border: '1px solid #263247', borderRadius: 8, fontSize: 12 }}
                      labelFormatter={(l) => formatDate(String(l))}
                      formatter={(v, n) => [v as number, n === 'organizations' ? 'Estabelecimentos' : 'Usuários']}
                    />
                    <Area type="monotone" dataKey="organizations" stroke="#22C58B" strokeWidth={2} fill="url(#orgs)" />
                    <Area type="monotone" dataKey="users" stroke="#60a5fa" strokeWidth={2} fill="transparent" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </>
  )
}
