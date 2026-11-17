import * as React from 'react'
import { toast } from 'sonner'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/input'
import { useOrg } from '@/features/org/OrgProvider'
import { WEEKDAYS } from '@/domain/labels'
import { errorMessage } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { BusinessHours } from '@/types/models'
import { ReadOnlyNotice } from './shared'

export function AgendaSettings() {
  const { org, isAdmin, refresh } = useOrg()
  const [hours, setHours] = React.useState<BusinessHours>(org.business_hours)
  const [slot, setSlot] = React.useState(String(org.slot_minutes))
  const [postSale, setPostSale] = React.useState(String(org.post_sale_days))
  const [saving, setSaving] = React.useState(false)
  React.useEffect(() => {
    setHours(org.business_hours)
    setSlot(String(org.slot_minutes))
    setPostSale(String(org.post_sale_days))
  }, [org.business_hours, org.slot_minutes, org.post_sale_days])

  const invalid = Object.values(hours).some((h) => h && !(h[0] < h[1]))
  const ps = Number(postSale)
  const save = async () => {
    if (invalid || !(Number.isInteger(ps) && ps >= 1 && ps <= 30)) return toast.error('Verifique os horários e o prazo de pós-venda.')
    setSaving(true)
    const { error } = await supabase.from('organizations').update({ business_hours: hours, slot_minutes: Number(slot), post_sale_days: ps }).eq('id', org.id)
    setSaving(false)
    if (error) return toast.error(errorMessage(error))
    toast.success('Configurações da agenda salvas.')
    await refresh()
  }

  return (
    <>
      {!isAdmin && <ReadOnlyNotice />}
      <fieldset disabled={!isAdmin} className="space-y-4">
        <Card>
          <CardHeader title="Horário de funcionamento" description="Usado na agenda e nos horários oferecidos no agendamento online." />
          <CardBody className="space-y-2">
            {WEEKDAYS.map((name, i) => {
              const h = hours[String(i)]
              return (
                <div key={name} className="grid grid-cols-[110px_auto_1fr] items-center gap-3">
                  <span className="text-[13px] font-medium">{name}</span>
                  <label className="flex items-center gap-2 text-[13px] text-muted">
                    <input type="checkbox" className="accent-[#22c58b]" checked={!!h}
                      onChange={(e) => setHours({ ...hours, [String(i)]: e.target.checked ? ['08:00', '18:00'] : null })} /> Aberto
                  </label>
                  {h ? (
                    <div className="flex items-center gap-2">
                      <Input type="time" aria-label={`Abertura ${name}`} className="h-8 w-28 sm:h-8" value={h[0]} onChange={(e) => setHours({ ...hours, [String(i)]: [e.target.value, h[1]] })} />
                      <span className="text-subtle">às</span>
                      <Input type="time" aria-label={`Fechamento ${name}`} className="h-8 w-28 sm:h-8" value={h[1]} onChange={(e) => setHours({ ...hours, [String(i)]: [h[0], e.target.value] })} />
                      {!(h[0] < h[1]) && <span className="text-xs text-danger">Inválido</span>}
                    </div>
                  ) : <span className="text-[13px] text-subtle">Fechado</span>}
                </div>
              )
            })}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Agenda e lembretes" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Intervalo entre horários" htmlFor="slot" hint="De quanto em quanto tempo os horários são oferecidos no agendamento online.">
              <Select id="slot" value={slot} onChange={(e) => setSlot(e.target.value)}>
                {[15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutos</option>)}
              </Select>
            </Field>
            <Field label="Pós-venda após (dias)" htmlFor="ps" hint="Quantos dias depois da compra aparece o lembrete de pós-venda.">
              <Input id="ps" inputMode="numeric" value={postSale} onChange={(e) => setPostSale(e.target.value)} />
            </Field>
          </CardBody>
        </Card>
      </fieldset>
      {isAdmin && <div className="flex justify-end"><Button loading={saving} onClick={save}>Salvar</Button></div>}
    </>
  )
}
