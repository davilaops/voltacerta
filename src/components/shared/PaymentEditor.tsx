import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/input'
import { PAYMENT_METHOD } from '@/domain/labels'
import { formatCurrency } from '@/lib/format'
import { moneyInput, parseMoney, round2 } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { PaymentInput } from '@/types/models'

type Method = PaymentInput['method']
export interface PaymentLine {
  key: string
  method: Method
  amount: string
}

const METHODS: Method[] = ['pix', 'dinheiro', 'cartao_debito', 'cartao_credito', 'fiado', 'transferencia', 'boleto', 'outro']

export const newPaymentLine = (method: Method = 'pix', amount = ''): PaymentLine => ({ key: crypto.randomUUID(), method, amount })

/** Estado do editor de pagamentos + validação contra o total. */
export function usePayments(total: number) {
  const [lines, setLines] = React.useState<PaymentLine[]>([newPaymentLine('pix')])
  const [received, setReceived] = React.useState('') // valor entregue em dinheiro (troco)
  const [dueDate, setDueDate] = React.useState('')

  const sum = round2(lines.reduce((s, l) => s + (parseMoney(l.amount) || 0), 0))
  // Uma única forma de pagamento acompanha o total automaticamente
  const single = lines.length === 1
  const effective: PaymentInput[] = single
    ? [{ method: lines[0].method, amount: round2(total) }]
    : lines.map((l) => ({ method: l.method, amount: round2(parseMoney(l.amount) || 0) }))
  const paid = single ? round2(total) : sum
  const remaining = round2(total - paid)
  const hasFiado = effective.some((p) => p.method === 'fiado')
  const cash = effective.filter((p) => p.method === 'dinheiro').reduce((s, p) => s + p.amount, 0)
  const change = cash > 0 && parseMoney(received) > cash ? round2(parseMoney(received) - cash) : 0
  const valid = total <= 0 || (Math.abs(remaining) < 0.005 && effective.every((p) => p.amount > 0))

  const reset = React.useCallback((method: Method = 'pix') => {
    setLines([newPaymentLine(method)])
    setReceived('')
    setDueDate('')
  }, [])

  return { lines, setLines, effective, remaining, valid, hasFiado, change, received, setReceived, dueDate, setDueDate, reset, single }
}

export function PaymentEditor({ total, state, minDueDate, allowFiado = true }: { total: number; state: ReturnType<typeof usePayments>; minDueDate: string; allowFiado?: boolean }) {
  const { lines, setLines, remaining, single, hasFiado, change, received, setReceived, dueDate, setDueDate } = state
  const methods = METHODS.filter((m) => allowFiado || m !== 'fiado')
  const update = (key: string, patch: Partial<PaymentLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const split = () =>
    setLines((ls) => {
      if (ls.length === 1) return [{ ...ls[0], amount: moneyInput(total) }, newPaymentLine('dinheiro', '')]
      return [...ls, newPaymentLine('dinheiro', moneyInput(Math.max(0, remaining)))]
    })
  const isCash = lines.some((l) => l.method === 'dinheiro')

  return (
    <div className="space-y-2">
      {lines.map((l) => (
        <div key={l.key} className="grid grid-cols-[1fr_120px_36px] gap-2">
          <Select aria-label="Forma de pagamento" value={l.method} onChange={(e) => update(l.key, { method: e.target.value as Method })}>
            {methods.map((m) => <option key={m} value={m}>{PAYMENT_METHOD[m]}</option>)}
          </Select>
          {single ? (
            <div className="flex h-10 items-center justify-end rounded-md border border-border bg-surface-2/50 px-3 text-sm tabular sm:h-9">{formatCurrency(total)}</div>
          ) : (
            <Input aria-label="Valor" inputMode="decimal" placeholder="0,00" value={l.amount} onChange={(e) => update(l.key, { amount: e.target.value })} />
          )}
          <Button type="button" variant="ghost" size="icon" aria-label="Remover forma de pagamento" disabled={lines.length === 1}
            onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={split} disabled={lines.length >= 5}>
          <Plus /> Dividir pagamento
        </Button>
        {!single && (
          <span className={cn('text-xs tabular', Math.abs(remaining) < 0.005 ? 'text-brand' : 'text-warning')}>
            {Math.abs(remaining) < 0.005 ? 'Pagamento completo' : remaining > 0 ? `Faltam ${formatCurrency(remaining)}` : `Excede em ${formatCurrency(-remaining)}`}
          </span>
        )}
      </div>
      {isCash && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Valor recebido em dinheiro" htmlFor="received" optional>
            <Input id="received" inputMode="decimal" placeholder="0,00" value={received} onChange={(e) => setReceived(e.target.value)} />
          </Field>
          <div className="flex flex-col justify-end">
            <div className="flex h-10 items-center justify-between rounded-md border border-border bg-surface-2/50 px-3 text-sm sm:h-9">
              <span className="text-muted">Troco</span>
              <span className="font-semibold tabular">{formatCurrency(change)}</span>
            </div>
          </div>
        </div>
      )}
      {hasFiado && (
        <Field label="Vencimento do fiado" htmlFor="due" hint="Fica em Financeiro → Contas a receber até ser pago.">
          <Input id="due" type="date" min={minDueDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      )}
    </div>
  )
}
