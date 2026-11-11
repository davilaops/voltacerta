import * as React from 'react'
import { Pencil, Tags } from 'lucide-react'
import { Badge, Card, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { DataTable, EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/ui/states'
import { useAdminAction } from '../api'
import { ReasonDialog } from '../components'
import { customerLimitLabel, formatCents, usePlans, type Plan } from '@/features/billing/plans'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export function AdminPlans() {
  useDocumentTitle('Admin · Planos')
  const q = usePlans()
  const [editing, setEditing] = React.useState<Plan | null>(null)
  const [price, setPrice] = React.useState('')
  const [limit, setLimit] = React.useState('')
  const update = useAdminAction<{ reason: string }>(
    'admin_update_plan',
    (v) => ({
      p_plan: editing!.id,
      p_price_cents: Math.round(Number(price.replace(/\./g, '').replace(',', '.')) * 100),
      p_customer_limit: limit.trim() === '' ? null : Number(limit),
      p_reason: v.reason,
    }),
    'Plano atualizado.',
  )
  const open = (p: Plan) => {
    setEditing(p)
    setPrice((p.price_cents / 100).toFixed(2).replace('.', ','))
    setLimit(p.customer_limit == null ? '' : String(p.customer_limit))
  }
  const priceValid = /^\d{1,6}(,\d{1,2})?$/.test(price.trim())
  const limitValid = limit.trim() === '' || /^\d+$/.test(limit.trim())

  return (
    <>
      <PageHeader title="Planos" description="Fonte única de preços e limites (tabela plans). O app e a landing leem estes valores." />
      <Card>
        {q.isLoading ? <TableSkeleton rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? (
          <EmptyState icon={Tags} title="Nenhum plano" description="Rode as migrations para criar os planos." />
        ) : (
          <DataTable head={<><th>Plano</th><th>Preço mensal</th><th>Limite de clientes</th><th>Recursos</th><th /></>}>
            {q.data.map((p) => (
              <tr key={p.id}>
                <td><div className="flex items-center gap-2 font-medium">{p.name}{p.highlight && <Badge tone="brand">Destaque</Badge>}</div></td>
                <td className="tabular">{formatCents(p.price_cents)}</td>
                <td>{customerLimitLabel(p.customer_limit)}</td>
                <td className="text-xs text-muted">
                  {[p.features.reports_full && 'Relatórios completos', p.features.history_advanced && 'Histórico avançado', p.features.reports_advanced && 'Relatórios avançados'].filter(Boolean).join(' · ') || 'Básico'}
                </td>
                <td className="text-right"><Button size="sm" variant="secondary" onClick={() => open(p)}><Pencil /> Editar</Button></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
      <Card className="mt-4">
        <CardHeader title="Importante" description="Alterar o preço aqui não cobra nem altera assinaturas no gateway. Quando o pagamento for integrado, os valores do gateway devem ser mantidos iguais a esta tabela." />
      </Card>

      <ReasonDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={`Editar plano ${editing?.name ?? ''}`}
        description="A alteração vale imediatamente para limites e exibição de preços."
        confirmLabel="Salvar plano"
        loading={update.isPending}
        onConfirm={(reason) => {
          if (!priceValid || !limitValid) return
          update.mutate({ reason }, { onSuccess: () => setEditing(null) })
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Preço (R$)" htmlFor="pprice" error={priceValid ? undefined : 'Use o formato 69,90'}>
            <Input id="pprice" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="Limite de clientes" htmlFor="plimit" hint="Vazio = ilimitado" error={limitValid ? undefined : 'Número inteiro'}>
            <Input id="plimit" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </Field>
        </div>
      </ReasonDialog>
    </>
  )
}
