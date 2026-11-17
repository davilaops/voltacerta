import * as React from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, EllipsisVertical, Lock, Pencil, Plus, Wallet, XCircle } from 'lucide-react'
import { Badge, Card, CardBody, CardHeader, Skeleton } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/input'
import { Dialog, useConfirm } from '@/components/ui/dialog'
import { Menu, MenuContent, MenuItem, MenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu'
import { DataTable, EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/ui/states'
import { PeriodFilter, usePeriod } from '@/components/shared/PeriodFilter'
import { CustomerPicker, type PickedCustomer } from '@/components/shared/CustomerPicker'
import { useOrg } from '@/features/org/OrgProvider'
import { EXPENSE_CATEGORY, FINANCE_CATEGORY, INCOME_CATEGORY, PAYMENT_METHOD } from '@/domain/labels'
import { formatCurrency, formatDate, formatNumber, formatShortDate } from '@/lib/format'
import { moneyInput, parseMoney } from '@/lib/money'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { cn } from '@/lib/utils'
import type { FinanceCategory, FinanceEntry, PaymentMethod } from '@/types/models'
import { useCancelEntry, useFinanceEntries, useFinanceReport, useSaveEntry, useSettleEntry, type EntryFilter } from './api'

const CHART = { brand: '#22C58B', danger: '#f05252', info: '#60a5fa', grid: '#1e2a40', axis: '#64748b' }

export function FinancePage() {
  useDocumentTitle('Financeiro')
  const { ctx, isAdmin } = useOrg()
  const [period, setPeriod] = usePeriod(ctx.today, '30d')
  const [dialog, setDialog] = React.useState<{ open: boolean; entry: FinanceEntry | null; kind: 'income' | 'expense' }>({ open: false, entry: null, kind: 'expense' })
  const [settling, setSettling] = React.useState<FinanceEntry | null>(null)

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Financeiro" />
        <Card><EmptyState icon={Lock} title="Acesso restrito" description="O financeiro é visível apenas para proprietários e administradores." /></Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Financeiro"
        description="Faturamento, contas a pagar e a receber e fluxo de caixa. Toda venda entra aqui automaticamente."
        actions={
          <>
            <Button variant="secondary" onClick={() => setDialog({ open: true, entry: null, kind: 'income' })}><ArrowUpRight /> Receita</Button>
            <Button onClick={() => setDialog({ open: true, entry: null, kind: 'expense' })}><Plus /> Despesa</Button>
          </>
        }
      />
      <Tabs defaultValue="resumo">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <TabsList>
            <TabsTrigger value="resumo">Resumo</TabsTrigger>
            <TabsTrigger value="receber">A receber</TabsTrigger>
            <TabsTrigger value="pagar">A pagar</TabsTrigger>
            <TabsTrigger value="lancamentos">Lançamentos</TabsTrigger>
          </TabsList>
          <PeriodFilter value={period} onChange={setPeriod} today={ctx.today} maxDays={731} />
        </div>
        <TabsContent value="resumo"><Summary from={period.from} to={period.to} /></TabsContent>
        <TabsContent value="receber">
          <EntriesTable filter={{ view: 'receivable' }} onSettle={setSettling} onEdit={(e) => setDialog({ open: true, entry: e, kind: e.kind })} empty="Nenhuma conta a receber em aberto. Vendas fiado aparecem aqui." />
        </TabsContent>
        <TabsContent value="pagar">
          <EntriesTable filter={{ view: 'payable' }} onSettle={setSettling} onEdit={(e) => setDialog({ open: true, entry: e, kind: e.kind })} empty="Nenhuma conta a pagar em aberto. Lance aluguel, fornecedores e outras despesas." />
        </TabsContent>
        <TabsContent value="lancamentos">
          <EntriesTable filter={{ view: 'all', from: period.from, to: period.to }} onSettle={setSettling} onEdit={(e) => setDialog({ open: true, entry: e, kind: e.kind })} empty="Nenhum lançamento no período." />
        </TabsContent>
      </Tabs>
      <EntryDialog open={dialog.open} entry={dialog.entry} kind={dialog.kind} onOpenChange={(o) => setDialog((s) => ({ ...s, open: o }))} />
      <SettleDialog entry={settling} onClose={() => setSettling(null)} />
    </>
  )
}

function Stat({ label, value, hint, tone, loading }: { label: string; value: string; hint?: string; tone?: 'brand' | 'danger' | 'warning'; loading?: boolean }) {
  return (
    <Card className="p-4">
      <div className="text-[13px] text-muted">{label}</div>
      {loading ? <Skeleton className="mt-2 h-7 w-28" /> : (
        <div className={cn('mt-1 text-xl font-semibold tabular', tone === 'brand' && 'text-brand', tone === 'danger' && 'text-[#ff7a7a]', tone === 'warning' && 'text-warning')}>{value}</div>
      )}
      {hint && <div className="mt-1 text-xs text-subtle">{hint}</div>}
    </Card>
  )
}

function Summary({ from, to }: { from: string; to: string }) {
  const q = useFinanceReport(from, to)
  const r = q.data
  const loading = q.isLoading
  if (q.error) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
  const balance = r ? Number(r.received) - Number(r.paid_expenses) : 0
  const margin = r && Number(r.products_revenue) > 0 ? ((Number(r.products_revenue) - Number(r.products_cost)) / Number(r.products_revenue)) * 100 : null
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat loading={loading} label="Faturamento" value={formatCurrency(r?.revenue)} hint={r ? `${r.sales_count} vendas · ticket médio ${formatCurrency(r.avg_ticket)}` : undefined} />
        <Stat loading={loading} label="Recebido no período" value={formatCurrency(r?.received)} tone="brand" />
        <Stat loading={loading} label="Despesas pagas" value={formatCurrency(r?.paid_expenses)} tone="danger" />
        <Stat loading={loading} label="Saldo (recebido − pago)" value={formatCurrency(balance)} tone={balance >= 0 ? 'brand' : 'danger'} />
        <Stat loading={loading} label="Lucro bruto estimado" value={formatCurrency(r?.gross_profit)}
          hint={margin != null ? `Margem dos produtos ${formatNumber(margin.toFixed(1))}%${r?.products_cost_missing ? ` · ${r.products_cost_missing} produto(s) sem custo` : ''}` : 'Cadastre o custo dos produtos'} />
        <Stat loading={loading} label="A receber" value={formatCurrency(r?.receivable_open)} hint={r && Number(r.receivable_overdue) > 0 ? `${formatCurrency(r.receivable_overdue)} vencido` : 'Nada vencido'} tone={r && Number(r.receivable_overdue) > 0 ? 'warning' : undefined} />
        <Stat loading={loading} label="A pagar" value={formatCurrency(r?.payable_open)} hint={r ? `${formatCurrency(r.payable_next7)} nos próximos 7 dias` : undefined} />
        <Stat loading={loading} label="Contas vencidas a pagar" value={formatCurrency(r?.payable_overdue)} tone={r && Number(r.payable_overdue) > 0 ? 'danger' : undefined} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Fluxo de caixa" description="Entradas recebidas e despesas pagas por dia" />
          <CardBody className="h-72">
            {loading ? <Skeleton className="h-full w-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={r!.series} margin={{ left: -8, right: 8, top: 4 }}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="date" tickFormatter={formatShortDate} stroke={CHART.axis} fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis stroke={CHART.axis} fontSize={11} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => `R$${formatNumber(v)}`} />
                  <Tooltip formatter={(v) => formatCurrency(Number(v))} labelFormatter={(l) => formatDate(String(l))}
                    contentStyle={{ background: '#0f1729', border: '1px solid #1e2a40', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="received" name="Entradas" fill={CHART.brand} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="expenses" name="Saídas" fill={CHART.danger} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Recebido por forma de pagamento" />
            <CardBody className="space-y-2">
              {loading ? <Skeleton className="h-20 w-full" /> : Object.keys(r!.by_method).length ? (Object.entries(r!.by_method) as [PaymentMethod, number][])
                .sort((a, b) => b[1] - a[1]).map(([m, v]) => <Row key={m} label={PAYMENT_METHOD[m]} value={v} total={Number(r!.received)} />)
                : <p className="text-[13px] text-subtle">Sem recebimentos no período.</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Despesas por categoria" />
            <CardBody className="space-y-2">
              {loading ? <Skeleton className="h-20 w-full" /> : Object.keys(r!.expenses_by_category).length ? (Object.entries(r!.expenses_by_category) as [FinanceCategory, number][])
                .sort((a, b) => b[1] - a[1]).map(([c, v]) => <Row key={c} label={FINANCE_CATEGORY[c]} value={v} total={Number(r!.paid_expenses)} danger />)
                : <p className="text-[13px] text-subtle">Sem despesas pagas no período.</p>}
            </CardBody>
          </Card>
        </div>
      </div>
      {r && (
        <Card>
          <CardHeader title="Composição do faturamento" />
          <CardBody className="grid gap-3 text-sm sm:grid-cols-4">
            <div><div className="text-xs text-subtle">Produtos</div><div className="font-semibold tabular">{formatCurrency(r.products_revenue)}</div></div>
            <div><div className="text-xs text-subtle">Serviços e pacotes</div><div className="font-semibold tabular">{formatCurrency(r.services_revenue)}</div></div>
            <div><div className="text-xs text-subtle">Descontos concedidos</div><div className="font-semibold tabular">{formatCurrency(r.discounts)}</div></div>
            <div><div className="text-xs text-subtle">Custo dos produtos (estimado)</div><div className="font-semibold tabular">{formatCurrency(r.products_cost)}</div></div>
          </CardBody>
        </Card>
      )}
    </div>
  )
}

function Row({ label, value, total, danger }: { label: string; value: number; total: number; danger?: boolean }) {
  const pct = total > 0 ? (Number(value) / total) * 100 : 0
  return (
    <div>
      <div className="flex justify-between text-[13px]"><span className="text-muted">{label}</span><span className="tabular">{formatCurrency(value)}</span></div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3"><div className={cn('h-full rounded-full', danger ? 'bg-danger' : 'bg-brand')} style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

function EntriesTable({ filter, onSettle, onEdit, empty }: { filter: EntryFilter; onSettle: (e: FinanceEntry) => void; onEdit: (e: FinanceEntry) => void; empty: string }) {
  const { ctx } = useOrg()
  const q = useFinanceEntries(filter)
  const cancel = useCancelEntry()
  const confirm = useConfirm()
  const total = (q.data ?? []).filter((e) => e.status !== 'canceled').reduce((s, e) => s + Number(e.amount) * (e.kind === 'expense' && filter.view === 'all' ? -1 : 1), 0)
  const statusBadge = (e: FinanceEntry) =>
    e.status === 'paid' ? <Badge tone="brand" dot>Pago {formatDate(e.paid_at)}</Badge>
      : e.status === 'canceled' ? <Badge tone="muted">Cancelado</Badge>
        : e.due_date < ctx.today ? <Badge tone="danger" dot>Vencido</Badge> : <Badge tone="warning" dot>Em aberto</Badge>
  return (
    <Card>
      {q.isLoading ? <TableSkeleton /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? (
        <EmptyState icon={Wallet} title="Nada por aqui" description={empty} />
      ) : (
        <>
          <DataTable
            head={<><th>Vencimento</th><th>Descrição</th><th>Categoria</th><th>Valor</th><th>Situação</th><th className="w-12" /></>}
            mobile={q.data.map((e) => (
              <div key={e.id} className="flex items-start gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{e.description}</div>
                  <div className="mt-0.5 text-xs text-muted">{formatDate(e.due_date)} · {FINANCE_CATEGORY[e.category]}{e.customers ? ` · ${e.customers.full_name}` : ''}</div>
                  <div className="mt-2 flex items-center gap-2">{statusBadge(e)}<span className={cn('text-sm font-semibold tabular', e.kind === 'expense' ? 'text-[#ff7a7a]' : 'text-brand')}>{formatCurrency(e.amount)}</span></div>
                </div>
                {e.status === 'pending' && <Button size="sm" variant="secondary" onClick={() => onSettle(e)}>Baixar</Button>}
              </div>
            ))}
          >
            {q.data.map((e) => (
              <tr key={e.id} className={cn(e.status === 'canceled' && 'opacity-50')}>
                <td className="whitespace-nowrap tabular text-muted">{formatDate(e.due_date)}</td>
                <td>
                  <div className="font-medium">{e.description}</div>
                  <div className="text-xs text-muted">{[e.customers?.full_name, e.supplier, e.payment_method ? PAYMENT_METHOD[e.payment_method] : null].filter(Boolean).join(' · ')}</div>
                </td>
                <td className="text-muted">{FINANCE_CATEGORY[e.category]}</td>
                <td className={cn('tabular font-medium', e.kind === 'expense' ? 'text-[#ff7a7a]' : 'text-brand')}>{e.kind === 'expense' ? <ArrowDownRight className="mr-1 inline size-3.5" /> : <ArrowUpRight className="mr-1 inline size-3.5" />}{formatCurrency(e.amount)}</td>
                <td>{statusBadge(e)}</td>
                <td>
                  {e.status !== 'canceled' && (e.status === 'pending' || !e.purchase_id) && (
                    <Menu>
                      <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Ações do lançamento"><EllipsisVertical /></Button></MenuTrigger>
                      <MenuContent>
                        {e.status === 'pending' && <MenuItem onSelect={() => onSettle(e)}><CheckCircle2 /> Registrar pagamento</MenuItem>}
                        {!e.purchase_id && <MenuItem onSelect={() => onEdit(e)}><Pencil /> Editar</MenuItem>}
                        {!e.purchase_id && (
                          <MenuItem danger onSelect={async () => {
                            if (await confirm({ title: 'Cancelar lançamento?', description: `${e.description} — ${formatCurrency(e.amount)}. Ele deixa de contar nos totais.`, confirmLabel: 'Cancelar lançamento', danger: true })) cancel.mutate(e.id)
                          }}><XCircle /> Cancelar</MenuItem>
                        )}
                      </MenuContent>
                    </Menu>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
          <div className="flex justify-end border-t border-border px-5 py-3 text-sm">
            <span className="text-muted">{filter.view === 'all' ? 'Saldo dos lançamentos' : 'Total em aberto'}:</span>
            <span className={cn('ml-2 font-semibold tabular', total < 0 && 'text-[#ff7a7a]')}>{formatCurrency(total)}</span>
          </div>
        </>
      )}
    </Card>
  )
}

const METHODS: PaymentMethod[] = ['pix', 'dinheiro', 'cartao_debito', 'cartao_credito', 'transferencia', 'boleto', 'outro']

function EntryDialog({ open, onOpenChange, entry, kind: initialKind }: { open: boolean; onOpenChange: (o: boolean) => void; entry: FinanceEntry | null; kind: 'income' | 'expense' }) {
  const { ctx } = useOrg()
  const save = useSaveEntry()
  const [kind, setKind] = React.useState<'income' | 'expense'>(initialKind)
  const [f, setF] = React.useState({ category: 'outras_despesas' as FinanceCategory, description: '', amount: '', due: ctx.today, paid: false, paidAt: ctx.today, method: 'pix' as PaymentMethod, supplier: '', notes: '', repeat: '1' })
  const [customer, setCustomer] = React.useState<PickedCustomer | null>(null)
  const [submitted, setSubmitted] = React.useState(false)
  React.useEffect(() => {
    if (!open) return
    setSubmitted(false)
    const k = entry?.kind ?? initialKind
    setKind(k)
    setCustomer(entry?.customer_id ? { id: entry.customer_id, full_name: entry.customers?.full_name ?? '' } : null)
    setF(entry
      ? { category: entry.category, description: entry.description, amount: moneyInput(entry.amount), due: entry.due_date, paid: entry.status === 'paid', paidAt: entry.paid_at ?? ctx.today, method: entry.payment_method && entry.payment_method !== 'nao_informado' && entry.payment_method !== 'fiado' ? entry.payment_method : 'pix', supplier: entry.supplier ?? '', notes: entry.notes ?? '', repeat: '1' }
      : { category: k === 'expense' ? 'outras_despesas' : 'outras_receitas', description: '', amount: '', due: ctx.today, paid: false, paidAt: ctx.today, method: 'pix', supplier: '', notes: '', repeat: '1' })
  }, [open, entry, initialKind, ctx.today])
  const cats = kind === 'expense' ? EXPENSE_CATEGORY : INCOME_CATEGORY
  const amount = parseMoney(f.amount)
  const repeat = Number(f.repeat)
  const errors = {
    description: f.description.trim().length < 2 ? 'Descreva o lançamento' : undefined,
    amount: !(amount > 0) ? 'Valor inválido' : undefined,
    due: !f.due ? 'Informe o vencimento' : undefined,
    paidAt: f.paid && (!f.paidAt || f.paidAt > ctx.today) ? 'Data de pagamento inválida' : undefined,
  }
  const submit = async () => {
    setSubmitted(true)
    if (Object.values(errors).some(Boolean)) return
    // Repetição mensal (ex.: aluguel): cria um lançamento por mês, somente o primeiro pode estar pago
    const months = entry ? 1 : Math.min(Math.max(repeat || 1, 1), 24)
    for (let i = 0; i < months; i++) {
      const d = new Date(f.due + 'T12:00:00Z')
      d.setUTCMonth(d.getUTCMonth() + i)
      const ok = await save.mutateAsync({
        id: entry?.id, kind, category: f.category, description: months > 1 ? `${f.description.trim()} (${i + 1}/${months})` : f.description.trim(),
        amount, due_date: d.toISOString().slice(0, 10), paid: i === 0 && f.paid, paid_at: f.paidAt, method: i === 0 && f.paid ? f.method : null,
        customer_id: customer?.id ?? null, supplier: f.supplier, notes: f.notes,
      }).then(() => true).catch(() => false)
      if (!ok) return
    }
    onOpenChange(false)
  }
  const e: Partial<typeof errors> = submitted ? errors : {}
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={entry ? 'Editar lançamento' : kind === 'expense' ? 'Nova despesa' : 'Nova receita'}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={submit} loading={save.isPending}>Salvar</Button></>}>
      <div className="space-y-4">
        {!entry && (
          <div className="grid grid-cols-2 gap-2">
            {(['expense', 'income'] as const).map((k) => (
              <button key={k} type="button" onClick={() => { setKind(k); setF((s) => ({ ...s, category: k === 'expense' ? 'outras_despesas' : 'outras_receitas' })) }}
                className={cn('h-9 rounded-md border text-[13px] font-medium', kind === k ? (k === 'expense' ? 'border-danger/40 bg-danger/10 text-[#ff7a7a]' : 'border-brand/40 bg-brand/10 text-brand') : 'border-border text-muted')}>
                {k === 'expense' ? 'Despesa (a pagar)' : 'Receita (a receber)'}
              </button>
            ))}
          </div>
        )}
        <Field label="Descrição" htmlFor="fe-d" error={e.description}><Input id="fe-d" autoFocus placeholder={kind === 'expense' ? 'Ex.: Aluguel da loja' : 'Ex.: Venda de filhote'} value={f.description} onChange={(ev) => setF({ ...f, description: ev.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Categoria" htmlFor="fe-c">
            <Select id="fe-c" value={f.category} onChange={(ev) => setF({ ...f, category: ev.target.value as FinanceCategory })}>
              {Object.entries(cats).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Valor (R$)" htmlFor="fe-a" error={e.amount}><Input id="fe-a" inputMode="decimal" value={f.amount} onChange={(ev) => setF({ ...f, amount: ev.target.value })} /></Field>
          <Field label="Vencimento" htmlFor="fe-due" error={e.due}><Input id="fe-due" type="date" value={f.due} onChange={(ev) => setF({ ...f, due: ev.target.value })} /></Field>
          {kind === 'expense' ? (
            <Field label="Fornecedor" htmlFor="fe-s" optional><Input id="fe-s" maxLength={120} value={f.supplier} onChange={(ev) => setF({ ...f, supplier: ev.target.value })} /></Field>
          ) : !entry && (
            <Field label="Repetir por (meses)" htmlFor="fe-r" optional><Input id="fe-r" inputMode="numeric" value={f.repeat} onChange={(ev) => setF({ ...f, repeat: ev.target.value })} /></Field>
          )}
        </div>
        {kind === 'expense' && !entry && (
          <Field label="Repetir por (meses)" htmlFor="fe-r2" optional hint="Para contas fixas como aluguel e internet (até 24 meses).">
            <Input id="fe-r2" inputMode="numeric" value={f.repeat} onChange={(ev) => setF({ ...f, repeat: ev.target.value })} />
          </Field>
        )}
        {kind === 'income' && <Field label="Cliente" optional><CustomerPicker value={customer} onChange={setCustomer} /></Field>}
        <Checkbox label="Já foi pago" checked={f.paid} onChange={(ev) => setF({ ...f, paid: ev.target.checked })} />
        {f.paid && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Pago em" htmlFor="fe-p" error={e.paidAt}><Input id="fe-p" type="date" max={ctx.today} value={f.paidAt} onChange={(ev) => setF({ ...f, paidAt: ev.target.value })} /></Field>
            <Field label="Forma" htmlFor="fe-m">
              <Select id="fe-m" value={f.method} onChange={(ev) => setF({ ...f, method: ev.target.value as PaymentMethod })}>
                {METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD[m]}</option>)}
              </Select>
            </Field>
          </div>
        )}
        <Field label="Observações" htmlFor="fe-n" optional><Textarea id="fe-n" rows={2} maxLength={500} value={f.notes} onChange={(ev) => setF({ ...f, notes: ev.target.value })} /></Field>
      </div>
    </Dialog>
  )
}

function SettleDialog({ entry, onClose }: { entry: FinanceEntry | null; onClose: () => void }) {
  const { ctx } = useOrg()
  const settle = useSettleEntry()
  const [method, setMethod] = React.useState<PaymentMethod>('pix')
  const [date, setDate] = React.useState(ctx.today)
  React.useEffect(() => { setMethod('pix'); setDate(ctx.today) }, [entry, ctx.today])
  if (!entry) return null
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="sm" title={entry.kind === 'income' ? 'Registrar recebimento' : 'Registrar pagamento'}
      description={`${entry.description} — ${formatCurrency(entry.amount)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={settle.isPending} disabled={!date || date > ctx.today} onClick={() => settle.mutate({ id: entry.id, method, paid_at: date }, { onSuccess: onClose })}>Confirmar</Button></>}>
      <div className="space-y-4">
        {entry.due_date < ctx.today && <p className="flex items-center gap-2 text-[13px] text-warning"><AlertTriangle className="size-4" /> Venceu em {formatDate(entry.due_date)}.</p>}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Data" htmlFor="st-d"><Input id="st-d" type="date" max={ctx.today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Forma" htmlFor="st-m">
            <Select id="st-m" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD[m]}</option>)}
            </Select>
          </Field>
        </div>
        {method === 'dinheiro' && date === ctx.today && <p className="text-xs text-subtle">Recebimentos em dinheiro hoje entram no caixa aberto.</p>}
      </div>
    </Dialog>
  )
}
