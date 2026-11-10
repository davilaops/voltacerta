import * as React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Download, Lock } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DataTable, EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/ui/states'
import { PeriodFilter, usePeriod } from '@/components/shared/PeriodFilter'
import { useOrg } from '@/features/org/OrgProvider'
import { rpc } from '@/lib/supabase'
import { toCsv, downloadFile, type CsvColumn } from '@/lib/csv'
import { formatCurrency, formatDate, formatNumber, formatPercent, formatPhone } from '@/lib/format'
import { CATEGORY } from '@/domain/labels'
import { cn } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import type { ProductCategory } from '@/types/models'

type Row = Record<string, unknown>
type Kind = 'sales_by_period' | 'top_products' | 'top_customers' | 'inactive_customers' | 'completed_repurchases' | 'lost_opportunities' | 'recovered_revenue' | 'recovery_rate'

type Fmt = 'text' | 'money' | 'date' | 'number' | 'percent' | 'phone' | 'category' | 'bool'
interface Col { key: string; label: string; fmt?: Fmt; align?: 'right' }

const REPORTS: { kind: Kind; title: string; description: string; full: boolean; cols: Col[] }[] = [
  { kind: 'sales_by_period', title: 'Vendas por período', description: 'Compras e faturamento por dia', full: false, cols: [
    { key: 'date', label: 'Data', fmt: 'date' }, { key: 'purchases', label: 'Compras', fmt: 'number', align: 'right' },
    { key: 'customers', label: 'Clientes', fmt: 'number', align: 'right' }, { key: 'revenue', label: 'Faturamento', fmt: 'money', align: 'right' } ] },
  { kind: 'recovered_revenue', title: 'Receita recuperada', description: 'Vendas concluídas após contato registrado', full: false, cols: [
    { key: 'purchase_date', label: 'Data', fmt: 'date' }, { key: 'customer', label: 'Cliente' }, { key: 'product', label: 'Produto' },
    { key: 'amount', label: 'Valor recuperado', fmt: 'money', align: 'right' } ] },
  { kind: 'top_products', title: 'Produtos mais vendidos', description: 'Ranking por faturamento', full: true, cols: [
    { key: 'product', label: 'Produto' }, { key: 'category', label: 'Categoria', fmt: 'category' }, { key: 'quantity', label: 'Quantidade', fmt: 'number', align: 'right' },
    { key: 'purchases', label: 'Compras', fmt: 'number', align: 'right' }, { key: 'revenue', label: 'Faturamento', fmt: 'money', align: 'right' } ] },
  { kind: 'top_customers', title: 'Clientes com maior recorrência', description: 'Quem mais comprou no período', full: true, cols: [
    { key: 'customer', label: 'Cliente' }, { key: 'phone', label: 'Telefone', fmt: 'phone' }, { key: 'purchases', label: 'Compras', fmt: 'number', align: 'right' },
    { key: 'revenue', label: 'Faturamento', fmt: 'money', align: 'right' }, { key: 'last_purchase', label: 'Última compra', fmt: 'date' } ] },
  { kind: 'inactive_customers', title: 'Clientes inativos', description: 'Compraram antes, mas não no período', full: true, cols: [
    { key: 'customer', label: 'Cliente' }, { key: 'phone', label: 'Telefone', fmt: 'phone' }, { key: 'last_purchase', label: 'Última compra', fmt: 'date' },
    { key: 'days_inactive', label: 'Dias sem comprar', fmt: 'number', align: 'right' }, { key: 'lifetime_revenue', label: 'Total histórico', fmt: 'money', align: 'right' } ] },
  { kind: 'completed_repurchases', title: 'Recompras concluídas', description: 'Previsões encerradas por nova compra', full: true, cols: [
    { key: 'purchase_date', label: 'Data da compra', fmt: 'date' }, { key: 'customer', label: 'Cliente' }, { key: 'product', label: 'Produto' },
    { key: 'expected_date', label: 'Previsão', fmt: 'date' }, { key: 'days_vs_expected', label: 'Dias vs. previsão', fmt: 'number', align: 'right' },
    { key: 'recovered', label: 'Após contato', fmt: 'bool' } ] },
  { kind: 'lost_opportunities', title: 'Oportunidades perdidas', description: 'Previsões ignoradas ou vencidas há muito tempo sem recompra', full: true, cols: [
    { key: 'customer', label: 'Cliente' }, { key: 'phone', label: 'Telefone', fmt: 'phone' }, { key: 'product', label: 'Produto' },
    { key: 'expected_date', label: 'Previsão', fmt: 'date' }, { key: 'days_overdue', label: 'Dias de atraso', fmt: 'number', align: 'right' },
    { key: 'potential_value', label: 'Valor potencial', fmt: 'money', align: 'right' }, { key: 'reason', label: 'Motivo' } ] },
  { kind: 'recovery_rate', title: 'Taxa de recuperação', description: 'Resumo das previsões vencidas no período', full: true, cols: [
    { key: 'predictions_due', label: 'Previsões vencidas', fmt: 'number', align: 'right' }, { key: 'contacted', label: 'Contatadas', fmt: 'number', align: 'right' },
    { key: 'completed', label: 'Recompradas', fmt: 'number', align: 'right' }, { key: 'recovered', label: 'Recuperadas', fmt: 'number', align: 'right' },
    { key: 'repurchase_rate', label: 'Taxa de recompra', fmt: 'percent', align: 'right' }, { key: 'recovery_rate', label: 'Taxa de recuperação', fmt: 'percent', align: 'right' } ] },
]

