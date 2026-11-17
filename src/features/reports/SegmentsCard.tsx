import * as React from 'react'
import { Link } from 'react-router-dom'
import { Download, Users } from 'lucide-react'
import { Badge, Card, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DataTable, EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states'
import { useCustomerSegments } from '@/features/reminders/api'
import { SEGMENT } from '@/domain/labels'
import { downloadFile, toCsv } from '@/lib/csv'
import { formatCurrency, formatPhone } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Segment } from '@/types/models'

const ORDER: Segment[] = ['campeao', 'fiel', 'novo', 'ocasional', 'em_risco', 'perdido', 'sem_compras']

/** Segmentação da base por recência, frequência e valor (últimos 12 meses). */
export function SegmentsCard() {
  const q = useCustomerSegments()
  const [seg, setSeg] = React.useState<Segment>('em_risco')
  const rows = (q.data?.customers ?? []).filter((c) => c.segment === seg)
  const exportCsv = () =>
    downloadFile(`voltacerta-segmento-${seg}.csv`, toCsv(rows, [
      { key: 'name', label: 'Cliente' },
      { key: 'phone', label: 'Telefone' },
      { key: 'recency', label: 'Dias sem comprar' },
      { key: 'frequency', label: 'Compras (12 meses)' },
      { key: 'monetary', label: 'Gasto (12 meses)', format: (v) => String(v ?? '').replace('.', ',') },
    ]))
  return (
    <Card className="mt-4">
      <CardHeader title="Segmentos de clientes" description="Quem são seus melhores clientes, quem está esfriando e quem já foi embora — para agir antes de perder a venda." />
      {q.isLoading ? <TableSkeleton rows={4} /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.customers.length ? (
        <EmptyState icon={Users} title="Sem clientes ainda" description="Cadastre clientes e registre compras para ver os segmentos." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 px-5 pb-4 sm:grid-cols-4 lg:grid-cols-7">
            {ORDER.map((k) => {
              const s = q.data!.summary[k]
              return (
                <button key={k} type="button" onClick={() => setSeg(k)} title={SEGMENT[k].hint}
                  className={cn('rounded-md border p-3 text-left transition-colors', seg === k ? 'border-brand/40 bg-brand/5' : 'border-border hover:border-border-strong')}>
                  <Badge tone={SEGMENT[k].tone} className="h-5 px-2 text-[11px]">{SEGMENT[k].label}</Badge>
                  <div className="mt-2 text-lg font-semibold tabular">{s?.count ?? 0}</div>
                  <div className="text-[11px] text-subtle">{formatCurrency(s?.revenue ?? 0)} no ano</div>
                </button>
              )
            })}
          </div>
          <div className="flex items-center justify-between border-t border-border px-5 py-3">
            <span className="text-[13px] text-muted">{SEGMENT[seg].hint}</span>
            <Button variant="secondary" size="sm" disabled={!rows.length} onClick={exportCsv}><Download /> Exportar CSV</Button>
          </div>
          {!rows.length ? <p className="px-5 pb-6 text-sm text-subtle">Nenhum cliente neste segmento.</p> : (
            <DataTable head={<><th>Cliente</th><th>Telefone</th><th className="text-right">Dias sem comprar</th><th className="text-right">Compras (12m)</th><th className="text-right">Gasto (12m)</th><th className="text-right">Ticket médio</th></>}>
              {rows.slice(0, 200).map((c) => (
                <tr key={c.id}>
                  <td><Link to={`/app/clientes/${c.id}`} className="font-medium hover:text-brand">{c.name}</Link>{c.do_not_contact && <span className="ml-2 text-xs text-danger">não contatar</span>}</td>
                  <td className="text-muted">{formatPhone(c.phone)}</td>
                  <td className="text-right tabular">{c.recency ?? '—'}</td>
                  <td className="text-right tabular">{c.frequency}</td>
                  <td className="text-right tabular">{formatCurrency(c.monetary)}</td>
                  <td className="text-right tabular">{c.avg_ticket != null ? formatCurrency(c.avg_ticket) : '—'}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </>
      )}
    </Card>
  )
}
