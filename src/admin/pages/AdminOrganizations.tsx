import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, ChevronRight, Search, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { DataTable, EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/ui/states'
import { Pagination } from '@/components/shared/Pagination'
import { ADMIN_PAGE, useAdminOrganizations } from '../api'
import { DeleteOrgDialog, ORG_STATUS_FILTERS, OrgStatusBadge, type OrgRef } from '../components'
import { PLAN_NAME } from '@/domain/labels'
import { formatDate, formatNumber } from '@/lib/format'
import { useDebounce } from '@/lib/useDebounce'
import { useDocumentTitle } from '@/lib/useDocumentTitle'


export function AdminOrganizations() {
  useDocumentTitle('Admin · Estabelecimentos')
  const navigate = useNavigate()
  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [page, setPage] = React.useState(0)
  const debounced = useDebounce(search)
  const q = useAdminOrganizations(debounced, status, page)
  const [deleteOrg, setDeleteOrg] = React.useState<OrgRef>(null)
  React.useEffect(() => setPage(0), [debounced, status])

  return (
    <>
      <PageHeader title="Estabelecimentos" description={q.data ? `${q.data.total} estabelecimento(s)` : undefined} />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input className="pl-9" placeholder="Buscar por nome, cidade ou e-mail do proprietário" aria-label="Buscar estabelecimentos" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="sm:w-52">
            <Select aria-label="Filtrar por status" value={status} onChange={(e) => setStatus(e.target.value)}>
              {ORG_STATUS_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </Select>
          </div>
        </div>
        {q.isLoading ? (
          <TableSkeleton />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.rows.length ? (
          <EmptyState icon={Building2} title="Nenhum estabelecimento encontrado" description={debounced || status ? 'Ajuste a busca ou o filtro.' : 'Os estabelecimentos aparecem aqui após o cadastro.'} />
        ) : (
          <>
            <DataTable
              head={<><th>Estabelecimento</th><th>Proprietário</th><th>Plano</th><th>Status</th><th>Vencimento</th><th className="text-right">Usuários</th><th className="text-right">Clientes</th><th>Cadastro</th><th className="w-10"><span className="sr-only">Ações</span></th></>}
              mobile={q.data.rows.map((o) => (
                <button key={o.id} onClick={() => navigate(`/estabelecimentos/${o.id}`)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{o.name}</div>
                    <div className="truncate text-xs text-muted">{o.owner_email ?? '—'} · {o.plan ? PLAN_NAME[o.plan] : '—'}</div>
                    <div className="mt-2"><OrgStatusBadge status={o.effective_status} suspended={!!o.suspended_at} /></div>
                  </div>
                  <ChevronRight className="size-4 text-subtle" />
                </button>
              ))}
            >
              {q.data.rows.map((o) => (
                <tr key={o.id} className="cursor-pointer" onClick={() => navigate(`/estabelecimentos/${o.id}`)}>
                  <td>
                    <div className="font-medium">{o.name}</div>
                    <div className="text-xs text-muted">{[o.city, o.state].filter(Boolean).join(' · ') || '—'}</div>
                  </td>
                  <td className="max-w-52 truncate text-muted">{o.owner_email ?? '—'}</td>
                  <td>{o.plan ? PLAN_NAME[o.plan] : '—'}</td>
                  <td><OrgStatusBadge status={o.effective_status} suspended={!!o.suspended_at} /></td>
                  <td className="tabular text-muted">{formatDate(o.effective_status === 'trialing' ? o.trial_ends_at : o.current_period_end)}</td>
                  <td className="text-right tabular">{formatNumber(o.members)}</td>
                  <td className="text-right tabular">{formatNumber(o.customers)}</td>
                  <td className="tabular text-muted">{formatDate(o.created_at)}</td>
                  <td className="text-right">
                    <button type="button" aria-label={`Excluir ${o.name}`} title="Excluir estabelecimento" className="rounded-md p-1.5 text-subtle hover:bg-danger/10 hover:text-danger" onClick={(e) => { e.stopPropagation(); setDeleteOrg({ id: o.id, name: o.name }) }}>
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </DataTable>
            <Pagination page={page} pageSize={ADMIN_PAGE} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <DeleteOrgDialog org={deleteOrg} onClose={() => setDeleteOrg(null)} />
    </>
  )
}
