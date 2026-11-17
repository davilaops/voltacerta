import * as React from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowDownToLine, Boxes, ClipboardList, Copy, History, PackagePlus, Search, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
import { Segmented, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu'
import { DataTable, EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/ui/states'
import { useProducts } from '@/features/products/api'
import { useOrg } from '@/features/org/OrgProvider'
import { STOCK_KIND } from '@/domain/labels'
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/format'
import { parseMoney } from '@/lib/money'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { cn } from '@/lib/utils'
import type { StockRow } from '@/types/models'
import { useStockAdjust, useStockMovements, useStockOverview, type AdjustKind } from './api'

export function StockPage() {
  useDocumentTitle('Estoque')
  const { org, canWrite } = useOrg()
  const [horizon, setHorizon] = React.useState<'15' | '30' | '60'>('30')
  const q = useStockOverview(Number(horizon))
  const [adjust, setAdjust] = React.useState<{ open: boolean; productId?: string; kind?: AdjustKind }>({ open: false })
  const [search, setSearch] = React.useState('')
  const [onlyLow, setOnlyLow] = React.useState(false)
  const rows = (q.data?.products ?? []).filter((r) => (!onlyLow || r.low_stock) && (!search.trim() || r.name.toLowerCase().includes(search.trim().toLowerCase())))
  const toBuy = (q.data?.products ?? []).filter((r) => Number(r.suggested_qty) > 0)

  return (
    <>
      <PageHeader
        title="Estoque"
        description="Saldo de cada produto, alertas de estoque baixo e sugestão de compra baseada nas recompras previstas dos seus clientes."
        actions={canWrite && (
          <>
            <Button variant="secondary" onClick={() => setAdjust({ open: true, kind: 'inventario' })}><SlidersHorizontal /> Ajustar / inventário</Button>
            <Button onClick={() => setAdjust({ open: true, kind: 'entrada' })}><ArrowDownToLine /> Entrada de mercadoria</Button>
          </>
        )}
      />
      {q.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Produtos controlados" value={formatNumber(q.data.totals.tracked)} />
          <Kpi label="Com estoque baixo" value={formatNumber(q.data.totals.low_stock)} tone={q.data.totals.low_stock ? 'warning' : undefined} />
          <Kpi label="Valor em estoque (custo)" value={formatCurrency(q.data.totals.stock_value)} />
          <Kpi label="Valor em estoque (venda)" value={formatCurrency(q.data.totals.stock_sale_value)} />
        </div>
      )}

      <Tabs defaultValue="saldo">
        <TabsList className="mb-4">
          <TabsTrigger value="saldo">Saldo</TabsTrigger>
          <TabsTrigger value="compras" count={toBuy.length}>Sugestão de compra</TabsTrigger>
          <TabsTrigger value="historico">Movimentações</TabsTrigger>
        </TabsList>

        <TabsContent value="saldo">
          <Card>
            <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
                <Input placeholder="Buscar produto" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar produto" />
              </div>
              <Checkbox label="Só estoque baixo" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />
            </div>
            {q.isLoading ? <TableSkeleton /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.products.length ? (
              <EmptyState icon={Boxes} title="Nenhum produto com estoque controlado"
                description="Registre a primeira entrada de mercadoria de um produto para começar a controlar o saldo. As vendas passam a baixar o estoque automaticamente."
                action={canWrite ? <Button onClick={() => setAdjust({ open: true, kind: 'entrada' })}><PackagePlus /> Primeira entrada</Button> : undefined} />
            ) : (
              <DataTable
                head={<><th>Produto</th><th>Saldo</th><th>Mínimo</th><th>Vendas/dia</th><th>Dura</th><th>Fornecedor</th><th className="w-40" /></>}
                mobile={rows.map((r) => (
                  <div key={r.id} className="flex items-start gap-3 px-4 py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{r.name}</div>
                      <div className="mt-0.5 text-xs text-muted">Saldo {formatNumber(r.stock_qty)} un. · mínimo {r.min_stock != null ? formatNumber(r.min_stock) : '—'}</div>
                      {r.low_stock && <Badge tone="warning" className="mt-2">Estoque baixo</Badge>}
                    </div>
                    {canWrite && <Button size="sm" variant="secondary" onClick={() => setAdjust({ open: true, productId: r.id, kind: 'entrada' })}>Entrada</Button>}
                  </div>
                ))}
              >
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><div className="font-medium">{r.name}</div><div className="text-xs text-muted">{r.brand ?? ''}</div></td>
                    <td className="tabular">
                      <span className={cn('font-semibold', Number(r.stock_qty) <= 0 ? 'text-danger' : r.low_stock ? 'text-warning' : '')}>{formatNumber(r.stock_qty)}</span>
                      <span className="ml-1 text-xs text-subtle">un.</span>
                    </td>
                    <td className="tabular text-muted">{r.min_stock != null ? formatNumber(r.min_stock) : '—'}</td>
                    <td className="tabular text-muted">{Number(r.avg_daily) > 0 ? formatNumber(Number(r.avg_daily).toFixed(2)) : '—'}</td>
                    <td className="tabular">{r.coverage_days != null ? <span className={cn(r.coverage_days <= r.lead_time_days && 'text-warning')}>{r.coverage_days} dias</span> : '—'}</td>
                    <td className="text-muted">{r.supplier ?? '—'}</td>
                    <td className="text-right">
                      {canWrite && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setAdjust({ open: true, productId: r.id, kind: 'entrada' })}>Entrada</Button>
                          <Button size="sm" variant="ghost" onClick={() => setAdjust({ open: true, productId: r.id, kind: 'inventario' })}>Ajustar</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Card>
          <p className="mt-3 text-xs text-subtle">
            Para definir estoque mínimo, fornecedor e prazo de entrega, edite o produto em <Link to="/app/produtos" className="text-brand hover:underline">Produtos</Link>.
          </p>
        </TabsContent>

        <TabsContent value="compras">
          <Card>
            <CardHeader
              title="O que comprar do fornecedor"
              description={`Considera as recompras previstas dos clientes nos próximos ${horizon} dias + o prazo de entrega de cada fornecedor, a média de vendas dos últimos 90 dias e o estoque mínimo.`}
              action={<Segmented value={horizon} onChange={setHorizon} options={[{ value: '15', label: '15 dias' }, { value: '30', label: '30 dias' }, { value: '60', label: '60 dias' }]} />}
            />
            {q.isLoading ? <TableSkeleton /> : !toBuy.length ? (
              <EmptyState icon={ClipboardList} title="Nada para comprar agora" description="O estoque atual cobre a demanda prevista para o período." className="py-10" />
            ) : (
              <>
                <SupplierLists rows={toBuy} storeName={org.name} />
                <DataTable head={<><th>Produto</th><th>Saldo</th><th>Previsto</th><th>Clientes</th><th>Comprar</th><th>Custo estimado</th></>}>
                  {toBuy.map((r) => (
                    <tr key={r.id}>
                      <td><div className="font-medium">{r.name}</div><div className="text-xs text-muted">{r.supplier ?? 'Sem fornecedor'} · entrega {r.lead_time_days} dias</div></td>
                      <td className="tabular">{formatNumber(r.stock_qty)}</td>
                      <td className="tabular">{formatNumber(r.forecast)}</td>
                      <td className="tabular text-muted">{r.predicted_customers > 0 ? `${r.predicted_customers} devem voltar` : '—'}</td>
                      <td className="tabular font-semibold text-brand">{formatNumber(r.suggested_qty)} un.</td>
                      <td className="tabular">{r.cost != null ? formatCurrency(r.suggested_cost) : <span className="text-xs text-subtle">sem custo</span>}</td>
                    </tr>
                  ))}
                </DataTable>
              </>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="historico"><MovementsCard /></TabsContent>
      </Tabs>

      <AdjustDialog open={adjust.open} productId={adjust.productId} kind={adjust.kind} onOpenChange={(o) => setAdjust((s) => ({ ...s, open: o }))} />
    </>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'warning' }) {
  return (
    <Card>
      <CardBody className="pt-4">
        <div className="text-xs text-subtle">{label}</div>
        <div className={cn('mt-1 text-lg font-semibold tabular', tone === 'warning' && 'text-warning')}>{tone === 'warning' && <AlertTriangle className="mr-1 inline size-4" />}{value}</div>
      </CardBody>
    </Card>
  )
}

/** Lista de compras por fornecedor, pronta para copiar e mandar no WhatsApp. */
function SupplierLists({ rows, storeName }: { rows: StockRow[]; storeName: string }) {
  const groups = new Map<string, StockRow[]>()
  for (const r of rows) groups.set(r.supplier ?? 'Sem fornecedor', [...(groups.get(r.supplier ?? 'Sem fornecedor') ?? []), r])
  const copy = async (supplier: string, list: StockRow[]) => {
    const text = `Olá! Pedido de ${storeName}:\n` + list.map((r) => `• ${formatNumber(r.suggested_qty)} un. — ${r.name}${r.brand ? ` (${r.brand})` : ''}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`Pedido para ${supplier} copiado.`)
    } catch {
      toast.error('Não foi possível copiar. Selecione o texto manualmente.')
    }
  }
  return (
    <div className="flex flex-wrap gap-2 px-5 pb-3">
      {[...groups.entries()].map(([supplier, list]) => (
        <Button key={supplier} variant="secondary" size="sm" onClick={() => copy(supplier, list)}>
          <Copy /> Copiar pedido · {supplier} ({list.length})
        </Button>
      ))}
    </div>
  )
}

function MovementsCard() {
  const q = useStockMovements()
  return (
    <Card>
      {q.isLoading ? <TableSkeleton /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? (
        <EmptyState icon={History} title="Nenhuma movimentação ainda" description="Entradas, vendas, ajustes e perdas aparecem aqui." />
      ) : (
        <DataTable head={<><th>Data</th><th>Produto</th><th>Tipo</th><th>Quantidade</th><th>Saldo após</th><th>Observação</th></>}>
          {q.data.map((m) => (
            <tr key={m.id}>
              <td className="whitespace-nowrap text-muted">{formatDateTime(m.created_at)}</td>
              <td className="font-medium">{m.products?.name}</td>
              <td><Badge tone={STOCK_KIND[m.kind].tone}>{STOCK_KIND[m.kind].label}</Badge></td>
              <td className={cn('tabular font-medium', Number(m.quantity) > 0 ? 'text-brand' : 'text-[#ff7a7a]')}>{Number(m.quantity) > 0 ? '+' : ''}{formatNumber(m.quantity)}</td>
              <td className="tabular">{formatNumber(m.balance_after)}</td>
              <td className="text-muted">{m.notes ?? (m.unit_cost != null ? `Custo ${formatCurrency(m.unit_cost)}` : '—')}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </Card>
  )
}

const KIND_HELP: Record<AdjustKind, string> = {
  entrada: 'Mercadoria recebida do fornecedor. Soma ao saldo.',
  perda: 'Produto vencido, avariado ou extraviado. Subtrai do saldo.',
  ajuste: 'Correção manual: use número positivo para somar e negativo para subtrair.',
  inventario: 'Informe a quantidade contada na prateleira. O sistema calcula a diferença.',
}

export function AdjustDialog({ open, onOpenChange, productId, kind }: { open: boolean; onOpenChange: (o: boolean) => void; productId?: string; kind?: AdjustKind }) {
  const products = useProducts()
  const adjust = useStockAdjust()
  const [f, setF] = React.useState({ product_id: '', kind: 'entrada' as AdjustKind, quantity: '', cost: '', notes: '', updateCost: true })
  const [submitted, setSubmitted] = React.useState(false)
  React.useEffect(() => {
    if (!open) return
    setSubmitted(false)
    setF({ product_id: productId ?? '', kind: kind ?? 'entrada', quantity: '', cost: '', notes: '', updateCost: true })
  }, [open, productId, kind])
  const product = products.data?.find((p) => p.id === f.product_id)
  const qty = parseMoney(f.quantity)
  const cost = f.cost ? parseMoney(f.cost) : null
  const errors = {
    product: !f.product_id ? 'Escolha o produto' : undefined,
    quantity: !Number.isFinite(qty) || (f.kind === 'ajuste' ? qty === 0 : f.kind === 'inventario' ? qty < 0 : qty <= 0) ? 'Quantidade inválida' : undefined,
    cost: cost != null && !(cost >= 0) ? 'Valor inválido' : undefined,
  }
  const submit = () => {
    setSubmitted(true)
    if (Object.values(errors).some(Boolean)) return
    adjust.mutate({ product_id: f.product_id, kind: f.kind, quantity: qty, unit_cost: f.kind === 'entrada' ? cost : null, notes: f.notes, update_cost: f.kind === 'entrada' && f.updateCost && cost != null },
      { onSuccess: () => onOpenChange(false) })
  }
  const e: Partial<typeof errors> = submitted ? errors : {}
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Movimentar estoque"
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={submit} loading={adjust.isPending}>Registrar</Button></>}>
      <div className="space-y-4">
        <Field label="Produto" htmlFor="adj-p" error={e.product}>
          <Select id="adj-p" value={f.product_id} onChange={(ev) => setF({ ...f, product_id: ev.target.value })}>
            <option value="">Selecione</option>
            {products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}{p.track_stock ? ` (saldo ${formatNumber(p.stock_qty)})` : ''}</option>)}
          </Select>
        </Field>
        <Field label="Tipo" htmlFor="adj-k" hint={KIND_HELP[f.kind]}>
          <Select id="adj-k" value={f.kind} onChange={(ev) => setF({ ...f, kind: ev.target.value as AdjustKind })}>
            <option value="entrada">Entrada de mercadoria</option>
            <option value="inventario">Inventário (contagem)</option>
            <option value="perda">Perda / avaria</option>
            <option value="ajuste">Ajuste manual</option>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={f.kind === 'inventario' ? 'Quantidade contada' : 'Quantidade'} htmlFor="adj-q" error={e.quantity}>
            <Input id="adj-q" inputMode="decimal" autoFocus value={f.quantity} onChange={(ev) => setF({ ...f, quantity: ev.target.value })} />
          </Field>
          {f.kind === 'entrada' && (
            <Field label="Custo unitário (R$)" htmlFor="adj-c" optional error={e.cost}>
              <Input id="adj-c" inputMode="decimal" value={f.cost} onChange={(ev) => setF({ ...f, cost: ev.target.value })} />
            </Field>
          )}
        </div>
        {f.kind === 'entrada' && f.cost && <Checkbox label="Atualizar o custo do produto" description="Usado no cálculo de margem do financeiro." checked={f.updateCost} onChange={(ev) => setF({ ...f, updateCost: ev.target.checked })} />}
        {product && !product.track_stock && <p className="text-[13px] text-info">Este produto passa a ter estoque controlado: as próximas vendas baixam o saldo automaticamente.</p>}
        <Field label="Observação" htmlFor="adj-n" optional><Textarea id="adj-n" rows={2} maxLength={500} placeholder="Ex.: NF 1234" value={f.notes} onChange={(ev) => setF({ ...f, notes: ev.target.value })} /></Field>
      </div>
    </Dialog>
  )
}
