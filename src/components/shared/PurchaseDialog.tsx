import * as React from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { useCustomerSearch } from '@/features/customers/api'
import { useProducts } from '@/features/products/api'
import { useCreatePurchase } from '@/features/purchases/api'
import { useOrg } from '@/features/org/OrgProvider'
import { formatCurrency, formatPhone } from '@/lib/format'
import { newRequestId, cn } from '@/lib/utils'

interface Line {
  key: string
  product_id: string
  quantity: string
  unit_price: string
  discount: string
}

const num = (v: string) => Number(String(v).replace(',', '.'))
const emptyLine = (): Line => ({ key: crypto.randomUUID(), product_id: '', quantity: '1', unit_price: '', discount: '' })

export function PurchaseDialog({
  open,
  onOpenChange,
  customer,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  customer?: { id: string; full_name: string } | null
}) {
  const { ctx, canWrite } = useOrg()
  const products = useProducts()
  const create = useCreatePurchase()
  const [customerSel, setCustomerSel] = React.useState<{ id: string; full_name: string } | null>(customer ?? null)
  const [search, setSearch] = React.useState('')
  const customers = useCustomerSearch(search)
  const [date, setDate] = React.useState(ctx.today)
  const [lines, setLines] = React.useState<Line[]>([emptyLine()])
  const [discount, setDiscount] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [requestId, setRequestId] = React.useState(newRequestId)
  const [submitted, setSubmitted] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setCustomerSel(customer ?? null)
      setSearch('')
      setDate(ctx.today)
      setLines([emptyLine()])
      setDiscount('')
      setNotes('')
      setRequestId(newRequestId())
      setSubmitted(false)
    }
  }, [open, customer, ctx.today])

  const productMap = new Map((products.data ?? []).map((p) => [p.id, p]))
  const lineTotal = (l: Line) => Math.max(0, num(l.quantity || '0') * num(l.unit_price || '0') - num(l.discount || '0'))
  const subtotal = lines.reduce((s, l) => s + (l.product_id ? lineTotal(l) : 0), 0)
  const total = Math.max(0, subtotal - num(discount || '0'))

  const update = (key: string, patch: Partial<Line>) =>
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l
        const next = { ...l, ...patch }
        if (patch.product_id) next.unit_price = String(productMap.get(patch.product_id)?.price ?? '')
        return next
      }),
    )

  const validLines = lines.filter((l) => l.product_id)
  const lineErrors = validLines.some((l) => !(num(l.quantity) > 0) || !(num(l.unit_price) >= 0) || num(l.discount || '0') > num(l.quantity) * num(l.unit_price))
  const errors = {
    customer: !customerSel ? 'Selecione o cliente' : undefined,
    items: validLines.length === 0 ? 'Adicione ao menos um produto' : lineErrors ? 'Verifique quantidade, preço e desconto dos itens' : undefined,
    date: !date || date > ctx.today ? 'A data não pode ser futura' : undefined,
    discount: num(discount || '0') > subtotal ? 'Desconto maior que o subtotal' : undefined,
  }
  const hasErrors = Object.values(errors).some(Boolean)

  const submit = () => {
    setSubmitted(true)
    if (hasErrors || !customerSel) return
    create.mutate(
      {
        customer_id: customerSel.id,
        purchase_date: date,
        items: validLines.map((l) => ({
          product_id: l.product_id,
          quantity: num(l.quantity),
          unit_price: num(l.unit_price),
          discount: num(l.discount || '0'),
        })),
        discount: num(discount || '0'),
        notes,
        request_id: requestId,
      },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  const noProducts = products.data && products.data.length === 0

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Registrar compra"
      description="A previsão de recompra é calculada automaticamente para cada produto."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={create.isPending} disabled={!canWrite || !!noProducts}>
            Registrar compra · {formatCurrency(total)}
          </Button>
        </>
      }
    >
      {noProducts ? (
        <div className="py-6 text-center text-sm text-muted">
          Cadastre ao menos um produto antes de registrar compras.{' '}
          <Link to="/app/produtos" className="text-brand hover:underline" onClick={() => onOpenChange(false)}>
            Ir para produtos
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <Field label="Cliente" error={submitted ? errors.customer : undefined}>
              {customerSel ? (
                <div className="flex h-10 items-center justify-between rounded-md border border-border bg-surface-2/60 px-3 text-sm sm:h-9">
                  <span className="truncate font-medium">{customerSel.full_name}</span>
                  {!customer && (
                    <button type="button" className="text-[13px] text-brand hover:underline" onClick={() => setCustomerSel(null)}>
                      Trocar
                    </button>
                  )}
                </div>
              ) : (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
                  <Input autoFocus placeholder="Buscar por nome ou telefone" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
                  <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-surface">
                    {customers.isLoading && <div className="px-3 py-2 text-[13px] text-subtle">Buscando…</div>}
                    {customers.data?.length === 0 && <div className="px-3 py-2 text-[13px] text-subtle">Nenhum cliente encontrado.</div>}
                    {customers.data?.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setCustomerSel(c)}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface-2"
                      >
                        <span>{c.full_name}</span>
                        <span className="text-xs text-subtle">{c.phone ? formatPhone(c.phone) : ''}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Field>
            <Field label="Data da compra" htmlFor="pdate" error={submitted ? errors.date : undefined}>
              <Input id="pdate" type="date" value={date} max={ctx.today} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[13px] font-medium">Itens</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setLines((l) => [...l, emptyLine()])}>
                <Plus /> Adicionar item
              </Button>
            </div>
            <div className="space-y-2">
              {lines.map((l) => (
                <div key={l.key} className="grid grid-cols-2 gap-2 rounded-md border border-border bg-bg/40 p-2.5 sm:grid-cols-[1fr_80px_110px_100px_36px] sm:items-end">
                  <div className="col-span-2 sm:col-span-1">
                    <Select aria-label="Produto" value={l.product_id} onChange={(e) => update(l.key, { product_id: e.target.value })}>
                      <option value="">Selecione o produto</option>
                      {products.data?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Input aria-label="Quantidade" inputMode="decimal" placeholder="Qtd." value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} />
                  <Input aria-label="Preço unitário" inputMode="decimal" placeholder="Preço" value={l.unit_price} onChange={(e) => update(l.key, { unit_price: e.target.value })} />
                  <Input aria-label="Desconto do item" inputMode="decimal" placeholder="Desconto" value={l.discount} onChange={(e) => update(l.key, { discount: e.target.value })} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remover item"
                    disabled={lines.length === 1}
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  >
                    <Trash2 />
                  </Button>
                  {l.product_id && (
                    <div className="col-span-2 flex justify-between text-xs text-subtle sm:col-span-5">
                      <span>
                        Duração estimada: {productMap.get(l.product_id)?.avg_duration_days ?? 'padrão'} dias por unidade
                      </span>
                      <span className="tabular text-fg/80">{formatCurrency(lineTotal(l))}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {submitted && errors.items && <p className="mt-1.5 text-xs text-danger">{errors.items}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <Field label="Observação" htmlFor="pnotes" optional>
              <Textarea id="pnotes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <div className="space-y-3">
              <Field label="Desconto geral" htmlFor="pdisc" optional error={errors.discount}>
                <Input id="pdisc" inputMode="decimal" placeholder="0,00" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </Field>
              <div className="rounded-md border border-border bg-surface-2/50 px-3 py-2 text-sm">
                <div className="flex justify-between text-muted">
                  <span>Subtotal</span>
                  <span className="tabular">{formatCurrency(subtotal)}</span>
                </div>
                <div className={cn('mt-1 flex justify-between font-semibold')}>
                  <span>Total</span>
                  <span className="tabular">{formatCurrency(total)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  )
}
