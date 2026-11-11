import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Copy, MailPlus, Trash2, UserMinus } from 'lucide-react'
import { Badge, Card, CardBody, CardHeader, Skeleton } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/input'
import { ErrorState } from '@/components/ui/states'
import { useOrg } from '@/features/org/OrgProvider'
import { useAuth } from '@/features/auth/AuthProvider'
import { appUrl, rpc, supabase, unwrap } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { ROLE } from '@/domain/labels'
import { formatDate } from '@/lib/format'
import { initials } from '@/lib/utils'
import type { Invitation, MemberRole } from '@/types/models'

interface MemberRow {
  user_id: string
  role: MemberRole
  created_at: string
  profile: { full_name: string | null; email: string | null } | null
}

export function TeamSettings() {
  const { org, role, isAdmin } = useOrg()
  const { user } = useAuth()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [email, setEmail] = React.useState('')
  const [inviteRole, setInviteRole] = React.useState<MemberRole>('employee')

  const members = useQuery({
    queryKey: ['members', org.id],
    queryFn: async () => {
      const rows = unwrap(await supabase.from('organization_members').select('user_id, role, created_at').eq('organization_id', org.id).order('created_at')) as Omit<MemberRow, 'profile'>[]
      const profiles = unwrap(await supabase.from('profiles').select('id, full_name, email').in('id', rows.map((r) => r.user_id))) as { id: string; full_name: string | null; email: string | null }[]
      const map = new Map(profiles.map((p) => [p.id, p]))
      return rows.map((r) => ({ ...r, profile: map.get(r.user_id) ?? null })) as MemberRow[]
    },
  })
  const invites = useQuery({
    queryKey: ['invitations', org.id],
    enabled: isAdmin,
    queryFn: async () => unwrap(await supabase.from('organization_invitations').select('id, email, role, created_at').eq('organization_id', org.id).is('accepted_at', null).order('created_at')) as Invitation[],
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['members'] })
    qc.invalidateQueries({ queryKey: ['invitations'] })
  }
  const invite = useMutation({
    mutationFn: async () => {
      const e = email.trim().toLowerCase()
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('E-mail inválido')
      unwrap(await supabase.from('organization_invitations').insert({ organization_id: org.id, email: e, role: inviteRole, invited_by: user!.id }).select())
    },
    onSuccess: () => {
      toast.success('Convite criado. Envie o link de cadastro para a pessoa.')
      setEmail('')
      invalidate()
    },
    onError: (e) => toast.error(e instanceof Error && e.message === 'E-mail inválido' ? e.message : errorMessage(e)),
  })
  const revoke = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('organization_invitations').delete().eq('id', id).select()),
    onSuccess: () => { toast.success('Convite cancelado.'); invalidate() },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const changeRole = useMutation({
    mutationFn: (v: { userId: string; role: MemberRole }) => rpc<void>('update_member_role', { p_org: org.id, p_user: v.userId, p_role: v.role }),
    onSuccess: () => { toast.success('Papel atualizado.'); invalidate() },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const removeMember = useMutation({
    mutationFn: (userId: string) => rpc<void>('remove_member', { p_org: org.id, p_user: userId }),
    onSuccess: () => { toast.success('Membro removido.'); invalidate() },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const signupLink = `${appUrl}/cadastro`

  return (
    <>
      <Card>
        <CardHeader title="Membros da equipe" description="Proprietário e administradores gerenciam dados e configurações. Funcionários registram clientes, compras e contatos." />
        {members.isLoading ? (
          <CardBody><Skeleton className="h-14 w-full" /></CardBody>
        ) : members.error ? (
          <ErrorState error={members.error} onRetry={() => members.refetch()} />
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {members.data?.map((m) => {
              const name = m.profile?.full_name ?? m.profile?.email ?? 'Usuário'
              const canEdit = role === 'owner' && m.role !== 'owner' && m.user_id !== user?.id
              const canRemove = m.role !== 'owner' && m.user_id !== user?.id && (role === 'owner' || (role === 'admin' && m.role === 'employee'))
              return (
                <li key={m.user_id} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand/15 text-xs font-semibold text-brand">{initials(name)}</span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{name}{m.user_id === user?.id && <span className="text-subtle"> (você)</span>}</div>
                      <div className="truncate text-xs text-muted">{m.profile?.email} · desde {formatDate(m.created_at)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {canEdit ? (
                      <Select aria-label="Papel" className="h-8 sm:h-8" value={m.role} onChange={(e) => changeRole.mutate({ userId: m.user_id, role: e.target.value as MemberRole })}>
                        <option value="admin">{ROLE.admin}</option>
                        <option value="employee">{ROLE.employee}</option>
                      </Select>
                    ) : (
                      <Badge tone={m.role === 'owner' ? 'brand' : 'neutral'}>{ROLE[m.role]}</Badge>
                    )}
                    {canRemove && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remover ${name}`}
                        onClick={async () => {
                          if (await confirm({ title: `Remover ${name}?`, description: 'A pessoa perde o acesso aos dados deste estabelecimento imediatamente.', confirmLabel: 'Remover', danger: true }))
                            removeMember.mutate(m.user_id)
                        }}
                      >
                        <UserMinus />
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader title="Convidar pessoa" description="O acesso é liberado automaticamente quando a pessoa criar conta (ou entrar) com este e-mail." />
          <CardBody className="space-y-4">
            <form
              className="grid gap-3 sm:grid-cols-[1fr_170px_auto] sm:items-end"
              onSubmit={(e) => { e.preventDefault(); invite.mutate() }}
              noValidate
            >
              <Field label="E-mail" htmlFor="invemail">
                <Input id="invemail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="Papel" htmlFor="invrole">
                <Select id="invrole" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as MemberRole)}>
                  <option value="employee">{ROLE.employee}</option>
                  <option value="admin">{ROLE.admin}</option>
                </Select>
              </Field>
              <Button type="submit" loading={invite.isPending}><MailPlus /> Convidar</Button>
            </form>
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2/50 px-3 py-2 text-[13px] text-muted">
              Link de cadastro: <code className="text-fg">{signupLink}</code>
              <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(signupLink).then(() => toast.success('Link copiado.'))}>
                <Copy /> Copiar
              </Button>
            </div>
            {invites.data && invites.data.length > 0 && (
              <ul className="divide-y divide-border rounded-md border border-border">
                {invites.data.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="truncate">{i.email} <span className="text-xs text-muted">· {ROLE[i.role]} · pendente</span></span>
                    <Button variant="ghost" size="icon-sm" aria-label="Cancelar convite" onClick={() => revoke.mutate(i.id)}><Trash2 /></Button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}
    </>
  )
}
