import * as React from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarCheck, CheckCircle2, Clock, Loader2, MapPin, MessageCircle, Package, Scissors, Store } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { CATEGORY, SERVICE_CATEGORY, UNIT, WEEKDAYS, WEEKDAYS_SHORT } from '@/domain/labels'
import { addDaysISO } from '@/lib/dates'
import { formatCurrency, formatDate, formatNumber } from '@/lib/format'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { buildWhatsAppLink } from '@/lib/whatsapp'
import { cn } from '@/lib/utils'
import type { BusinessHours, ProductCategory, ProductUnit, ServiceCategory } from '@/types/models'

const BASE = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''
const ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''
const FN = `${BASE}/functions/v1/public-store`
const headers = { apikey: ANON, Authorization: `Bearer ${ANON}` }

interface StoreData {
  name: string
  description: string | null
  whatsapp: string | null
  address: string | null
  city: string | null
  state: string | null
  logo_path: string | null
  catalog_enabled: boolean
  booking_enabled: boolean
  show_prices: boolean
  business_hours: BusinessHours
  booking_days_ahead: number
  today: string
  products: { id: string; name: string; category: ProductCategory; brand: string | null; price: number | null; size_value: number | null; unit: ProductUnit; description: string | null; available: boolean | null }[]
  services: { id: string; name: string; category: ServiceCategory; price: number | null; duration_minutes: number; description: string | null; bookable: boolean }[]
}

const ERRORS: Record<string, string> = {
  SLOT_UNAVAILABLE: 'Esse horário acabou de ser ocupado. Escolha outro.',
  INVALID_PHONE: 'Telefone inválido. Informe DDD + número.',
  INVALID_NAME: 'Informe seu nome.',
  RATE_LIMITED: 'Muitas solicitações. Aguarde um pouco ou fale com a loja pelo WhatsApp.',
  BOOKING_UNAVAILABLE: 'O agendamento online está indisponível no momento.',
  SERVICE_NOT_FOUND: 'Serviço indisponível.',
  INVALID_DATE: 'Data ou horário inválido.',
}

export function PublicStorePage() {
  const { slug = '' } = useParams()
  const store = useQuery({
    queryKey: ['public-store', slug],
    queryFn: async () => {
      const res = await fetch(`${FN}?slug=${encodeURIComponent(slug)}`, { headers })
      if (res.status === 404) return null
      if (!res.ok) throw new Error('UNAVAILABLE')
      return (await res.json()) as StoreData
    },
    retry: 1,
  })
  useDocumentTitle(store.data?.name ?? 'Loja')

  if (store.isLoading) return <div className="grid min-h-dvh place-items-center bg-bg"><Loader2 className="size-6 animate-spin text-subtle" /></div>
  if (!store.data) {
    return (
      <div className="grid min-h-dvh place-items-center bg-bg px-5 text-center">
        <div>
          <Store className="mx-auto size-8 text-subtle" />
          <h1 className="mt-4 text-lg font-semibold">Loja não encontrada</h1>
          <p className="mt-2 text-sm text-muted">{store.error ? 'Não foi possível carregar agora. Tente novamente em instantes.' : 'O endereço pode estar incorreto ou a loja não está publicada.'}</p>
        </div>
      </div>
    )
  }
  return <Storefront slug={slug} s={store.data} />
}

