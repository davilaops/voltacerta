import * as React from 'react'
import { toast } from 'sonner'
import { Check, Info, Loader2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Badge, Card, CardBody, CardHeader, Skeleton } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ErrorState, PageHeader } from '@/components/ui/states'
import { useOrg } from '@/features/org/OrgProvider'
import { customerLimitLabel, formatCents, usePlans } from './plans'
import { PLAN_NAME, SUBSCRIPTION_STATUS } from '@/domain/labels'
import { formatDate } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import type { PlanTier } from '@/types/models'

/** Chama a Edge Function de checkout. Nunca marca assinatura como paga no cliente. */
async function startCheckout(orgId: string, plan: PlanTier): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ url?: string; error?: string }>('billing-checkout', {
    body: { organization_id: orgId, plan },
  })
  if (error) {
    let code = error.message
    try {
      const body = await (error as { context?: Response }).context?.json()
      if (body?.error) code = body.error
    } catch {
      /* corpo indisponível */
    }
    throw new Error(code)
  }
  if (!data?.url) throw new Error('BILLING_ADAPTER_PENDING')
  return data.url
}

export function PlanPage() {
  useDocumentTitle('Plano')
  const { org, ctx, role } = useOrg()
  const plans = usePlans()
  const [pending, setPending] = React.useState<PlanTier | null>(null)
  const status = SUBSCRIPTION_STATUS[ctx.effective_status]
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const returned = params.get('pagamento') === 'concluido'
  const confirmed = returned && ctx.effective_status === 'active'

  // Voltou do checkout: a assinatura só muda quando o webhook confirmar. Atualiza por até 2 min.
  React.useEffect(() => {
    if (!returned || confirmed) return
    const started = Date.now()
    const t = window.setInterval(() => {
      if (Date.now() - started > 120_000) return window.clearInterval(t)
      qc.invalidateQueries({ queryKey: ['org-context', org.id] })
    }, 4000)
    return () => window.clearInterval(t)
  }, [returned, confirmed, qc, org.id])

  React.useEffect(() => {
    if (confirmed) toast.success('Pagamento confirmado. Sua assinatura está ativa!')
  }, [confirmed])

  const subscribe = async (plan: PlanTier) => {
    setPending(plan)
    try {
      window.location.href = await startCheckout(org.id, plan)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setPending(null)
    }
  }

  return (
    <>
      <PageHeader title="Plano e assinatura" description="Escolha o plano ideal para o tamanho da sua base de clientes." />
      <Card className="mb-6">
        <CardHeader title="Assinatura atual" />
        <CardBody className="grid gap-4 text-sm sm:grid-cols-4">
          <div><div className="text-xs text-muted">Plano</div><div className="mt-1 font-semibold">{PLAN_NAME[ctx.plan]}</div></div>
          <div><div className="text-xs text-muted">Situação</div><div className="mt-1"><Badge tone={status.tone}>{status.label}</Badge></div></div>
          <div>
            <div className="text-xs text-muted">{ctx.effective_status === 'trialing' ? 'Teste termina em' : 'Período atual até'}</div>
            <div className="mt-1 font-medium">{formatDate(ctx.effective_status === 'trialing' ? ctx.trial_ends_at : ctx.current_period_end)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Clientes</div>
            <div className="mt-1 font-medium tabular">{ctx.customer_count}{ctx.customer_limit ? ` / ${ctx.customer_limit}` : ' (ilimitado)'}</div>
          </div>
        </CardBody>
      </Card>

      {returned && (
        <div className={cn('mb-6 flex gap-3 rounded-md border px-4 py-3 text-[13px]', confirmed ? 'border-brand/25 bg-brand/5 text-brand' : 'border-info/25 bg-info/5 text-info')}>
          {confirmed ? <Check className="mt-0.5 size-4 shrink-0" /> : <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />}
          <span className="flex-1">
            {confirmed
              ? 'Pagamento confirmado. Sua assinatura está ativa.'
              : 'Recebemos seu retorno do pagamento. Aguardando a confirmação da AbacatePay. Isso costuma levar poucos segundos (Pix pode levar alguns minutos).'}
          </span>
          <button type="button" className="text-xs underline" onClick={() => setParams({}, { replace: true })}>Fechar</button>
        </div>
      )}
      {!returned && (
        <div className="mb-6 flex gap-3 rounded-md border border-border px-4 py-3 text-[13px] text-muted">
          <Info className="mt-0.5 size-4 shrink-0" />
          O pagamento é feito na página segura da AbacatePay. A assinatura muda para “Ativa” assim que a AbacatePay confirmar a cobrança.
        </div>
      )}

      {plans.error ? (
        <Card><ErrorState error={plans.error} onRetry={() => plans.refetch()} /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {plans.isLoading
            ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-80 w-full" />)
            : plans.data?.map((p) => {
                const current = p.id === ctx.plan && ctx.effective_status === 'active'
                return (
                  <Card key={p.id} className={cn('relative flex flex-col p-6', p.highlight && 'border-brand/40')}>
                    {p.highlight && <Badge tone="brand" className="absolute right-4 top-4">Mais escolhido</Badge>}
                    <h3 className="text-base font-semibold">{p.name}</h3>
                    <div className="mt-3 flex items-baseline gap-1">
                      <span className="text-3xl font-semibold tracking-tight tabular">{formatCents(p.price_cents)}</span>
                      <span className="text-sm text-muted">/mês</span>
                    </div>
                    <p className="mt-1 text-sm text-muted">{customerLimitLabel(p.customer_limit)}</p>
                    <ul className="mt-5 flex-1 space-y-2.5 text-sm">
                      {p.highlights.map((f) => (
                        <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand" />{f}</li>
                      ))}
                    </ul>
                    <Button
                      className="mt-6 w-full"
                      variant={p.highlight ? 'primary' : 'secondary'}
                      disabled={current || role !== 'owner'}
                      loading={pending === p.id}
                      onClick={() => subscribe(p.id)}
                    >
                      {current ? 'Plano atual' : role !== 'owner' ? 'Apenas o proprietário pode assinar' : 'Assinar'}
                    </Button>
                  </Card>
                )
              })}
        </div>
      )}
      <p className="mt-6 text-center text-xs text-subtle">Valores mensais em reais. Cancele quando quiser. Durante o teste você tem acesso aos recursos do plano Profissional.</p>
    </>
  )
}
