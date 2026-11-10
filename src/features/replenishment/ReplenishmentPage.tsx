import * as React from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownUp, EyeOff, MessageCircle, RefreshCcw, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/menu'
import { DataTable, EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/ui/states'
import { StageBadge } from '@/components/shared/badges'
import { ContactDialog, type ContactTarget } from '@/components/shared/ContactDialog'
import { TAB_STAGES, usePredictions, useSetPredictionStatus, type PredictionFilters, type StageTab } from './api'
import { useProducts } from '@/features/products/api'
import { useCustomerSearch } from '@/features/customers/api'
import { CATEGORY } from '@/domain/labels'
import { formatCurrency, formatDate, formatNumber, formatRelativeDays } from '@/lib/format'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import type { PredictionView, ProductCategory } from '@/types/models'

const TABS: { value: StageTab; label: string }[] = [
  { value: 'todas', label: 'Todas' },
  { value: 'proximas', label: 'Próximas' },
  { value: 'hoje', label: 'Para hoje' },
  { value: 'atrasadas', label: 'Atrasadas' },
  { value: 'contatadas', label: 'Contatadas' },
  { value: 'concluidas', label: 'Concluídas' },
]

export function ReplenishmentPage() {
  useDocumentTitle('Recompras')
  const [tab, setTab] = React.useState<StageTab>('todas')
  const [filters, setFilters] = React.useState<PredictionFilters>({ sort: 'expected_date', ascending: true, category: '' })
  const [customerSearch, setCustomerSearch] = React.useState('')
  const customers = useCustomerSearch(customerSearch)
  const products = useProducts({ includeInactive: true })
  const q = usePredictions(filters)
  const setStatus = useSetPredictionStatus()
  const [contact, setContact] = React.useState<ContactTarget | null>(null)

  const counts = Object.fromEntries(TABS.map((t) => [t.value, (q.data ?? []).filter((p) => TAB_STAGES[t.value].includes(p.stage)).length])) as Record<StageTab, number>
  const rows = (q.data ?? []).filter((p) => TAB_STAGES[tab].includes(p.stage))
  const potential = rows.reduce((s, p) => s + Number(p.potential_value), 0)
  const hasFilters = !!(filters.from || filters.to || filters.productId || filters.category || filters.customerId)

  const toggleSort = (sort: PredictionFilters['sort']) =>
    setFilters((f) => ({ ...f, sort, ascending: f.sort === sort ? !f.ascending : sort === 'expected_date' }))

  const open = (p: PredictionView) =>
    setContact({
      customerId: p.customer_id,
      customerName: p.customer_name,
      phone: p.customer_phone,
      doNotContact: p.customer_do_not_contact,
      predictionId: p.id,
      productName: p.product_name,
      petName: p.pet_name,
      overdue: p.stage === 'atrasada',
    })

  const rowActions = (p: PredictionView) =>
    p.stage === 'concluida' ? (
      <span className="text-xs text-muted">{p.recovered ? `Recuperada · ${formatCurrency(p.recovered_amount)}` : 'Recompra espontânea'}</span>
    ) : (
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="icon-sm" aria-label="Ignorar oportunidade" title="Ignorar" onClick={() => setStatus.mutate({ id: p.id, status: 'ignored' })}>
          <EyeOff />
        </Button>
        <Button variant="whatsapp" size="sm" onClick={() => open(p)} disabled={!p.customer_phone}>
          <MessageCircle /> Contatar
        </Button>
      </div>
    )

  return (
    <>
      <PageHeader title="Central de recompras" description="Oportunidades de recompra calculadas automaticamente a partir das compras." />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Input type="date" aria-label="Previsão a partir de" value={filters.from ?? ''} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value || undefined }))} />
          <Input type="date" aria-label="Previsão até" value={filters.to ?? ''} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value || undefined }))} />
          <Select aria-label="Produto" value={filters.productId ?? ''} onChange={(e) => setFilters((f) => ({ ...f, productId: e.target.value || undefined }))}>
            <option value="">Todos os produtos</option>
            {products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select aria-label="Categoria" value={filters.category ?? ''} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value as ProductCategory | '' }))}>
            <option value="">Todas as categorias</option>
            {Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <div className="relative">
            <Input list="customer-options" placeholder="Cliente" aria-label="Cliente" value={customerSearch} onChange={(e) => {
              setCustomerSearch(e.target.value)
              const match = customers.data?.find((c) => c.full_name === e.target.value)
              setFilters((f) => ({ ...f, customerId: match?.id }))
            }} />
            <datalist id="customer-options">
              {customers.data?.map((c) => <option key={c.id} value={c.full_name} />)}
            </datalist>
          </div>
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="mt-3" onClick={() => { setFilters((f) => ({ sort: f.sort, ascending: f.ascending, category: '' })); setCustomerSearch('') }}>
            <X /> Limpar filtros
          </Button>
        )}
      </Card>

      <Card>
        <Tabs value={tab} onValueChange={(v) => setTab(v as StageTab)}>
          <TabsList className="px-3 pt-1">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} count={q.data ? counts[t.value] : undefined}>{t.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-2.5 text-[13px] text-muted">
          <span>Valor potencial: <strong className="tabular text-fg">{formatCurrency(potential)}</strong> <span className="text-subtle">(estimativa, não é receita)</span></span>
          <div className="flex gap-1">
            <Button variant={filters.sort === 'expected_date' ? 'secondary' : 'ghost'} size="sm" onClick={() => toggleSort('expected_date')}><ArrowDownUp /> Data prevista</Button>
            <Button variant={filters.sort === 'potential_value' ? 'secondary' : 'ghost'} size="sm" onClick={() => toggleSort('potential_value')}><ArrowDownUp /> Valor potencial</Button>
          </div>
        </div>
        {q.isLoading ? (
          <TableSkeleton />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !rows.length ? (
          <EmptyState
            icon={RefreshCcw}
            title={q.data?.length ? 'Nada nesta aba' : 'Nenhuma oportunidade de recompra ainda'}
            description={q.data?.length ? 'Não há oportunidades com este status e filtros.' : 'As oportunidades aparecem automaticamente quando você registra compras.'}
            action={!q.data?.length ? <Button asChild><Link to="/app/compras">Registrar compras</Link></Button> : undefined}
          />
        ) : (
          <DataTable
            head={<><th>Cliente</th><th>Produto</th><th>Última compra</th><th>Previsão</th><th>Qtd.</th><th>Potencial</th><th>Status</th><th className="text-right">Ações</th></>}
            mobile={rows.map((p) => (
              <div key={p.id} className="px-4 py-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/app/clientes/${p.customer_id}`} className="block truncate text-sm font-medium">{p.customer_name}</Link>
                    <div className="truncate text-xs text-muted">{p.product_name}{p.pet_name && ` · ${p.pet_name}`}</div>
                  </div>
                  <StageBadge stage={p.stage} />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-muted">
                  <span>{formatDate(p.expected_date)} · {formatCurrency(p.potential_value)}</span>
                  {rowActions(p)}
                </div>
              </div>
            ))}
          >
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link to={`/app/clientes/${p.customer_id}`} className="font-medium hover:text-brand">{p.customer_name}</Link>
                  <div className="text-xs text-muted">{p.pet_name ?? '—'}</div>
                </td>
                <td>
                  <div>{p.product_name}</div>
                  <div className="text-xs text-muted">{CATEGORY[p.product_category]}</div>
                </td>
                <td className="tabular text-muted">{formatDate(p.last_purchase_date)}</td>
                <td>
                  <div className="tabular">{formatDate(p.expected_date)}</div>
                  {p.status === 'open' && <div className="text-xs text-muted">{formatRelativeDays(p.days_until)}</div>}
                </td>
                <td className="tabular">{formatNumber(p.quantity)}</td>
                <td className="tabular">{formatCurrency(p.potential_value)}</td>
                <td><StageBadge stage={p.stage} /></td>
                <td className="text-right">{rowActions(p)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
      <ContactDialog target={contact} onClose={() => setContact(null)} />
    </>
  )
}
