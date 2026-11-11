import * as React from 'react'
import { Link } from 'react-router-dom'
import { ScrollText } from 'lucide-react'
import { Badge, Card } from '@/components/ui/card'
import { DataTable, EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/ui/states'
import { Pagination } from '@/components/shared/Pagination'
import { ACTION_LABEL, useAdminAudit, type AdminAuditRow } from '../api'
import { formatDateTime } from '@/lib/format'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

const TARGET: Record<string, string> = { organization: 'Estabelecimento', subscription: 'Assinatura', user: 'Usuário', plan: 'Plano', platform: 'Plataforma' }

function details(a: AdminAuditRow): string {
  const d = a.details ?? {}
  if (a.action === 'change_plan') return `${d.from} → ${d.to}`
  if (a.action === 'grant_trial') return `${d.days} dias`
  if (a.action === 'update_plan') {
    const p = d.price_cents as { from: number; to: number } | undefined
    return p ? `R$ ${(p.from / 100).toFixed(2)} → R$ ${(p.to / 100).toFixed(2)}` : ''
  }
  if (a.action === 'promote_super_admin') return String(d.email ?? '')
  return ''
}

export function AdminAudit() {
  useDocumentTitle('Admin · Auditoria')
  const [page, setPage] = React.useState(0)
  const q = useAdminAudit(page)
  const target = (a: AdminAuditRow) =>
    (a.target_type === 'organization' || a.target_type === 'subscription') && a.target_id ? (
      <Link to={`/estabelecimentos/${a.target_id}`} className="text-brand hover:underline">{TARGET[a.target_type]}</Link>
    ) : (
      TARGET[a.target_type] ?? a.target_type
    )

  return (
    <>
      <PageHeader title="Auditoria" description="Toda ação administrativa: quem fez, quando, o quê e por quê." />
      <Card>
        {q.isLoading ? <TableSkeleton /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.rows.length ? (
          <EmptyState icon={ScrollText} title="Nenhuma ação registrada" description="As ações administrativas aparecem aqui." />
        ) : (
          <>
            <DataTable
              head={<><th>Data</th><th>Responsável</th><th>Operação</th><th>Alvo</th><th>Detalhes</th><th>Justificativa</th></>}
              mobile={q.data.rows.map((a) => (
                <div key={a.id} className="px-4 py-3.5 text-sm">
                  <div className="flex justify-between gap-2"><span className="font-medium">{ACTION_LABEL[a.action] ?? a.action}</span><span className="text-xs text-muted">{formatDateTime(a.created_at)}</span></div>
                  <div className="text-xs text-muted">{a.actor_email ?? 'Sistema'} · {details(a)}</div>
                  {a.reason && <div className="mt-1 text-xs text-subtle">{a.reason}</div>}
                </div>
              ))}
            >
              {q.data.rows.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap tabular text-muted">{formatDateTime(a.created_at)}</td>
                  <td>{a.actor_email?.startsWith('system:') ? <Badge tone="muted">Sistema (CLI)</Badge> : a.actor_email ?? '—'}</td>
                  <td className="font-medium">{ACTION_LABEL[a.action] ?? a.action}</td>
                  <td>{target(a)}</td>
                  <td className="text-xs text-muted">{details(a)}</td>
                  <td className="max-w-72 text-xs text-muted">{a.reason ?? '—'}</td>
                </tr>
              ))}
            </DataTable>
            <Pagination page={page} pageSize={50} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  )
}
