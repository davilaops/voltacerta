import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Ban, CalendarPlus, Building2, PlayCircle, Repeat, Trash2, XCircle } from 'lucide-react'
import { Badge, Card, CardBody, CardHeader, Skeleton } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/input'
import { DataTable, EmptyState, ErrorState } from '@/components/ui/states'
import { ACTION_LABEL, PAYMENT_STATUS, useAdminAction, useAdminOrganization } from '../api'
import { CancelSubscriptionDialog, DeleteOrgDialog, OrgStatusBadge, ReasonDialog, type OrgRef } from '../components'
import { formatCents, usePlans } from '@/features/billing/plans'
import { BUSINESS_TYPE, PLAN_NAME, ROLE } from '@/domain/labels'
import { formatDate, formatDateTime, formatNumber, formatPhone } from '@/lib/format'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import type { BusinessType, PlanTier } from '@/types/models'

type Action = 'suspend' | 'reactivate' | 'trial' | 'plan' | null

export function AdminOrganizationDetail() {
  const { id } = useParams<{ id: string }>()
  const q = useAdminOrganization(id)
  const plans = usePlans()
  const [action, setAction] = React.useState<Action>(null)
  const [cancelOrg, setCancelOrg] = React.useState<OrgRef>(null)
  const [deleteOrg, setDeleteOrg] = React.useState<OrgRef>(null)
  const navigate = useNavigate()
  const [days, setDays] = React.useState('14')
  const [plan, setPlan] = React.useState<PlanTier>('profissional')
  useDocumentTitle(q.data ? `Admin · ${q.data.organization.name}` : 'Admin · Estabelecimento')

  const close = () => setAction(null)
  const suspend = useAdminAction<string>('admin_suspend_organization', (r) => ({ p_org: id, p_reason: r }), 'Estabelecimento suspenso.')
  const reactivate = useAdminAction<string>('admin_reactivate_organization', (r) => ({ p_org: id, p_reason: r }), 'Estabelecimento reativado.')
  const trial = useAdminAction<{ reason: string; days: number }>('admin_grant_trial', (v) => ({ p_org: id, p_days: v.days, p_reason: v.reason }), 'Período de teste concedido.')
  const changePlan = useAdminAction<{ reason: string; plan: PlanTier }>('admin_change_plan', (v) => ({ p_org: id, p_plan: v.plan, p_reason: v.reason }), 'Plano alterado.')

  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-40 w-full" /><Skeleton className="h-64 w-full" /></div>
  if (q.error) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
  if (!q.data) return <Card><EmptyState icon={Building2} title="Estabelecimento não encontrado" description="Ele pode ter sido excluído." /></Card>

  const { organization: o, subscription: s, members, counts, payments, audit } = q.data
  const suspended = !!o.suspended_at

  return (
    <>
      <Link to="/estabelecimentos" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-4" /> Estabelecimentos</Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{o.name}</h1>
            <OrgStatusBadge status={s?.effective_status ?? null} suspended={suspended} />
            {!o.onboarding_completed && <Badge tone="muted">Onboarding pendente</Badge>}
          </div>
          <p className="mt-1.5 text-[13px] text-muted">
            {[o.city, o.state].filter(Boolean).join(' · ') || 'Sem cidade'} · {o.business_type ? BUSINESS_TYPE[o.business_type as BusinessType] : 'Tipo não informado'} · cadastrado em {formatDate(o.created_at)}
          </p>
          {suspended && <p className="mt-2 text-[13px] text-[#ff8a8a]">Suspenso em {formatDateTime(o.suspended_at)} — {o.suspended_reason}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {suspended ? (
            <Button variant="secondary" onClick={() => setAction('reactivate')}><PlayCircle /> Reativar</Button>
          ) : (
            <Button variant="secondary" onClick={() => setAction('suspend')}><Ban /> Suspender</Button>
          )}
          <Button variant="danger" onClick={() => setDeleteOrg({ id: o.id, name: o.name })}><Trash2 /> Excluir</Button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[['Clientes', counts.customers], ['Produtos', counts.products], ['Compras', counts.purchases], ['Contatos', counts.contacts]].map(([l, v]) => (
          <Card key={l} className="p-4"><div className="text-xs text-muted">{l}</div><div className="mt-1 text-lg font-semibold tabular">{formatNumber(v as number)}</div></Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader
              title="Assinatura"
              action={
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setAction('trial')} disabled={s?.status === 'active'} title={s?.status === 'active' ? 'Assinatura paga ativa' : undefined}><CalendarPlus /> Conceder teste</Button>
                  <Button size="sm" variant="secondary" onClick={() => { setPlan(s?.plan ?? 'profissional'); setAction('plan') }}><Repeat /> Alterar plano</Button>
                  {s && s.effective_status !== 'canceled' && s.effective_status !== 'expired' && (
                    <Button size="sm" variant="danger" onClick={() => setCancelOrg({ id: o.id, name: o.name })}><XCircle /> Encerrar</Button>
                  )}
                </div>
              }
            />
            <CardBody className="grid gap-4 text-sm sm:grid-cols-3">
              {s ? (
                <>
                  <div><div className="text-xs text-muted">Plano</div><div className="mt-1 font-medium">{PLAN_NAME[s.plan]}</div></div>
                  <div><div className="text-xs text-muted">Status</div><div className="mt-1"><OrgStatusBadge status={s.effective_status} suspended={false} /></div></div>
                  <div><div className="text-xs text-muted">Gateway</div><div className="mt-1">{s.provider ?? 'Não vinculado'}</div></div>
                  <div><div className="text-xs text-muted">Início do teste</div><div className="mt-1 tabular">{formatDate(s.trial_started_at)}</div></div>
                  <div><div className="text-xs text-muted">Fim do teste</div><div className="mt-1 tabular">{formatDate(s.trial_ends_at)}</div></div>
                  <div><div className="text-xs text-muted">Período pago até</div><div className="mt-1 tabular">{formatDate(s.current_period_end)}</div></div>
                </>
              ) : (
                <p className="text-muted">Sem assinatura registrada.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Pagamentos" description="Somente cobranças confirmadas pelo gateway" />
            {!payments.length ? (
              <CardBody><p className="text-sm text-subtle">Nenhum pagamento registrado.</p></CardBody>
            ) : (
              <DataTable head={<><th>Data</th><th>Plano</th><th>Valor</th><th>Status</th><th>Referência</th></>}>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="tabular">{formatDate(p.paid_at ?? p.created_at)}</td>
                    <td>{p.plan ? PLAN_NAME[p.plan] : '—'}</td>
                    <td className="tabular">{formatCents(p.amount_cents)}{p.dev_mode && <Badge tone="muted" className="ml-2">Teste</Badge>}</td>
                    <td><Badge tone={PAYMENT_STATUS[p.status].tone}>{PAYMENT_STATUS[p.status].label}</Badge></td>
                    <td className="max-w-40 truncate font-mono text-xs text-muted">{p.provider}:{p.provider_payment_id}</td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Card>

          <Card>
            <CardHeader title="Histórico administrativo" />
            {!audit.length ? (
              <CardBody><p className="text-sm text-subtle">Nenhuma ação administrativa neste estabelecimento.</p></CardBody>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {audit.map((a) => (
                  <li key={a.id} className="px-5 py-3 text-sm">
                    <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{ACTION_LABEL[a.action] ?? a.action}</span><span className="text-xs text-muted">{formatDateTime(a.created_at)}</span></div>
                    <div className="text-xs text-muted">{a.actor_email ?? 'Sistema'}{a.reason && ` — ${a.reason}`}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Responsável" />
            <CardBody className="space-y-1 text-sm">
              <div>{o.owner_name ?? '—'}</div>
              <div className="text-muted">{formatPhone(o.phone)}</div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={`Usuários (${members.length})`} />
            <ul className="divide-y divide-border border-t border-border">
              {members.map((m) => (
                <li key={m.user_id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{m.full_name ?? m.email}</span>
                    <Badge tone={m.role === 'owner' ? 'brand' : 'neutral'}>{ROLE[m.role]}</Badge>
                  </div>
                  <div className="truncate text-xs text-muted">{m.email}{m.blocked_at && ' · bloqueado'}</div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <CancelSubscriptionDialog org={cancelOrg} onClose={() => setCancelOrg(null)} />
      <DeleteOrgDialog org={deleteOrg} onClose={() => setDeleteOrg(null)} onDeleted={() => navigate('/estabelecimentos', { replace: true })} />
      <ReasonDialog open={action === 'suspend'} onOpenChange={(o2) => !o2 && close()} danger title="Suspender estabelecimento"
        description="Os usuários continuam vendo os dados, mas não conseguem registrar nada até a reativação."
        confirmLabel="Suspender" loading={suspend.isPending} onConfirm={(r) => suspend.mutate(r, { onSuccess: close })} />
      <ReasonDialog open={action === 'reactivate'} onOpenChange={(o2) => !o2 && close()} title="Reativar estabelecimento"
        description="Libera novamente o registro de dados (respeitando a assinatura)." confirmLabel="Reativar"
        loading={reactivate.isPending} onConfirm={(r) => reactivate.mutate(r, { onSuccess: close })} />
      <ReasonDialog open={action === 'trial'} onOpenChange={(o2) => !o2 && close()} title="Conceder período de teste"
        description="Define o status como teste a partir de hoje. Não é possível aplicar em assinatura paga ativa." confirmLabel="Conceder"
        loading={trial.isPending} onConfirm={(r) => trial.mutate({ reason: r, days: Number(days) }, { onSuccess: close })}>
        <Field label="Dias de teste" htmlFor="tdays" hint="Entre 1 e 90 dias.">
          <Input id="tdays" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
        </Field>
      </ReasonDialog>
      <ReasonDialog open={action === 'plan'} onOpenChange={(o2) => !o2 && close()} title="Alterar plano"
        description="Altera limites e recursos. Não muda o status nem registra pagamento." confirmLabel="Alterar plano"
        loading={changePlan.isPending} onConfirm={(r) => changePlan.mutate({ reason: r, plan }, { onSuccess: close })}>
        <Field label="Novo plano" htmlFor="nplan">
          <Select id="nplan" value={plan} onChange={(e) => setPlan(e.target.value as PlanTier)}>
            {(plans.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} · {formatCents(p.price_cents)}/mês</option>)}
          </Select>
        </Field>
      </ReasonDialog>
    </>
  )
}
