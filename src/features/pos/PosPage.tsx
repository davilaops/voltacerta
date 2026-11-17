import * as React from 'react'
import { ArrowDownCircle, ArrowUpCircle, Lock, Minus, Package, Plus, Receipt, Scissors, Search, ShoppingCart, Trash2, Wallet } from 'lucide-react'
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
import { DataTable, EmptyState, PageHeader, TableSkeleton } from '@/components/ui/states'
import { CustomerPicker, type PickedCustomer } from '@/components/shared/CustomerPicker'
import { PaymentEditor, usePayments } from '@/components/shared/PaymentEditor'
import { InvoiceActions } from '@/features/integrations/InvoiceActions'
import { useProducts } from '@/features/products/api'
import { useServices } from '@/features/services/api'
import { useOrg } from '@/features/org/OrgProvider'
import { PAYMENT_METHOD } from '@/domain/labels'
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/format'
import { moneyInput, parseMoney, round2 } from '@/lib/money'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { cn, newRequestId } from '@/lib/utils'
import type { PaymentMethod } from '@/types/models'
import { useCashMovement, useCashSessions, useCashSummary, useCheckout, useCloseCash, useOpenCash, useSessionSales } from './api'

interface CartLine {
  key: string
  type: 'product' | 'service'
  id: string
  name: string
  quantity: string
  unit_price: string
  stock?: number | null
}

export function PosPage() {
  useDocumentTitle('Caixa')
  const summary = useCashSummary()
  if (summary.isLoading) return <><PageHeader title="Caixa" /><Card><TableSkeleton /></Card></>
  return summary.data ? <OpenRegister /> : <ClosedRegister />
}

