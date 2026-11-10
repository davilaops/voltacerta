import * as React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ArrowUpRight,
  CalendarClock,
  CircleDollarSign,
  MessageCircle,
  Package,
  PhoneCall,
  Plus,
  Repeat,
  ShoppingBag,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { Badge, Card, CardBody, CardHeader, Skeleton } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/states'
import { PeriodFilter, usePeriod } from '@/components/shared/PeriodFilter'
import { StageBadge } from '@/components/shared/badges'
import { ContactDialog, type ContactTarget } from '@/components/shared/ContactDialog'
import { PurchaseDialog } from '@/components/shared/PurchaseDialog'
import { useOrg } from '@/features/org/OrgProvider'
import { rpc, supabase, unwrap } from '@/lib/supabase'
import { formatCurrency, formatDate, formatDateTime, formatNumber, formatPercent, formatPhone, formatShortDate } from '@/lib/format'
import { CONTACT_RESULT, SITUATION } from '@/domain/labels'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import type { ContactResult, CustomerSituation, DashboardMetrics, PredictionView } from '@/types/models'

const CHART = { brand: '#22C58B', grid: '#1e2a40', axis: '#64748b' }
const PIPELINE_COLORS: Record<string, string> = { prevista: '#475569', proxima: '#60a5fa', hoje: '#f5b544', atrasada: '#f05252', contatada: '#22C58B' }
const SITUATION_COLORS: Record<CustomerSituation, string> = {
  em_dia: '#22C58B',
  proxima: '#f5b544',
  precisa_contato: '#f05252',
  inativo: '#64748b',
  sem_compras: '#33415a',
}

function StatCard({ label, value, icon: Icon, hint, loading, accent }: { label: string; value: string; icon: LucideIcon; hint?: string; loading?: boolean; accent?: boolean }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-muted">{label}</span>
        <Icon className={accent ? 'size-4 text-brand' : 'size-4 text-subtle'} />
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-7 w-24" />
      ) : (
        <div className="mt-2 text-2xl font-semibold tracking-tight tabular text-fg animate-fade-in">{value}</div>
      )}
      {hint && <div className="mt-1 truncate text-xs text-subtle">{hint}</div>}
    </Card>
  )
}

function ChartTooltip({ active, payload, label, money }: { active?: boolean; payload?: { value: number; name: string }[]; label?: string; money?: boolean }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-pop">
      {label && <div className="mb-1 text-subtle">{/^\d{4}-/.test(label) ? formatDate(label) : label}</div>}
      {payload.map((p) => (
        <div key={p.name} className="font-medium text-fg tabular">
          {money ? formatCurrency(p.value) : formatNumber(p.value)}
        </div>
      ))}
    </div>
  )
}

