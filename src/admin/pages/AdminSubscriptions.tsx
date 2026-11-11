import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { CreditCard, Receipt } from 'lucide-react'
import { Badge, Card, CardHeader } from '@/components/ui/card'
import { Select } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu'
import { DataTable, EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/ui/states'
import { Pagination } from '@/components/shared/Pagination'
import { ADMIN_PAGE, PAYMENT_STATUS, useAdminOrganizations, useAdminPayments } from '../api'
import { ORG_STATUS_FILTERS, OrgStatusBadge } from '../components'
import { formatCents } from '@/features/billing/plans'
import { PLAN_NAME } from '@/domain/labels'
import { formatDate } from '@/lib/format'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export function AdminSubscriptions() {
  useDocumentTitle('Admin · Assinaturas')
  const navigate = useNavigate()
  const [status, setStatus] = React.useState('')
  const [page, setPage] = React.useState(0)
  const [payPage, setPayPage] = React.useState(0)
  const subs = useAdminOrganizations('', status, page)
  const payments = useAdminPayments(payPage)
  React.useEffect(() => setPage(0), [status])

  return (
    <>
      <PageHeader title="Assinaturas" description="Plano, status e vencimento de cada estabelecimento, e histórico de cobranças." />
      <Card>
        <Tabs defaultValue="assinaturas">
          <TabsList className="px-3 pt-1">
            <TabsTrigger value="assinaturas" count={subs.data?.total}>Assinaturas</TabsTrigger>
            <TabsTrigger value="pagamentos" count={payments.data?.total}>Pagamentos</TabsTrigger>
          </TabsList>
          <TabsContent value="assinaturas">
            <div className="border-b border-border p-4 sm:w-64">
              <Select aria-label="Filtrar por status" value={status} onChange={(e) => setStatus(e.target.value)}>
                {ORG_STATUS_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </Select>
            </div>
            {subs.isLoading ? <TableSkeleton /> : subs.error ? <ErrorState error={subs.error} onRetry={() => subs.refetch()} /> : !subs.data?.rows.length ? (
              <EmptyState icon={CreditCard} title="Nenhuma assinatura" description="Ajuste o filtro de status." />
            ) : (
              <>
                <DataTable head={<><th>Estabelecimento</th><th>Plano</th><th>Status</th><th>Fim do teste</th><th>Período pago até</th></>}>
                  {subs.data.rows.map((o) => (
                    <tr key={o.id} className="cursor-pointer" onClick={() => navigate(`/estabelecimentos/${o.id}`)}>
                      <td><div className="font-medium">{o.name}</div><div className="text-xs text-muted">{o.owner_email}</div></td>
                      <td>{o.plan ? PLAN_NAME[o.plan] : '—'}</td>
                      <td><OrgStatusBadge status={o.effective_status} suspended={!!o.suspended_at} /></td>
                      <td className="tabular text-muted">{formatDate(o.trial_ends_at)}</td>
                      <td className="tabular text-muted">{formatDate(o.current_period_end)}</td>
                    </tr>
                  ))}
                </DataTable>
                <Pagination page={page} pageSize={ADMIN_PAGE} total={subs.data.total} onPage={setPage} />
              </>
            )}
          </TabsContent>
          <TabsContent value="pagamentos">
            {payments.isLoading ? <TableSkeleton /> : payments.error ? <ErrorState error={payments.error} onRetry={() => payments.refetch()} /> : !payments.data?.rows.length ? (
              <EmptyState icon={Receipt} title="Nenhum pagamento registrado" description="Os pagamentos aparecem aqui quando o gateway confirmar cobranças via webhook. Nenhum pagamento é simulado." />
            ) : (
              <>
                <DataTable head={<><th>Data</th><th>Estabelecimento</th><th>Plano</th><th>Valor</th><th>Status</th><th>Referência</th></>}>
                  {payments.data.rows.map((p) => (
                    <tr key={p.id}>
                      <td className="tabular">{formatDate(p.paid_at ?? p.created_at)}</td>
                      <td>{p.organization_name ?? '—'}</td>
                      <td>{p.plan ? PLAN_NAME[p.plan] : '—'}</td>
                      <td className="tabular">{formatCents(p.amount_cents)}{p.dev_mode && <Badge tone="muted" className="ml-2">Teste</Badge>}</td>
                      <td><Badge tone={PAYMENT_STATUS[p.status].tone}>{PAYMENT_STATUS[p.status].label}</Badge></td>
                      <td className="max-w-40 truncate font-mono text-xs text-muted">{p.provider}:{p.provider_payment_id}</td>
                    </tr>
                  ))}
                </DataTable>
                <Pagination page={payPage} pageSize={ADMIN_PAGE} total={payments.data.total} onPage={setPayPage} />
              </>
            )}
          </TabsContent>
        </Tabs>
      </Card>
      <Card className="mt-4">
        <CardHeader title="Sobre o status" description="“Em teste” e “Expirada” são calculados no banco a partir da data de fim do teste. “Ativa” só é definida por pagamento confirmado pelo gateway." />
      </Card>
    </>
  )
}