// ---------------------------------------------------------------------
function ClosedRegister() {
  const open = useOpenCash()
  const sessions = useCashSessions()
  const { canWrite } = useOrg()
  const [amount, setAmount] = React.useState('')
  const value = amount ? parseMoney(amount) : 0
  return (
    <>
      <PageHeader title="Caixa" description="Vendas no balcão de produtos e serviços, com cliente identificado ou consumidor final." />
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader title="Abrir caixa" description="Informe o dinheiro que já está na gaveta (troco inicial)." />
          <CardBody className="space-y-4">
            <Field label="Fundo de troco (R$)" htmlFor="opening"><Input id="opening" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Button className="w-full" loading={open.isPending} disabled={!canWrite || !(value >= 0)} onClick={() => open.mutate({ opening: value || 0 })}>
              <Wallet /> Abrir caixa
            </Button>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Caixas anteriores" />
          {sessions.isLoading ? <TableSkeleton rows={3} /> : !sessions.data?.length ? (
            <EmptyState icon={Lock} title="Nenhum caixa fechado ainda" description="O histórico de aberturas e fechamentos aparece aqui." className="py-10" />
          ) : (
            <DataTable head={<><th>Abertura</th><th>Fechamento</th><th>Esperado</th><th>Contado</th><th>Diferença</th></>}>
              {sessions.data.filter((s) => s.status === 'closed').map((s) => {
                const diff = Number(s.counted_amount ?? 0) - Number(s.expected_amount ?? 0)
                return (
                  <tr key={s.id}>
                    <td className="text-muted">{formatDateTime(s.opened_at)}</td>
                    <td className="text-muted">{formatDateTime(s.closed_at)}</td>
                    <td className="tabular">{formatCurrency(s.expected_amount)}</td>
                    <td className="tabular">{formatCurrency(s.counted_amount)}</td>
                    <td className={cn('tabular font-medium', Math.abs(diff) < 0.01 ? 'text-brand' : diff < 0 ? 'text-[#ff7a7a]' : 'text-warning')}>{formatCurrency(diff)}</td>
                  </tr>
                )
              })}
            </DataTable>
          )}
        </Card>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------
function OpenRegister() {
  const { ctx, canWrite } = useOrg()
  const summary = useCashSummary().data!
  const products = useProducts()
  const services = useServices()
  const checkout = useCheckout()
  const sales = useSessionSales(summary.session.id)
  const [search, setSearch] = React.useState('')
  const [cart, setCart] = React.useState<CartLine[]>([])
  const [customer, setCustomer] = React.useState<PickedCustomer | null>(null)
  const [discount, setDiscount] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [requestId, setRequestId] = React.useState(newRequestId)
  const [movement, setMovement] = React.useState<null | 'suprimento' | 'sangria'>(null)
  const [closing, setClosing] = React.useState(false)
  const searchRef = React.useRef<HTMLInputElement>(null)

  const subtotal = round2(cart.reduce((s, l) => s + (parseMoney(l.quantity) || 0) * (parseMoney(l.unit_price) || 0), 0))
  const disc = discount ? parseMoney(discount) : 0
  const total = round2(Math.max(0, subtotal - (disc || 0)))
  const pay = usePayments(total)

  const s = search.trim().toLowerCase()
  const catalog = [
    ...(services.data ?? []).map((x) => ({ type: 'service' as const, id: x.id, name: x.name, price: Number(x.price), extra: `${x.duration_minutes} min`, stock: null as number | null, sku: '' })),
    ...(products.data ?? []).map((x) => ({ type: 'product' as const, id: x.id, name: x.name, price: Number(x.price), extra: x.brand ?? '', stock: x.track_stock ? Number(x.stock_qty) : null, sku: x.sku ?? '' })),
  ].filter((x) => !s || x.name.toLowerCase().includes(s) || x.sku.toLowerCase() === s).slice(0, 40)

  const add = (item: (typeof catalog)[number]) => {
    setCart((c) => {
      const found = c.find((l) => l.id === item.id && l.type === item.type)
      if (found) return c.map((l) => (l === found ? { ...l, quantity: String((parseMoney(l.quantity) || 0) + 1) } : l))
      return [...c, { key: crypto.randomUUID(), type: item.type, id: item.id, name: item.name, quantity: '1', unit_price: moneyInput(item.price), stock: item.stock }]
    })
    setSearch('')
    searchRef.current?.focus()
  }
  const update = (key: string, patch: Partial<CartLine>) => setCart((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const lineInvalid = cart.some((l) => !(parseMoney(l.quantity) > 0) || !(parseMoney(l.unit_price) >= 0))
  const errors = {
    cart: !cart.length ? 'Adicione produtos ou serviços' : lineInvalid ? 'Verifique quantidade e preço' : total <= 0 ? 'O total precisa ser maior que zero' : undefined,
    discount: disc && (!(disc >= 0) || disc > subtotal) ? 'Desconto inválido' : undefined,
    pay: !pay.valid ? 'Ajuste o pagamento' : pay.hasFiado && !customer ? 'Fiado exige cliente' : pay.hasFiado && !pay.dueDate ? 'Informe o vencimento' : undefined,
  }
  const ready = canWrite && !Object.values(errors).some(Boolean)

  const finish = () => {
    if (!ready) return
    checkout.mutate({
      customer_id: customer?.id ?? null,
      items: cart.filter((l) => l.type === 'product').map((l) => ({ product_id: l.id, quantity: parseMoney(l.quantity), unit_price: parseMoney(l.unit_price), discount: 0 })),
      services: cart.filter((l) => l.type === 'service').map((l) => ({ service_id: l.id, quantity: parseMoney(l.quantity), unit_price: parseMoney(l.unit_price), discount: 0 })),
      discount: disc || 0,
      payments: pay.effective,
      notes,
      request_id: requestId,
      due_date: pay.dueDate,
    }, {
      onSuccess: () => {
        setCart([])
        setCustomer(null)
        setDiscount('')
        setNotes('')
        setRequestId(newRequestId())
        pay.reset()
        searchRef.current?.focus()
      },
    })
  }

  return (
    <>
      <PageHeader
        title="Caixa"
        description={`Aberto em ${formatDateTime(summary.session.opened_at)} · fundo de troco ${formatCurrency(summary.session.opening_amount)}`}
        actions={canWrite && (
          <>
            <Button variant="secondary" onClick={() => setMovement('suprimento')}><ArrowDownCircle /> Reforço</Button>
            <Button variant="secondary" onClick={() => setMovement('sangria')}><ArrowUpCircle /> Retirada</Button>
            <Button variant="danger" onClick={() => setClosing(true)}><Lock /> Fechar caixa</Button>
          </>
        )}
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <div className="space-y-4">
          <Card>
            <div className="border-b border-border p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
                <Input ref={searchRef} autoFocus placeholder="Buscar produto ou serviço (nome ou código)" className="pl-9" value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && catalog.length) { e.preventDefault(); add(catalog[0]) } }}
                  aria-label="Buscar produto ou serviço" />
              </div>
            </div>
            <div className="grid max-h-[420px] grid-cols-1 gap-2 overflow-y-auto p-4 sm:grid-cols-2 lg:grid-cols-3">
              {catalog.map((item) => (
                <button key={`${item.type}-${item.id}`} type="button" onClick={() => add(item)}
                  className="flex items-start gap-2.5 rounded-md border border-border bg-surface-2/40 p-3 text-left transition-colors hover:border-brand/40 hover:bg-surface-2">
                  {item.type === 'service' ? <Scissors className="mt-0.5 size-4 shrink-0 text-info" /> : <Package className="mt-0.5 size-4 shrink-0 text-brand" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{item.name}</span>
                    <span className="block text-xs text-muted">{formatCurrency(item.price)}{item.extra ? ` · ${item.extra}` : ''}</span>
                    {item.stock != null && <span className={cn('block text-[11px]', item.stock <= 0 ? 'text-danger' : 'text-subtle')}>Estoque: {formatNumber(item.stock)}</span>}
                  </span>
                </button>
              ))}
              {!catalog.length && <p className="col-span-full py-6 text-center text-sm text-subtle">Nenhum item encontrado.</p>}
            </div>
          </Card>
          <SessionCard />
        </div>

        <Card className="xl:sticky xl:top-4 xl:self-start">
          <CardHeader title="Venda atual" description={cart.length ? `${cart.length} item(ns)` : 'Clique nos itens para adicionar'} />
          <CardBody className="space-y-4">
            <Field label="Cliente" optional hint={customer ? 'A venda entra no histórico e nas previsões de recompra do cliente.' : 'Sem cliente = consumidor final.'}>
              <CustomerPicker value={customer} onChange={setCustomer} emptyLabel="Consumidor final" />
            </Field>
            {!cart.length ? (
              <div className="grid place-items-center rounded-md border border-dashed border-border py-8 text-sm text-subtle"><ShoppingCart className="mb-2 size-5" />Carrinho vazio</div>
            ) : (
              <div className="space-y-2">
                {cart.map((l) => (
                  <div key={l.key} className="rounded-md border border-border bg-bg/40 p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[13px] font-medium">{l.name}</span>
                      <button type="button" aria-label="Remover item" className="text-subtle hover:text-danger" onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))}><Trash2 className="size-4" /></button>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Button type="button" variant="secondary" size="icon-sm" aria-label="Menos" onClick={() => update(l.key, { quantity: String(Math.max(1, (parseMoney(l.quantity) || 1) - 1)) })}><Minus /></Button>
                      <Input aria-label="Quantidade" inputMode="decimal" className="h-8 w-16 text-center sm:h-8" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} />
                      <Button type="button" variant="secondary" size="icon-sm" aria-label="Mais" onClick={() => update(l.key, { quantity: String((parseMoney(l.quantity) || 0) + 1) })}><Plus /></Button>
                      <span className="text-xs text-subtle">×</span>
                      <Input aria-label="Preço unitário" inputMode="decimal" className="h-8 flex-1 sm:h-8" value={l.unit_price} onChange={(e) => update(l.key, { unit_price: e.target.value })} />
                      <span className="w-20 text-right text-[13px] font-medium tabular">{formatCurrency((parseMoney(l.quantity) || 0) * (parseMoney(l.unit_price) || 0))}</span>
                    </div>
                    {l.stock != null && parseMoney(l.quantity) > l.stock && <p className="mt-1 text-[11px] text-warning">Quantidade maior que o estoque ({formatNumber(l.stock)}).</p>}
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Desconto (R$)" htmlFor="pdisc" optional error={errors.discount}><Input id="pdisc" inputMode="decimal" placeholder="0,00" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>
              <div className="flex flex-col justify-end">
                <div className="rounded-md border border-border bg-surface-2/50 px-3 py-1.5 text-right">
                  <div className="text-[11px] text-subtle">Subtotal {formatCurrency(subtotal)}</div>
                  <div className="text-lg font-semibold tabular">{formatCurrency(total)}</div>
                </div>
              </div>
            </div>
            {total > 0 && <Field label="Pagamento" error={cart.length ? errors.pay : undefined}><PaymentEditor total={total} state={pay} minDueDate={ctx.today} /></Field>}
            <Field label="Observação" htmlFor="pnote" optional><Textarea id="pnote" rows={1} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <Button className="w-full" size="lg" loading={checkout.isPending} disabled={!ready} onClick={finish}>
              <Receipt /> Finalizar venda · {formatCurrency(total)}
            </Button>
            {cart.length > 0 && errors.cart && <p className="text-center text-xs text-danger">{errors.cart}</p>}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Vendas deste caixa" description="Emita a nota fiscal da venda se a integração estiver configurada." />
        {sales.isLoading ? <TableSkeleton rows={3} /> : !sales.data?.length ? (
          <EmptyState icon={Receipt} title="Nenhuma venda ainda" description="As vendas finalizadas aparecem aqui." className="py-8" />
        ) : (
          <DataTable head={<><th>Hora</th><th>Cliente</th><th>Itens</th><th>Total</th><th className="w-56">Nota fiscal</th></>}>
            {sales.data.map((p) => (
              <tr key={p.id}>
                <td className="whitespace-nowrap text-muted">{formatDateTime(p.created_at)}</td>
                <td>{p.customers?.full_name ?? <span className="text-muted">Consumidor final</span>}</td>
                <td className="text-muted">
                  {[...(p.purchase_items ?? []).map((i) => `${formatNumber(i.quantity)}× ${i.products?.name}`), ...(p.purchase_services ?? []).map((x) => `${formatNumber(x.quantity)}× ${x.description}`)].join(', ')}
                </td>
                <td className="tabular font-medium">{formatCurrency(p.total)}</td>
                <td><InvoiceActions purchase={p} /></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      <MovementDialog kind={movement} onClose={() => setMovement(null)} />
      <CloseDialog open={closing} onOpenChange={setClosing} />
    </>
  )
}

function SessionCard() {
  const summary = useCashSummary().data
  if (!summary) return null
  const methods = Object.entries(summary.by_method) as [PaymentMethod, number][]
  return (
    <Card>
      <CardHeader title="Resumo do caixa" />
      <CardBody className="grid gap-4 sm:grid-cols-3">
        <div><div className="text-xs text-subtle">Vendas</div><div className="text-lg font-semibold tabular">{summary.sales_count} · {formatCurrency(summary.sales_total)}</div></div>
        <div><div className="text-xs text-subtle">Dinheiro esperado na gaveta</div><div className="text-lg font-semibold tabular text-brand">{formatCurrency(summary.expected_cash)}</div></div>
        <div className="space-y-1">
          {methods.length ? methods.map(([m, v]) => (
            <div key={m} className="flex justify-between text-[13px]"><span className="text-muted">{PAYMENT_METHOD[m]}</span><span className="tabular">{formatCurrency(v)}</span></div>
          )) : <span className="text-[13px] text-subtle">Sem recebimentos ainda</span>}
        </div>
        {!!summary.movements.length && (
          <div className="sm:col-span-3 flex flex-wrap gap-2">
            {summary.movements.map((m) => (
              <Badge key={m.id} tone={m.kind === 'sangria' ? 'warning' : 'info'}>{m.kind === 'sangria' ? 'Retirada' : 'Reforço'} {formatCurrency(m.amount)}{m.notes ? ` · ${m.notes}` : ''}</Badge>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function MovementDialog({ kind, onClose }: { kind: null | 'suprimento' | 'sangria'; onClose: () => void }) {
  const mv = useCashMovement()
  const [amount, setAmount] = React.useState('')
  const [notes, setNotes] = React.useState('')
  React.useEffect(() => { setAmount(''); setNotes('') }, [kind])
  if (!kind) return null
  const value = parseMoney(amount)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="sm" title={kind === 'sangria' ? 'Retirada de dinheiro (sangria)' : 'Reforço de troco (suprimento)'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={mv.isPending} disabled={!(value > 0)} onClick={() => mv.mutate({ kind, amount: value, notes }, { onSuccess: onClose })}>Registrar</Button></>}>
      <div className="space-y-4">
        <Field label="Valor (R$)" htmlFor="mv-a"><Input id="mv-a" autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Motivo" htmlFor="mv-n" optional><Input id="mv-n" maxLength={300} placeholder={kind === 'sangria' ? 'Ex.: depósito no banco' : 'Ex.: troco extra'} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Dialog>
  )
}

function CloseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const summary = useCashSummary().data
  const close = useCloseCash()
  const [counted, setCounted] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [result, setResult] = React.useState<{ expected: number; counted: number; difference: number } | null>(null)
  React.useEffect(() => { if (open) { setCounted(''); setNotes(''); setResult(null) } }, [open])
  const value = parseMoney(counted)
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm" title="Fechar caixa"
      footer={result ? <Button onClick={() => onOpenChange(false)}>Concluir</Button> : (
        <><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="danger" loading={close.isPending} disabled={!(value >= 0)} onClick={() => close.mutate({ counted: value, notes }, { onSuccess: setResult })}>Fechar caixa</Button></>
      )}>
      {result ? (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted">Esperado</span><span className="tabular">{formatCurrency(result.expected)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Contado</span><span className="tabular">{formatCurrency(result.counted)}</span></div>
          <div className={cn('flex justify-between font-semibold', Math.abs(result.difference) < 0.01 ? 'text-brand' : 'text-warning')}>
            <span>{Math.abs(result.difference) < 0.01 ? 'Caixa conferido' : result.difference < 0 ? 'Falta' : 'Sobra'}</span><span className="tabular">{formatCurrency(result.difference)}</span>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">Conte o dinheiro da gaveta. O sistema compara com o esperado: <strong className="text-fg">{formatCurrency(summary?.expected_cash)}</strong>.</p>
          <Field label="Dinheiro contado (R$)" htmlFor="cl-c"><Input id="cl-c" autoFocus inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} /></Field>
          <Field label="Observação" htmlFor="cl-n" optional><Input id="cl-n" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
      )}
    </Dialog>
  )
}

