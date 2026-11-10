import * as React from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check } from 'lucide-react'
import { Logo } from '@/components/brand/Logo'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/input'
import { FullscreenLoader, useMemberships } from '@/features/org/OrgProvider'
import { useAuth } from '@/features/auth/AuthProvider'
import { rpc, supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { normalizePhone } from '@/lib/phone'
import { BR_STATES, BUSINESS_TYPE, CATEGORY } from '@/domain/labels'
import { cn } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

const STEPS = ['Estabelecimento', 'Responsável', 'Contato', 'Localização', 'Tipo', 'Primeiro produto', 'Primeiro cliente']
const STORAGE = 'vc.onboarding'

interface Draft {
  name: string
  owner: string
  phone: string
  city: string
  state: string
  type: string
}

export function OnboardingPage() {
  useDocumentTitle('Configurar estabelecimento')
  const { user } = useAuth()
  const memberships = useMemberships()
  const [params] = useSearchParams()
  const isNew = params.get('novo') === '1'
  const navigate = useNavigate()
  const qc = useQueryClient()
  const pendingOrg = memberships.data?.find((m) => !m.organizations.onboarding_completed && m.role === 'owner')?.organizations

  const [step, setStep] = React.useState(0)
  const [orgId, setOrgId] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<Draft>(() => {
    try {
      return { name: '', owner: (user?.user_metadata?.full_name as string) ?? '', phone: '', city: '', state: '', type: 'pet_shop', ...JSON.parse(sessionStorage.getItem(STORAGE) ?? '{}') }
    } catch {
      return { name: '', owner: '', phone: '', city: '', state: '', type: 'pet_shop' }
    }
  })
  const [product, setProduct] = React.useState({ name: '', category: 'racoes', price: '', days: '30' })
  const [customer, setCustomer] = React.useState({ name: '', phone: '' })

  React.useEffect(() => {
    if (pendingOrg && !orgId && !isNew) {
      setOrgId(pendingOrg.id)
      setStep(5)
    }
  }, [pendingOrg, orgId, isNew])
  React.useEffect(() => sessionStorage.setItem(STORAGE, JSON.stringify(draft)), [draft])

  if (memberships.isLoading) return <FullscreenLoader />
  if (!isNew && !pendingOrg && memberships.data?.length && !orgId) return <Navigate to="/app" replace />

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }))

  const validate = (): string | null => {
    if (step === 0 && draft.name.trim().length < 2) return 'Informe o nome do estabelecimento'
    if (step === 1 && draft.owner.trim().length < 2) return 'Informe o nome do responsável'
    if (step === 2 && draft.phone && !normalizePhone(draft.phone)) return 'Telefone inválido'
    return null
  }

  const createOrg = async () => {
    const id = await rpc<string>('create_organization', {
      p_name: draft.name,
      p_owner_name: draft.owner,
      p_phone: draft.phone || null,
      p_city: draft.city || null,
      p_state: draft.state || null,
      p_business_type: draft.type || null,
    })
    localStorage.setItem('vc.currentOrg', id)
    setOrgId(id)
    await qc.invalidateQueries({ queryKey: ['memberships'] })
    return id
  }

  const finish = async (id: string) => {
    await supabase.from('organizations').update({ onboarding_completed: true }).eq('id', id)
    sessionStorage.removeItem(STORAGE)
    await qc.invalidateQueries({ queryKey: ['memberships'] })
    toast.success('Tudo pronto! Bem-vindo ao VoltaCerta.')
    navigate('/app', { replace: true })
  }

  const next = async (skip = false) => {
    setError(null)
    const v = skip ? null : validate()
    if (v) return setError(v)
    setBusy(true)
    try {
      if (step === 4) {
        await createOrg()
        setStep(5)
      } else if (step === 5) {
        if (!skip) {
          if (product.name.trim().length < 2) throw new Error('Informe o nome do produto')
          const price = Number(product.price.replace(',', '.') || '0')
          const days = Number(product.days)
          if (!(price >= 0) || !(days >= 1 && days <= 365)) throw new Error('Verifique preço e duração (1 a 365 dias)')
          const { error } = await supabase.from('products').insert({ organization_id: orgId, name: product.name.trim(), category: product.category, price, avg_duration_days: days })
          if (error) throw error
        }
        setStep(6)
      } else if (step === 6) {
        if (!skip) {
          if (customer.name.trim().length < 2) throw new Error('Informe o nome do cliente')
          if (customer.phone && !normalizePhone(customer.phone)) throw new Error('Telefone inválido')
          const { error } = await supabase.from('customers').insert({ organization_id: orgId, full_name: customer.name.trim(), phone: customer.phone || null })
          if (error) throw error
        }
        await finish(orgId!)
      } else {
        setStep((s) => s + 1)
      }
    } catch (e) {
      const msg = e instanceof Error && !('code' in e) && !/[A-Z_]{6,}/.test(e.message) ? e.message : errorMessage(e)
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  const optional = step >= 2
  const canBack = step > 0 && step < 5

  return (
    <div className="min-h-dvh bg-bg px-5 py-8 sm:py-14">
      <div className="mx-auto max-w-lg">
        <Logo />
        <div className="mt-10 flex gap-1.5" aria-label={`Etapa ${step + 1} de ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <div key={s} className={cn('h-1 flex-1 rounded-full transition-colors duration-300', i <= step ? 'bg-brand' : 'bg-surface-3')} />
          ))}
        </div>
        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-subtle">Etapa {step + 1} de {STEPS.length} · {STEPS[step]}</p>

        <div key={step} className="mt-6 page-enter">
          {step === 0 && (
            <Step title="Qual é o nome do seu estabelecimento?" subtitle="É assim que ele aparecerá no painel e nas mensagens.">
              <Input autoFocus value={draft.name} onChange={set('name')} placeholder="Ex.: Pet Shop Amigo Fiel" onKeyDown={(e) => e.key === 'Enter' && next()} />
            </Step>
          )}
          {step === 1 && (
            <Step title="Quem é o responsável?">
              <Input autoFocus value={draft.owner} onChange={set('owner')} placeholder="Seu nome" onKeyDown={(e) => e.key === 'Enter' && next()} />
            </Step>
          )}
          {step === 2 && (
            <Step title="Telefone comercial" subtitle="Opcional. Usado no cadastro do estabelecimento.">
              <Input autoFocus type="tel" value={draft.phone} onChange={set('phone')} placeholder="(11) 3333-4444" />
            </Step>
          )}
          {step === 3 && (
            <Step title="Onde fica a loja?">
              <div className="grid grid-cols-[1fr_96px] gap-3">
                <Field label="Cidade" htmlFor="ob-city"><Input id="ob-city" autoFocus value={draft.city} onChange={set('city')} /></Field>
                <Field label="UF" htmlFor="ob-uf">
                  <Select id="ob-uf" value={draft.state} onChange={set('state')}>
                    <option value="">—</option>
                    {BR_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </Field>
              </div>
            </Step>
          )}
          {step === 4 && (
            <Step title="Qual é o tipo de estabelecimento?">
              <div className="grid gap-2 sm:grid-cols-2">
                {Object.entries(BUSINESS_TYPE).map(([k, v]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, type: k }))}
                    className={cn('flex items-center justify-between rounded-md border px-3 py-2.5 text-left text-sm transition-colors', draft.type === k ? 'border-brand/60 bg-brand/10 text-fg' : 'border-border text-muted hover:border-border-strong')}
                  >
                    {v}
                    {draft.type === k && <Check className="size-4 text-brand" />}
                  </button>
                ))}
              </div>
            </Step>
          )}
          {step === 5 && (
            <Step title="Cadastre seu primeiro produto" subtitle="A duração média é usada para prever quando o cliente vai precisar repor.">
              <div className="space-y-3">
                <Field label="Nome do produto" htmlFor="ob-p"><Input id="ob-p" autoFocus value={product.name} onChange={(e) => setProduct((p) => ({ ...p, name: e.target.value }))} placeholder="Ração Premium Adulto 15kg" /></Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Categoria" htmlFor="ob-c">
                    <Select id="ob-c" value={product.category} onChange={(e) => setProduct((p) => ({ ...p, category: e.target.value }))}>
                      {Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </Field>
                  <Field label="Preço (R$)" htmlFor="ob-pr"><Input id="ob-pr" inputMode="decimal" value={product.price} onChange={(e) => setProduct((p) => ({ ...p, price: e.target.value }))} placeholder="0,00" /></Field>
                  <Field label="Dura (dias)" htmlFor="ob-d"><Input id="ob-d" inputMode="numeric" value={product.days} onChange={(e) => setProduct((p) => ({ ...p, days: e.target.value }))} /></Field>
                </div>
              </div>
            </Step>
          )}
          {step === 6 && (
            <Step title="Cadastre seu primeiro cliente" subtitle="Você poderá adicionar pets e registrar compras em seguida.">
              <div className="space-y-3">
                <Field label="Nome completo" htmlFor="ob-cn"><Input id="ob-cn" autoFocus value={customer.name} onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))} /></Field>
                <Field label="Telefone (WhatsApp)" htmlFor="ob-cp" optional><Input id="ob-cp" type="tel" value={customer.phone} onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))} placeholder="(11) 98888-7777" /></Field>
              </div>
            </Step>
          )}
          {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
        </div>

        <div className="mt-8 flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => { setError(null); setStep((s) => s - 1) }} disabled={!canBack || busy} className={cn(!canBack && 'invisible')}>
            Voltar
          </Button>
          <div className="flex gap-2">
            {optional && (
              <Button variant="secondary" onClick={() => next(true)} disabled={busy}>
                Pular
              </Button>
            )}
            <Button onClick={() => next()} loading={busy}>
              {step === 4 ? 'Criar estabelecimento' : step === 6 ? 'Concluir' : 'Continuar'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Step({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
      {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
      <div className="mt-6">{children}</div>
    </div>
  )
}