export function DashboardPage() {
  useDocumentTitle('Visão geral')
  const { org, ctx } = useOrg()
  const [period, setPeriod] = usePeriod(ctx.today)
  const [contact, setContact] = React.useState<ContactTarget | null>(null)
  const [purchaseOpen, setPurchaseOpen] = React.useState(false)

  const metrics = useQuery({
    queryKey: ['dashboard', org.id, period.from, period.to],
    queryFn: () => rpc<DashboardMetrics>('dashboard_metrics', { p_org: org.id, p_from: period.from, p_to: period.to }),
  })
  const attention = useQuery({
    queryKey: ['dashboard', 'attention', org.id],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('v_predictions')
          .select('*')
          .eq('organization_id', org.id)
          .eq('status', 'open')
          .lte('expected_date', ctx.today)
          .eq('customer_do_not_contact', false)
          .order('expected_date')
          .limit(8),
      ) as PredictionView[],
  })

  const m = metrics.data
  const loading = metrics.isLoading
  const isEmpty = m && m.customers_total === 0

  const pipelineData = m
    ? (['prevista', 'proxima', 'hoje', 'atrasada', 'contatada'] as const).map((k) => ({
        name: { prevista: 'Previstas', proxima: 'Próximas', hoje: 'Hoje', atrasada: 'Atrasadas', contatada: 'Contatadas' }[k],
        key: k,
        value: m.pipeline[k] ?? 0,
      }))
    : []
  const situationData = m
    ? (Object.entries(m.situations) as [CustomerSituation, number][]).map(([k, v]) => ({ key: k, name: SITUATION[k].label, value: v }))
    : []

  return (
    <>
      <PageHeader
        title="Visão geral"
        description={`Situação comercial de ${org.name}`}
        actions={
          <>
            <PeriodFilter value={period} onChange={setPeriod} today={ctx.today} />
            <Button onClick={() => setPurchaseOpen(true)}>
              <Plus /> Registrar compra
            </Button>
          </>
        }
      />

      {metrics.error ? (
        <Card>
          <ErrorState error={metrics.error} onRetry={() => metrics.refetch()} />
        </Card>
      ) : isEmpty ? (
        <Card>
          <EmptyState
            icon={Users}
            title="Você ainda não possui clientes cadastrados."
            description="Cadastre seus produtos e clientes e registre as compras para começar a identificar oportunidades de recompra."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild variant="secondary">
                  <Link to="/app/produtos"><Package /> Cadastrar produtos</Link>
                </Button>
                <Button asChild>
                  <Link to="/app/clientes?novo=1"><UserPlus /> Cadastrar cliente</Link>
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Clientes cadastrados" icon={Users} loading={loading} value={formatNumber(m?.customers_total)} hint={m ? `+${formatNumber(m.customers_new)} no período` : undefined} />
            <StatCard label="Recompras previstas" icon={CalendarClock} loading={loading} value={formatNumber(m?.predictions_upcoming)} hint={`Próximos ${org.soon_days} dias`} />
            <StatCard label="Contatar hoje" icon={PhoneCall} loading={loading} value={formatNumber(m?.contact_today)} hint="Vencidas sem contato" />
            <StatCard label="Vendas recuperadas" icon={ShoppingBag} loading={loading} value={formatNumber(m?.recovered_sales)} hint="Após contato registrado" accent />
            <StatCard label="Receita recuperada" icon={CircleDollarSign} loading={loading} value={formatCurrency(m?.recovered_revenue)} hint="No período" accent />
            <StatCard
              label="Taxa de recompra"
              icon={Repeat}
              loading={loading}
              value={formatPercent(m?.repurchase_rate ?? null)}
              hint={m ? `${m.repurchase_done} de ${m.repurchase_due} previsões vencidas` : undefined}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Receita recuperada" description="Vendas concluídas após contato, por dia" />
              <CardBody className="h-64">
                {loading ? (
                  <Skeleton className="h-full w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={m!.series} margin={{ left: -8, right: 8, top: 4 }}>
                      <defs>
                        <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={CHART.brand} stopOpacity={0.25} />
                          <stop offset="100%" stopColor={CHART.brand} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={CHART.grid} vertical={false} />
                      <XAxis dataKey="date" tickFormatter={formatShortDate} stroke={CHART.axis} fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
                      <YAxis stroke={CHART.axis} fontSize={11} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => `R$${formatNumber(v)}`} />
                      <Tooltip content={<ChartTooltip money />} cursor={{ stroke: CHART.grid }} />
                      <Area type="monotone" dataKey="recovered_revenue" stroke={CHART.brand} strokeWidth={2} fill="url(#rev)" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Clientes por situação" description="Distribuição atual da base" />
              <CardBody className="h-64">
                {loading ? (
                  <Skeleton className="h-full w-full" />
                ) : situationData.length === 0 ? (
                  <div className="grid h-full place-items-center text-sm text-subtle">Sem dados ainda</div>
                ) : (
                  <div className="flex h-full flex-col">
                    <div className="min-h-0 flex-1">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={situationData} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="90%" paddingAngle={2} stroke="none">
                            {situationData.map((d) => (
                              <Cell key={d.key} fill={SITUATION_COLORS[d.key]} />
                            ))}
                          </Pie>
                          <Tooltip content={<ChartTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      {situationData.map((d) => (
                        <li key={d.key} className="flex items-center gap-2 text-muted">
                          <span className="size-2 rounded-full" style={{ background: SITUATION_COLORS[d.key] }} />
                          <span className="truncate">{d.name}</span>
                          <span className="ml-auto tabular text-fg">{d.value}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Clientes em processo de recompra" description="Oportunidades ativas por estágio" />
              <CardBody className="h-56">
                {loading ? (
                  <Skeleton className="h-full w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={pipelineData} margin={{ left: -20, right: 8 }}>
                      <CartesianGrid stroke={CHART.grid} vertical={false} />
                      <XAxis dataKey="name" stroke={CHART.axis} fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke={CHART.axis} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgb(255 255 255 / 0.03)' }} />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={44}>
                        {pipelineData.map((d) => (
                          <Cell key={d.key} fill={PIPELINE_COLORS[d.key]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Evolução de clientes cadastrados" description="Total acumulado no período" />
              <CardBody className="h-56">
                {loading ? (
                  <Skeleton className="h-full w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={m!.series} margin={{ left: -20, right: 8 }}>
                      <CartesianGrid stroke={CHART.grid} vertical={false} />
                      <XAxis dataKey="date" tickFormatter={formatShortDate} stroke={CHART.axis} fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
                      <YAxis stroke={CHART.axis} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ stroke: CHART.grid }} />
                      <Line type="monotone" dataKey="customers_total" stroke="#60a5fa" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Clientes que precisam de atenção"
                description="Previsões vencidas sem contato"
                action={
                  <Button variant="ghost" size="sm" asChild>
                    <Link to="/app/recuperacao">Ver todos <ArrowUpRight /></Link>
                  </Button>
                }
              />
              {attention.isLoading ? (
                <CardBody className="space-y-3">
                  {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
                </CardBody>
              ) : attention.error ? (
                <ErrorState error={attention.error} onRetry={() => attention.refetch()} />
              ) : !attention.data?.length ? (
                <EmptyState icon={CalendarClock} title="Tudo em dia" description="Nenhum cliente com recompra vencida aguardando contato." className="py-10" />
              ) : (
                <ul className="divide-y divide-border border-t border-border">
                  {attention.data.map((p) => (
                    <li key={p.id} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link to={`/app/clientes/${p.customer_id}`} className="truncate text-sm font-medium hover:text-brand">
                            {p.customer_name}
                          </Link>
                          <StageBadge stage={p.stage} />
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                          <span>{formatPhone(p.customer_phone)}</span>
                          <span>{p.product_name}</span>
                          <span>Última compra {formatDate(p.last_purchase_date)}</span>
                          <span>Previsão {formatDate(p.expected_date)}</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="secondary" size="sm" asChild>
                          <Link to={`/app/clientes/${p.customer_id}`}>Ver cadastro</Link>
                        </Button>
                        <Button
                          variant="whatsapp"
                          size="sm"
                          onClick={() =>
                            setContact({
                              customerId: p.customer_id,
                              customerName: p.customer_name,
                              phone: p.customer_phone,
                              predictionId: p.id,
                              productName: p.product_name,
                              petName: p.pet_name,
                              overdue: p.stage === 'atrasada',
                            })
                          }
                        >
                          <MessageCircle /> WhatsApp
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader title="Atividades recentes" />
              <CardBody>
                {loading ? (
                  <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
                ) : !m?.activity.length ? (
                  <p className="py-6 text-center text-sm text-subtle">Nenhuma atividade ainda.</p>
                ) : (
                  <ol className="relative space-y-4 border-l border-border pl-4">
                    {m.activity.map((a, i) => (
                      <li key={i} className="relative">
                        <span className="absolute -left-[21px] top-1.5 size-2 rounded-full border-2 border-bg bg-brand" />
                        <p className="text-[13px] text-fg">
                          {a.type === 'purchase' && <>Compra de <Link className="font-medium hover:text-brand" to={`/app/clientes/${a.customer_id}`}>{a.customer_name}</Link> · {formatCurrency(a.amount)}</>}
                          {a.type === 'contact' && <>Contato com <Link className="font-medium hover:text-brand" to={`/app/clientes/${a.customer_id}`}>{a.customer_name}</Link> · {CONTACT_RESULT[a.detail as ContactResult]?.label}</>}
                          {a.type === 'customer' && <>Novo cliente: <Link className="font-medium hover:text-brand" to={`/app/clientes/${a.customer_id}`}>{a.customer_name}</Link></>}
                        </p>
                        <p className="text-[11px] text-subtle">{formatDateTime(a.at, org.timezone)}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </CardBody>
            </Card>
          </div>
          {m && m.repurchase_due === 0 && m.customers_total > 0 && (
            <p className="text-center text-xs text-subtle">
              <Badge tone="muted">Dica</Badge> A taxa de recompra aparece quando houver previsões vencidas no período selecionado.
            </p>
          )}
        </div>
      )}

      <ContactDialog target={contact} onClose={() => setContact(null)} />
      <PurchaseDialog open={purchaseOpen} onOpenChange={setPurchaseOpen} />
    </>
  )
}
