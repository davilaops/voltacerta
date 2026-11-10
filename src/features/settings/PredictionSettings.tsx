import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { useOrg } from '@/features/org/OrgProvider'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { ReadOnlyNotice } from './shared'

const int = (min: number, max: number) => z.coerce.number<string | number>().int('Use números inteiros').min(min, `Mínimo ${min}`).max(max, `Máximo ${max}`)

const schema = z.object({
  soon_days: int(1, 60),
  overdue_after_days: int(0, 30),
  lost_after_days: int(7, 365),
  default_duration_days: int(1, 365),
  history_min_intervals: int(1, 10),
  history_max_weight_pct: int(0, 100),
  attribution_days: int(1, 120),
})
type In = z.input<typeof schema>
type Out = z.output<typeof schema>

export function PredictionSettings() {
  const { org, isAdmin, refresh } = useOrg()
  const qc = useQueryClient()
  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(schema),
    values: {
      soon_days: org.soon_days,
      overdue_after_days: org.overdue_after_days,
      lost_after_days: org.lost_after_days,
      default_duration_days: org.default_duration_days,
      history_min_intervals: org.history_min_intervals,
      history_max_weight_pct: Math.round(Number(org.history_max_weight) * 100),
      attribution_days: org.attribution_days,
    },
  })

  const onSubmit = form.handleSubmit(async ({ history_max_weight_pct, ...v }) => {
    const { error } = await supabase.from('organizations').update({ ...v, history_max_weight: history_max_weight_pct / 100 }).eq('id', org.id)
    if (error) return toast.error(errorMessage(error))
    toast.success('Critérios de previsão salvos.')
    await refresh()
    qc.invalidateQueries()
  })
  const e = form.formState.errors

  return (
    <>
      {!isAdmin && <ReadOnlyNotice />}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <fieldset disabled={!isAdmin} className="space-y-4">
          <Card>
            <CardHeader title="Estados da recompra" description="Definem quando uma oportunidade aparece como próxima, para hoje, atrasada ou perdida." />
            <CardBody className="grid gap-4 sm:grid-cols-3">
              <Field label="Próxima: dias de antecedência" htmlFor="soon" error={e.soon_days?.message} hint="Padrão: 7">
                <Input id="soon" inputMode="numeric" {...form.register('soon_days')} />
              </Field>
              <Field label="Tolerância antes de atrasar" htmlFor="ovd" error={e.overdue_after_days?.message} hint="Dias após a data prevista. Padrão: 0">
                <Input id="ovd" inputMode="numeric" {...form.register('overdue_after_days')} />
              </Field>
              <Field label="Perdida após (dias de atraso)" htmlFor="lost" error={e.lost_after_days?.message} hint="Usado em oportunidades perdidas">
                <Input id="lost" inputMode="numeric" {...form.register('lost_after_days')} />
              </Field>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Critérios de previsão" description="Combinação entre a duração do produto e o histórico real do cliente." />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Duração padrão (dias)" htmlFor="dur" error={e.default_duration_days?.message} hint="Usada quando o produto não tem duração cadastrada">
                <Input id="dur" inputMode="numeric" {...form.register('default_duration_days')} />
              </Field>
              <Field label="Intervalos mínimos para usar histórico" htmlFor="minint" error={e.history_min_intervals?.message} hint="Evita previsões instáveis com poucos dados. Padrão: 2">
                <Input id="minint" inputMode="numeric" {...form.register('history_min_intervals')} />
              </Field>
              <Field label="Peso máximo do histórico (%)" htmlFor="w" error={e.history_max_weight_pct?.message} hint="O peso cresce com a quantidade de compras até este limite. Padrão: 70">
                <Input id="w" inputMode="numeric" {...form.register('history_max_weight_pct')} />
              </Field>
              <Field label="Janela de atribuição (dias)" htmlFor="attr" error={e.attribution_days?.message} hint="Compra até X dias após um contato conta como venda recuperada">
                <Input id="attr" inputMode="numeric" {...form.register('attribution_days')} />
              </Field>
            </CardBody>
          </Card>
        </fieldset>
        <p className="text-xs text-subtle">As alterações valem para as próximas compras registradas. Os estados (próxima, hoje, atrasada) são recalculados imediatamente.</p>
        {isAdmin && (
          <div className="flex justify-end">
            <Button type="submit" loading={form.formState.isSubmitting}>Salvar critérios</Button>
          </div>
        )}
      </form>
    </>
  )
}