function fmt(v: unknown, f: Fmt = 'text'): string {
  if (v == null || v === '') return '—'
  switch (f) {
    case 'money': return formatCurrency(v as number)
    case 'date': return formatDate(String(v))
    case 'number': return formatNumber(v as number)
    case 'percent': return formatPercent(Number(v))
    case 'phone': return formatPhone(String(v))
    case 'category': return CATEGORY[v as ProductCategory] ?? String(v)
    case 'bool': return v ? 'Sim' : 'Não'
    default: return String(v)
  }
}

export function ReportsPage() {
  useDocumentTitle('Relatórios')
  const { org, ctx } = useOrg()
  const [kind, setKind] = React.useState<Kind>('sales_by_period')
  const [period, setPeriod] = usePeriod(ctx.today)
  const report = REPORTS.find((r) => r.kind === kind)!
  const locked = report.full && !ctx.features.reports_full

  const q = useQuery({
    queryKey: ['reports', org.id, kind, period.from, period.to],
    enabled: !locked,
    queryFn: () => rpc<Row[]>('get_report', { p_org: org.id, p_kind: kind, p_from: period.from, p_to: period.to }),
  })

  const exportCsv = () => {
    const columns: CsvColumn<Row>[] = report.cols.map((c) => ({
      key: c.key,
      label: c.label,
      format: (v) => (c.fmt === 'money' || c.fmt === 'number' || c.fmt === 'percent' ? (v == null ? '' : String(v).replace('.', ',')) : fmt(v, c.fmt) === '—' ? '' : fmt(v, c.fmt)),
    }))
    downloadFile(`voltacerta-${kind}-${period.from}_${period.to}.csv`, toCsv(q.data ?? [], columns))
  }

  const totals = report.cols.filter((c) => c.fmt === 'money')

  return (
    <>
      <PageHeader title="Relatórios" description="Dados reais do seu estabelecimento. Valor potencial nunca é somado como receita." actions={<PeriodFilter value={period} onChange={setPeriod} today={ctx.today} maxDays={731} />} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit p-1.5">
          <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Relatórios">
            {REPORTS.map((r) => {
              const isLocked = r.full && !ctx.features.reports_full
              return (
                <button
                  key={r.kind}
                  onClick={() => setKind(r.kind)}
                  className={cn(
                    'flex shrink-0 items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-[13px] transition-colors',
                    kind === r.kind ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2/60 hover:text-fg',
                  )}
                >
                  {r.title}
                  {isLocked && <Lock className="size-3.5 text-subtle" />}
                </button>
              )
            })}
          </nav>
        </Card>

        <Card className="min-w-0">
          <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold">{report.title}</h2>
              <p className="text-[13px] text-muted">{report.description}</p>
            </div>
            {!locked && (
              <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!q.data?.length}>
                <Download /> Exportar CSV
              </Button>
            )}
          </div>
          {locked ? (
            <EmptyState
              icon={Lock}
              title="Disponível no plano Profissional"
              description="Relatórios completos de produtos, recorrência, clientes inativos e recuperação fazem parte dos planos Profissional e Premium."
              action={<Button asChild><Link to="/app/plano">Ver planos</Link></Button>}
            />
          ) : q.isLoading ? (
            <TableSkeleton rows={6} cols={report.cols.length} />
          ) : q.error ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : !q.data?.length ? (
            <EmptyState icon={BarChart3} title="Sem dados no período" description="Altere o período ou registre mais compras e contatos." />
          ) : (
            <>
              <DataTable head={<>{report.cols.map((c) => <th key={c.key} className={c.align === 'right' ? 'text-right' : ''}>{c.label}</th>)}</>}>
                {q.data.map((row, i) => (
                  <tr key={i}>
                    {report.cols.map((c) => (
                      <td key={c.key} className={cn(c.align === 'right' && 'text-right tabular', c.fmt === 'date' && 'tabular')}>{fmt(row[c.key], c.fmt)}</td>
                    ))}
                  </tr>
                ))}
              </DataTable>
              {totals.length > 0 && kind !== 'recovery_rate' && (
                <div className="flex flex-wrap justify-end gap-6 border-t border-border px-5 py-3 text-[13px] text-muted">
                  {totals.map((c) => (
                    <span key={c.key}>
                      Total {c.label.toLowerCase()}:{' '}
                      <strong className="tabular text-fg">{formatCurrency(q.data!.reduce((s, r) => s + Number(r[c.key] ?? 0), 0))}</strong>
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </>
  )
}
