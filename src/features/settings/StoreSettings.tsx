import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Copy, ExternalLink } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input, Textarea } from '@/components/ui/input'
import { useOrg } from '@/features/org/OrgProvider'
import { errorMessage } from '@/lib/errors'
import { appBaseUrl } from '@/lib/hosts'
import { supabase } from '@/lib/supabase'
import { ReadOnlyNotice } from './shared'

export function slugify(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

export function StoreSettings() {
  const { org, isAdmin, refresh } = useOrg()
  const init = React.useCallback(() => ({
    slug: org.public_slug ?? slugify(org.name),
    catalog: org.catalog_enabled,
    booking: org.booking_enabled,
    prices: org.show_prices,
    whatsapp: org.public_whatsapp ?? '',
    description: org.public_description ?? '',
    notice: String(org.booking_min_notice_hours),
    ahead: String(org.booking_days_ahead),
  }), [org])
  const [f, setF] = React.useState(init)
  const [saving, setSaving] = React.useState(false)
  React.useEffect(() => setF(init()), [init])

  const slugOk = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(f.slug)
  const notice = Number(f.notice)
  const ahead = Number(f.ahead)
  const url = `${appBaseUrl}/loja/${org.public_slug ?? f.slug}`
  const published = org.catalog_enabled || org.booking_enabled

  const save = async () => {
    if (!slugOk) return toast.error('Endereço inválido: use letras minúsculas, números e hífen (3 a 40 caracteres).')
    if (!(Number.isInteger(notice) && notice >= 0 && notice <= 72) || !(Number.isInteger(ahead) && ahead >= 1 && ahead <= 90)) return toast.error('Verifique a antecedência e o limite de dias.')
    setSaving(true)
    const { error } = await supabase.from('organizations').update({
      public_slug: f.slug, catalog_enabled: f.catalog, booking_enabled: f.booking, show_prices: f.prices,
      public_whatsapp: f.whatsapp.trim() || null, public_description: f.description.trim() || null,
      booking_min_notice_hours: notice, booking_days_ahead: ahead,
    }).eq('id', org.id)
    setSaving(false)
    if (error) return toast.error(errorMessage(error))
    toast.success(f.catalog || f.booking ? 'Loja online publicada.' : 'Configurações salvas.')
    await refresh()
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copiado.')
    } catch {
      toast.error('Não foi possível copiar.')
    }
  }

  return (
    <>
      {!isAdmin && <ReadOnlyNotice />}
      {published && (
        <Card className="border-brand/30">
          <CardBody className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-brand">Sua loja está no ar</div>
              <div className="truncate text-sm text-muted">{url}</div>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={copy}><Copy /> Copiar link</Button>
              <Button variant="secondary" size="sm" asChild><a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink /> Abrir</a></Button>
            </div>
          </CardBody>
        </Card>
      )}
      <fieldset disabled={!isAdmin} className="space-y-4">
        <Card>
          <CardHeader title="Página pública da loja" description="Um link para colocar no Instagram, Google e WhatsApp com seus produtos, serviços e agendamento online." />
          <CardBody className="space-y-4">
            <Field label="Endereço" htmlFor="slug" hint={slugOk ? `${appBaseUrl}/loja/${f.slug}` : 'Use letras minúsculas, números e hífen (3 a 40 caracteres).'} error={f.slug && !slugOk ? 'Endereço inválido' : undefined}>
              <Input id="slug" value={f.slug} onChange={(e) => setF({ ...f, slug: slugify(e.target.value) })} />
            </Field>
            <Field label="Descrição" htmlFor="pdesc" optional><Textarea id="pdesc" rows={2} maxLength={500} placeholder="Ex.: Banho e tosa com carinho, rações e acessórios. Leva e traz grátis no bairro." value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
            <Field label="WhatsApp para pedidos" htmlFor="pwa" optional hint="Se vazio, usamos o telefone do estabelecimento."><Input id="pwa" inputMode="tel" value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} /></Field>
            <div className="space-y-3">
              <Checkbox label="Publicar catálogo" description="Mostra os produtos marcados como “mostrar no catálogo” e os serviços." checked={f.catalog} onChange={(e) => setF({ ...f, catalog: e.target.checked })} />
              <Checkbox label="Receber agendamentos online" description="Clientes escolhem serviço, dia e horário livre. O pedido chega na Agenda para você confirmar." checked={f.booking} onChange={(e) => setF({ ...f, booking: e.target.checked })} />
              <Checkbox label="Mostrar preços" checked={f.prices} onChange={(e) => setF({ ...f, prices: e.target.checked })} />
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Regras do agendamento online" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Antecedência mínima (horas)" htmlFor="notice" hint="Evita pedidos em cima da hora."><Input id="notice" inputMode="numeric" value={f.notice} onChange={(e) => setF({ ...f, notice: e.target.value })} /></Field>
            <Field label="Agendar até quantos dias à frente" htmlFor="ahead"><Input id="ahead" inputMode="numeric" value={f.ahead} onChange={(e) => setF({ ...f, ahead: e.target.value })} /></Field>
          </CardBody>
        </Card>
      </fieldset>
      <p className="text-xs text-subtle">
        Os horários livres seguem o <Link to="/app/configuracoes/agenda" className="text-brand hover:underline">horário de funcionamento</Link> e a escala dos profissionais em <Link to="/app/servicos" className="text-brand hover:underline">Serviços</Link>. Os produtos aparecem no catálogo quando marcados no cadastro do produto.
      </p>
      {isAdmin && <div className="flex justify-end"><Button loading={saving} onClick={save}>Salvar</Button></div>}
    </>
  )
}