function Storefront({ slug, s }: { slug: string; s: StoreData }) {
  const bookable = s.services.filter((x) => x.bookable)
  const [tab, setTab] = React.useState<'agendar' | 'servicos' | 'produtos'>(s.booking_enabled && bookable.length ? 'agendar' : s.services.length ? 'servicos' : 'produtos')
  const logo = s.logo_path ? `${BASE}/storage/v1/object/public/org-logos/${s.logo_path}` : null
  const wa = buildWhatsAppLink(s.whatsapp, `Olá! Vi a página da ${s.name} e gostaria de mais informações.`)
  const tabs = [
    s.booking_enabled && bookable.length ? { id: 'agendar' as const, label: 'Agendar', icon: CalendarCheck } : null,
    s.services.length ? { id: 'servicos' as const, label: 'Serviços', icon: Scissors } : null,
    s.catalog_enabled && s.products.length ? { id: 'produtos' as const, label: 'Produtos', icon: Package } : null,
  ].filter(Boolean) as { id: 'agendar' | 'servicos' | 'produtos'; label: string; icon: typeof Package }[]

  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-5 py-6 sm:flex-row sm:items-center">
          {logo ? <img src={logo} alt="" className="size-16 rounded-xl border border-border object-cover" /> : (
            <div className="grid size-16 place-items-center rounded-xl border border-border bg-surface-2 text-xl font-semibold text-brand">{s.name.slice(0, 1)}</div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight">{s.name}</h1>
            {s.description && <p className="mt-1 text-sm text-muted">{s.description}</p>}
            {(s.address || s.city) && <p className="mt-1 flex items-center gap-1 text-xs text-subtle"><MapPin className="size-3.5" />{[s.address, s.city && `${s.city}${s.state ? `/${s.state}` : ''}`].filter(Boolean).join(' · ')}</p>}
          </div>
          {wa && <Button variant="whatsapp" asChild><a href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle /> WhatsApp</a></Button>}
        </div>
        <nav className="mx-auto flex max-w-3xl gap-1 px-5" aria-label="Seções da loja">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => setTab(id)}
              className={cn('flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors', tab === id ? 'border-brand text-fg' : 'border-transparent text-muted hover:text-fg')}>
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-6">
        {tab === 'agendar' && <Booking slug={slug} s={s} services={bookable} />}
        {tab === 'servicos' && (
          <div className="grid gap-3 sm:grid-cols-2">
            {s.services.map((x) => (
              <div key={x.id} className="rounded-lg border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{x.name}</div>
                    <div className="text-xs text-subtle">{SERVICE_CATEGORY[x.category]} · {x.duration_minutes} min</div>
                  </div>
                  {x.price != null && <div className="font-semibold tabular text-brand">{formatCurrency(x.price)}</div>}
                </div>
                {x.description && <p className="mt-2 text-[13px] text-muted">{x.description}</p>}
                {x.bookable && <Button size="sm" variant="secondary" className="mt-3" onClick={() => setTab('agendar')}>Agendar</Button>}
              </div>
            ))}
          </div>
        )}
        {tab === 'produtos' && <Catalog s={s} />}

        <section className="mt-10 rounded-lg border border-border bg-surface p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Clock className="size-4 text-subtle" /> Horário de funcionamento</h2>
          <div className="mt-3 grid gap-1 text-[13px] sm:grid-cols-2">
            {WEEKDAYS.map((d, i) => {
              const h = s.business_hours?.[String(i)]
              return <div key={d} className="flex justify-between gap-4"><span className="text-muted">{d}</span><span className="tabular">{h ? `${h[0]} – ${h[1]}` : 'Fechado'}</span></div>
            })}
          </div>
        </section>
        <p className="mt-6 text-center text-[11px] text-subtle">Página criada com VoltaCerta</p>
      </main>
    </div>
  )
}

