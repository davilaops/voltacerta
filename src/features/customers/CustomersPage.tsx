import * as React from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronRight, MessageCircle, Search, UserPlus, Users } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { DataTable, EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/ui/states'
import { SituationBadge } from '@/components/shared/badges'
import { CustomerDialog } from '@/components/shared/CustomerDialog'
import { ContactDialog, type ContactTarget } from '@/components/shared/ContactDialog'
import { Pagination } from '@/components/shared/Pagination'
import { PAGE_SIZE, useCustomers } from './api'
import { useOrg } from '@/features/org/OrgProvider'
import { SITUATION } from '@/domain/labels'
import { formatDate, formatPhone } from '@/lib/format'
import { useDebounce } from '@/lib/useDebounce'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import type { CustomerSituation, CustomerView } from '@/types/models'

export function CustomersPage() {
  useDocumentTitle('Clientes')
  const { ctx } = useOrg()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = React.useState('')
  const [situation, setSituation] = React.useState<CustomerSituation | 'all'>('all')
  const [page, setPage] = React.useState(0)
  const [createOpen, setCreateOpen] = React.useState(params.get('novo') === '1')
  const [contact, setContact] = React.useState<ContactTarget | null>(null)
  const debounced = useDebounce(search)
  const q = useCustomers({ search: debounced, situation, page })

  React.useEffect(() => setPage(0), [debounced, situation])
  React.useEffect(() => {
    if (params.get('novo')) setParams({}, { replace: true })
  }, [params, setParams])

  const atLimit = ctx.customer_limit != null && ctx.customer_count >= ctx.customer_limit
  const filtered = debounced || situation !== 'all'

  const toContact = (c: CustomerView): ContactTarget => ({
    customerId: c.id,
    customerName: c.full_name,
    phone: c.phone,
    doNotContact: c.do_not_contact,
    productName: c.last_product_name,
    petName: c.pet_names.split(',')[0] || null,
    overdue: c.situation === 'precisa_contato' || c.situation === 'inativo',
  })

  return (
    <>
      <PageHeader
        title="Clientes"
        description={ctx.customer_limit ? `${ctx.customer_count} de ${ctx.customer_limit} clientes do seu plano` : `${ctx.customer_count} clientes`}
        actions={
          <Button onClick={() => (atLimit ? navigate('/app/plano') : setCreateOpen(true))}>
            <UserPlus /> {atLimit ? 'Limite atingido · ver planos' : 'Novo cliente'}
          </Button>
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input placeholder="Buscar por nome ou telefone" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar clientes" />
          </div>
          <div className="sm:w-56">
            <Select value={situation} onChange={(e) => setSituation(e.target.value as CustomerSituation | 'all')} aria-label="Filtrar por situação">
              <option value="all">Todas as situações</option>
              {Object.entries(SITUATION).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </Select>
          </div>
        </div>

        {q.isLoading ? (
          <TableSkeleton />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.rows.length ? (
          filtered ? (
            <EmptyState icon={Search} title="Nenhum cliente encontrado" description="Tente outro termo de busca ou remova os filtros." />
          ) : (
            <EmptyState
              icon={Users}
              title="Você ainda não possui clientes cadastrados."
              description="Cadastre seu primeiro cliente para começar a identificar oportunidades de recompra."
              action={<Button onClick={() => setCreateOpen(true)}><UserPlus /> Cadastrar cliente</Button>}
            />
          )
        ) : (
          <>
            <DataTable
              head={
                <>
                  <th>Cliente</th>
                  <th>Pets</th>
                  <th>Última compra</th>
                  <th>Próxima recompra</th>
                  <th>Situação</th>
                  <th className="w-24" />
                </>
              }
              mobile={q.data.rows.map((c) => (
                <Link key={c.id} to={`/app/clientes/${c.id}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c.full_name}</div>
                    <div className="mt-0.5 truncate text-xs text-muted">{formatPhone(c.phone)}{c.pet_names && ` · ${c.pet_names}`}</div>
                    <div className="mt-2"><SituationBadge situation={c.situation} /></div>
                  </div>
                  <ChevronRight className="size-4 text-subtle" />
                </Link>
              ))}
            >
              {q.data.rows.map((c) => (
                <tr key={c.id} className="cursor-pointer" onClick={() => navigate(`/app/clientes/${c.id}`)}>
                  <td>
                    <div className="font-medium text-fg">{c.full_name}</div>
                    <div className="text-xs text-muted">{formatPhone(c.phone)}</div>
                  </td>
                  <td className="max-w-40 truncate text-muted">{c.pet_names || '—'}</td>
                  <td>
                    <div className="tabular">{formatDate(c.last_purchase_date)}</div>
                    <div className="max-w-48 truncate text-xs text-muted">{c.last_product_name ?? ''}</div>
                  </td>
                  <td className="tabular">{formatDate(c.next_expected_date)}</td>
                  <td><SituationBadge situation={c.situation} /></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Button variant="whatsapp" size="icon-sm" aria-label={`WhatsApp de ${c.full_name}`} disabled={!c.phone} onClick={() => setContact(toContact(c))}>
                      <MessageCircle />
                    </Button>
                  </td>
                </tr>
              ))}
            </DataTable>
            <Pagination page={page} pageSize={PAGE_SIZE} total={q.data.count} onPage={setPage} />
          </>
        )}
      </Card>

      <CustomerDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={(c) => navigate(`/app/clientes/${c.id}`)} />
      <ContactDialog target={contact} onClose={() => setContact(null)} />
    </>
  )
}
