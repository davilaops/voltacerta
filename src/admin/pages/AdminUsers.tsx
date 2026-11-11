import * as React from 'react'
import { Link } from 'react-router-dom'
import { Lock, LockOpen, Search, ShieldCheck, Users } from 'lucide-react'
import { Badge, Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DataTable, EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/ui/states'
import { Pagination } from '@/components/shared/Pagination'
import { ADMIN_PAGE, useAdminAction, useAdminUsers, type AdminUserRow } from '../api'
import { ReasonDialog } from '../components'
import { ROLE } from '@/domain/labels'
import { formatDate, formatDateTime } from '@/lib/format'
import { useDebounce } from '@/lib/useDebounce'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export function AdminUsers() {
  useDocumentTitle('Admin · Usuários')
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(0)
  const [target, setTarget] = React.useState<AdminUserRow | null>(null)
  const debounced = useDebounce(search)
  const q = useAdminUsers(debounced, page)
  React.useEffect(() => setPage(0), [debounced])
  const block = useAdminAction<{ id: string; reason: string }>('admin_block_user', (v) => ({ p_user: v.id, p_reason: v.reason }), 'Usuário bloqueado.')
  const unblock = useAdminAction<{ id: string; reason: string }>('admin_unblock_user', (v) => ({ p_user: v.id, p_reason: v.reason }), 'Usuário desbloqueado.')
  const blocking = target && !target.blocked_at

  const orgs = (u: AdminUserRow) =>
    u.organizations.length ? (
      <div className="space-y-0.5">
        {u.organizations.map((o) => (
          <div key={o.id} className="truncate text-xs"><Link to={`/estabelecimentos/${o.id}`} className="hover:text-brand">{o.name}</Link> <span className="text-subtle">· {ROLE[o.role]}</span></div>
        ))}
      </div>
    ) : <span className="text-xs text-subtle">Sem estabelecimento</span>

  const status = (u: AdminUserRow) => (
    <div className="flex flex-wrap gap-1">
      {u.super_admin && <Badge tone="warning"><ShieldCheck className="size-3" /> Super Admin</Badge>}
      {u.blocked_at ? <Badge tone="danger">Bloqueado</Badge> : u.email_confirmed_at ? <Badge tone="brand">Ativo</Badge> : <Badge tone="muted">E-mail não confirmado</Badge>}
    </div>
  )

  const actionBtn = (u: AdminUserRow) =>
    u.super_admin ? null : u.blocked_at ? (
      <Button size="sm" variant="secondary" onClick={() => setTarget(u)}><LockOpen /> Desbloquear</Button>
    ) : (
      <Button size="sm" variant="danger" onClick={() => setTarget(u)}><Lock /> Bloquear</Button>
    )

  return (
    <>
      <PageHeader title="Usuários" description={q.data ? `${q.data.total} usuário(s). Senhas e segredos nunca são exibidos.` : undefined} />
      <Card>
        <div className="border-b border-border p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input className="pl-9" placeholder="Buscar por nome ou e-mail" aria-label="Buscar usuários" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {q.isLoading ? <TableSkeleton /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.rows.length ? (
          <EmptyState icon={Users} title="Nenhum usuário encontrado" description="Ajuste a busca." />
        ) : (
          <>
            <DataTable
              head={<><th>Usuário</th><th>Estabelecimentos</th><th>Status</th><th>Último acesso</th><th>Cadastro</th><th /></>}
              mobile={q.data.rows.map((u) => (
                <div key={u.id} className="space-y-2 px-4 py-3.5">
                  <div className="truncate text-sm font-medium">{u.full_name ?? u.email}</div>
                  <div className="truncate text-xs text-muted">{u.email}</div>
                  {orgs(u)}
                  <div className="flex items-center justify-between gap-2">{status(u)}{actionBtn(u)}</div>
                </div>
              ))}
            >
              {q.data.rows.map((u) => (
                <tr key={u.id}>
                  <td><div className="font-medium">{u.full_name ?? '—'}</div><div className="text-xs text-muted">{u.email}</div></td>
                  <td className="max-w-60">{orgs(u)}</td>
                  <td>{status(u)}{u.blocked_reason && <div className="mt-1 max-w-48 truncate text-xs text-subtle" title={u.blocked_reason}>{u.blocked_reason}</div>}</td>
                  <td className="tabular text-muted">{u.last_sign_in_at ? formatDateTime(u.last_sign_in_at) : '—'}</td>
                  <td className="tabular text-muted">{formatDate(u.created_at)}</td>
                  <td className="text-right">{actionBtn(u)}</td>
                </tr>
              ))}
            </DataTable>
            <Pagination page={page} pageSize={ADMIN_PAGE} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <ReasonDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        danger={!!blocking}
        title={blocking ? `Bloquear ${target?.email}` : `Desbloquear ${target?.email}`}
        description={blocking ? 'O acesso aos dados é cortado imediatamente em todos os estabelecimentos desta pessoa.' : 'A pessoa volta a acessar os estabelecimentos em que é membro.'}
        confirmLabel={blocking ? 'Bloquear acesso' : 'Desbloquear'}
        loading={block.isPending || unblock.isPending}
        onConfirm={(reason) => (blocking ? block : unblock).mutate({ id: target!.id, reason }, { onSuccess: () => setTarget(null) })}
      />
    </>
  )
}