function Catalog({ s }: { s: StoreData }) {
  const [cat, setCat] = React.useState<ProductCategory | ''>('')
  const cats = [...new Set(s.products.map((p) => p.category))]
  const list = s.products.filter((p) => !cat || p.category === cat)
  return (
    <>
      {cats.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <Chip active={!cat} onClick={() => setCat('')}>Todos</Chip>
          {cats.map((c) => <Chip key={c} active={cat === c} onClick={() => setCat(c)}>{CATEGORY[c]}</Chip>)}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {list.map((p) => {
          const link = buildWhatsAppLink(s.whatsapp, `Olá! Tenho interesse em: ${p.name}${p.brand ? ` (${p.brand})` : ''}. Está disponível?`)
          return (
            <div key={p.id} className="flex flex-col rounded-lg border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-subtle">{[p.brand, p.size_value ? `${formatNumber(p.size_value)} ${UNIT[p.unit]}` : null].filter(Boolean).join(' · ')}</div>
                </div>
                {p.price != null && <div className="shrink-0 font-semibold tabular text-brand">{formatCurrency(p.price)}</div>}
              </div>
              {p.description && <p className="mt-2 text-[13px] text-muted">{p.description}</p>}
              <div className="mt-auto flex items-center justify-between pt-3">
                {p.available === false ? <span className="text-xs text-warning">Sob encomenda</span> : <span className="text-xs text-subtle">{p.available ? 'Disponível' : ''}</span>}
                {link && <Button size="sm" variant="whatsapp" asChild><a href={link} target="_blank" rel="noopener noreferrer"><MessageCircle /> Pedir</a></Button>}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn('h-8 rounded-full border px-3 text-[12.5px]', active ? 'border-brand/40 bg-brand/10 text-brand' : 'border-border text-muted hover:text-fg')}>
      {children}
    </button>
  )
}

function Booking({ slug, s, services }: { slug: string; s: StoreData; services: StoreData['services'] }) {
  const [serviceId, setServiceId] = React.useState(services[0]?.id ?? '')
  const days = Array.from({ length: Math.min(s.booking_days_ahead, 30) + 1 }, (_, i) => addDaysISO(s.today, i))
    .filter((d) => s.business_hours?.[String(new Date(d + 'T12:00:00Z').getUTCDay())])
  const [date, setDate] = React.useState(days[0] ?? s.today)
  const [time, setTime] = React.useState('')
  const [form, setForm] = React.useState({ name: '', phone: '', pet: '', notes: '', website: '' })
  const [error, setError] = React.useState<string | null>(null)
  const [sending, setSending] = React.useState(false)
  const [done, setDone] = React.useState<{ service: string; date: string; time: string } | null>(null)

  const slots = useQuery({
    queryKey: ['public-slots', slug, serviceId, date],
    enabled: !!serviceId && !!date,
    queryFn: async () => {
      const res = await fetch(`${FN}?slug=${encodeURIComponent(slug)}&service=${serviceId}&date=${date}`, { headers })
      if (!res.ok) throw new Error('UNAVAILABLE')
      return ((await res.json()) as { slots: string[] }).slots
    },
  })
  React.useEffect(() => setTime(''), [serviceId, date])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!time) return setError('Escolha um horário.')
    if (form.name.trim().length < 2) return setError(ERRORS.INVALID_NAME)
    if (form.phone.replace(/\D/g, '').length < 10) return setError(ERRORS.INVALID_PHONE)
    setSending(true)
    try {
      const res = await fetch(FN, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, service_id: serviceId, date, time, name: form.name, phone: form.phone, pet_name: form.pet, notes: form.notes, website: form.website }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(ERRORS[body.error] ?? 'Não foi possível enviar agora. Tente novamente ou fale pelo WhatsApp.')
        if (body.error === 'SLOT_UNAVAILABLE') slots.refetch()
        return
      }
      setDone({ service: services.find((x) => x.id === serviceId)?.name ?? '', date, time })
    } catch {
      setError('Falha de conexão. Verifique sua internet.')
    } finally {
      setSending(false)
    }
  }

  if (done) {
    const wa = buildWhatsAppLink(s.whatsapp, `Olá! Acabei de solicitar ${done.service} para ${formatDate(done.date)} às ${done.time} pelo site. Meu nome é ${form.name}.`)
    return (
      <div className="rounded-lg border border-brand/30 bg-surface p-6 text-center">
        <CheckCircle2 className="mx-auto size-10 text-brand" />
        <h2 className="mt-3 text-lg font-semibold">Solicitação enviada!</h2>
        <p className="mt-2 text-sm text-muted">{done.service} em {formatDate(done.date)} às {done.time}. A {s.name} vai confirmar o horário com você pelo WhatsApp.</p>
        {wa && <Button variant="whatsapp" className="mt-4" asChild><a href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle /> Avisar a loja pelo WhatsApp</a></Button>}
        <div><Button variant="ghost" className="mt-2" onClick={() => { setDone(null); setTime(''); slots.refetch() }}>Fazer outro agendamento</Button></div>
      </div>
    )
  }

  const svc = services.find((x) => x.id === serviceId)
  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Field label="Serviço" htmlFor="b-svc">
        <Select id="b-svc" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          {services.map((x) => <option key={x.id} value={x.id}>{x.name}{x.price != null ? ` — ${formatCurrency(x.price)}` : ''} · {x.duration_minutes} min</option>)}
        </Select>
      </Field>
      {svc?.description && <p className="-mt-3 text-xs text-subtle">{svc.description}</p>}
      <div>
        <div className="mb-2 text-[13px] font-medium">Dia</div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {days.map((d) => {
            const wd = new Date(d + 'T12:00:00Z').getUTCDay()
            return (
              <button key={d} type="button" onClick={() => setDate(d)}
                className={cn('flex w-14 shrink-0 flex-col items-center rounded-md border py-2 text-xs transition-colors', date === d ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:text-fg')}>
                <span>{d === s.today ? 'Hoje' : WEEKDAYS_SHORT[wd]}</span>
                <span className="text-base font-semibold text-fg">{d.slice(8, 10)}</span>
                <span>{d.slice(5, 7)}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div>
        <div className="mb-2 text-[13px] font-medium">Horário</div>
        {slots.isLoading ? <Loader2 className="size-5 animate-spin text-subtle" /> : !slots.data?.length ? (
          <p className="text-sm text-muted">Sem horários livres neste dia. Escolha outra data.</p>
        ) : (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {slots.data.map((t) => (
              <button key={t} type="button" onClick={() => setTime(t)}
                className={cn('h-9 rounded-md border text-sm tabular transition-colors', time === t ? 'border-brand bg-brand text-brand-fg' : 'border-border hover:border-brand/40')}>
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Seu nome" htmlFor="b-name"><Input id="b-name" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="WhatsApp" htmlFor="b-phone"><Input id="b-phone" inputMode="tel" autoComplete="tel" placeholder="(11) 99999-9999" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Nome do pet" htmlFor="b-pet" optional><Input id="b-pet" value={form.pet} onChange={(e) => setForm({ ...form, pet: e.target.value })} /></Field>
        <Field label="Observações" htmlFor="b-notes" optional><Textarea id="b-notes" rows={1} maxLength={500} placeholder="Porte, raça, cuidados…" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
      {/* Campo-armadilha para robôs (invisível para pessoas) */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} aria-hidden="true" />
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <Button type="submit" size="lg" className="w-full" loading={sending} disabled={!time}>
        <CalendarCheck /> Solicitar agendamento{time ? ` · ${formatDate(date).slice(0, 5)} às ${time}` : ''}
      </Button>
      <p className="text-center text-xs text-subtle">Ao enviar, você concorda em ser contatado pela loja para confirmar o agendamento.</p>
    </form>
  )
}
