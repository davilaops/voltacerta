import * as React from 'react'
import { Link } from 'react-router-dom'
import { Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/dialog'
import { DataTable, EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/ui/states'
import { PeriodFilter, usePeriod } from '@/components/shared/PeriodFilter'
import { PurchaseDialog } from '@/components/shared/PurchaseDialog'
import { Pagination } from '@/components/shared/Pagination'
import { PURCHASES_PAGE, useDeletePurchase, usePurchases } from './api'
import { useOrg } from '@/features/org/OrgProvider'
import { formatCurrency, formatDate, formatNumber } from '@/lib/format'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import type { Purchase } from '@/types/models'

const itemsSummary = (p: Purchase) => (p.purchase_items ?? []).map((i) => `${formatNumber(i.quantity)}× ${i.products?.name ?? ''}`).join(', ')

export function PurchasesPage() {
  useDocumentTitle('Compras')
  const { ctx, isAdmin } = useOrg()
  const confirm = useConfirm()
  const [period, setPeriod] = usePeriod(ctx.today)
  const [page, setPage] = React.useState(0)
  const [open, setOpen] = React.useState(false)
  const q = usePurchases({ from: period.from, to: period.to, page })
  const del = useDeletePurchase()
  React.useEffect(() => setPage(0), [period.from, period.to])

  const remove = async (p: Purchase) => {
    if (await confirm({ title: 'Excluir compra?', description: 'As previsões geradas por esta compra serão removidas e as anteriores reabertas. Esta ação não pode ser desfeita.', confirmLabel: 'Excluir', danger: true }))
      del.mutate(p.id)
  }
  const total = (q.data?.rows ?? []).reduce((s, p) => s + Number(p.total), 0)

  return (
    <>
      <PageHeader
        title="Compras"
        description="Cada compra atualiza o histórico do cliente e as previsões de recompra."
        actions={
          <>
            <PeriodFilter value={period} onChange={setPeriod} today={ctx.today} />
            <Button onClick={() => setOpen(true)}><Plus /> Registrar compra</Button>
          </>
        }
      />
      <Card>
        {q.isLoading ? (
          <TableSkeleton />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.rows.length ? (
          <EmptyState
            icon={ShoppingBag}
            title="Nenhuma compra no período"
            description="Registre as vendas para que o VoltaCerta calcule quando cada cliente vai precisar repor os produtos."
            action={<Button onClick={() => setOpen(true)}><Plus /> Registrar compra</Button>}
          />
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-border px-5 py-3 text-[13px] text-muted">
              <span>{q.data.count} compras no período</span>
              <span>Nesta página: <strong className="tabular text-fg">{formatCurrency(total)}</strong></span>
            </div>
            <DataTable
              head={<><th>Data</th><th>Cliente</th><th>Itens</th><th className="text-right">Total</th>{isAdmin && <th className="w-12" />}</>}
              mobile={q.data.rows.map((p) => (
                <div key={p.id} className="px-4 py-3.5">
                  <div className="flex justify-between gap-3">
                    <Link to={`/app/clientes/${p.customer_id}`} className="truncate text-sm font-medium">{p.customers?.full_name}</Link>
                    <span className="text-sm font-semibold tabular">{formatCurrency(p.total)}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">{formatDate(p.purchase_date)} · {itemsSummary(p)}</div>
                </div>
              ))}
            >
              {q.data.rows.map((p) => (
                <tr key={p.id}>
                  <td className="tabular">{formatDate(p.purchase_date)}</td>
                  <td><Link to={`/app/clientes/${p.customer_id}`} className="font-medium hover:text-brand">{p.customers?.full_name}</Link></td>
                  <td className="max-w-md truncate text-muted">{itemsSummary(p)}</td>
                  <td className="text-right font-medium tabular">
                    {formatCurrency(p.total)}
                    {Number(p.discount) > 0 && <div className="text-xs font-normal text-subtle">desc. {formatCurrency(p.discount)}</div>}
                  </td>
                  {isAdmin && (
                    <td><Button variant="ghost" size="icon-sm" aria-label="Excluir compra" onClick={() => remove(p)}><Trash2 /></Button></td>
                  )}
                </tr>
              ))}
            </DataTable>
            <Pagination page={page} pageSize={PURCHASES_PAGE} total={q.data.count} onPage={setPage} />
          </>
        )}
      </Card>
      <PurchaseDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
