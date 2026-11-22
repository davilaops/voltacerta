import * as React from 'react'
import { EllipsisVertical, Gift, Pencil, Plus, Power, Scissors, Trash2, UserRound } from 'lucide-react'
import { Badge, Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/input'
import { Dialog, useConfirm } from '@/components/ui/dialog'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu'
import { DataTable, EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/ui/states'
import { CustomerPicker, type PickedCustomer } from '@/components/shared/CustomerPicker'
import { PaymentEditor, usePayments } from '@/components/shared/PaymentEditor'
import { usePets } from '@/features/customers/api'
import { useOrg } from '@/features/org/OrgProvider'
import { WEEKDAYS_SHORT } from '@/domain/labels'
import { mergeOptions, professionalRoleLabel, serviceCategoryLabel, suggestionsFor, toStoredProfessionalRole, toStoredServiceCategory } from '@/domain/business'
import { CategoryInput } from '@/components/shared/CategoryInput'
import { formatCurrency } from '@/lib/format'
import { moneyInput, parseMoney } from '@/lib/money'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { cn, newRequestId } from '@/lib/utils'
import type { Professional, ProfessionalRole, Service, ServiceCategory, ServicePackage } from '@/types/models'
import {
  useDeleteProfessional, useDeleteService, usePackages, useProfessionals, useSavePackage, useSaveProfessional, useSaveService,
  useSellPackage, useServices,
} from './api'

export function ServicesPage() {
  useDocumentTitle('Serviços')
  const [tab, setTab] = React.useState('servicos')
  const [svcDialog, setSvcDialog] = React.useState<{ open: boolean; item: Service | null }>({ open: false, item: null })
  const [proDialog, setProDialog] = React.useState<{ open: boolean; item: Professional | null }>({ open: false, item: null })
  const [pkgDialog, setPkgDialog] = React.useState<{ open: boolean; item: ServicePackage | null }>({ open: false, item: null })
  const [sell, setSell] = React.useState(false)
  const { isAdmin } = useOrg()

  const action =
    tab === 'servicos' ? <Button onClick={() => setSvcDialog({ open: true, item: null })}><Plus /> Novo serviço</Button>
      : tab === 'profissionais' ? (isAdmin && <Button onClick={() => setProDialog({ open: true, item: null })}><Plus /> Novo profissional</Button>)
        : (
          <>
            <Button variant="secondary" onClick={() => setSell(true)}><Gift /> Vender pacote</Button>
            {isAdmin && <Button onClick={() => setPkgDialog({ open: true, item: null })}><Plus /> Novo pacote</Button>}
          </>
        )

  return (
    <>
      <PageHeader title="Serviços" description="Os serviços que você oferece, a equipe que atende e os pacotes vendidos aos clientes." actions={action} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="servicos">Serviços</TabsTrigger>
          <TabsTrigger value="profissionais">Profissionais</TabsTrigger>
          <TabsTrigger value="pacotes">Pacotes</TabsTrigger>
        </TabsList>
        <TabsContent value="servicos"><ServicesTab onEdit={(s) => setSvcDialog({ open: true, item: s })} onNew={() => setSvcDialog({ open: true, item: null })} /></TabsContent>
        <TabsContent value="profissionais"><ProfessionalsTab onEdit={(p) => setProDialog({ open: true, item: p })} onNew={() => setProDialog({ open: true, item: null })} /></TabsContent>
        <TabsContent value="pacotes"><PackagesTab onEdit={(p) => setPkgDialog({ open: true, item: p })} onNew={() => setPkgDialog({ open: true, item: null })} /></TabsContent>
      </Tabs>
      <ServiceDialog open={svcDialog.open} item={svcDialog.item} onOpenChange={(o) => setSvcDialog((s) => ({ ...s, open: o }))} />
      <ProfessionalDialog open={proDialog.open} item={proDialog.item} onOpenChange={(o) => setProDialog((s) => ({ ...s, open: o }))} />
      <PackageDialog open={pkgDialog.open} item={pkgDialog.item} onOpenChange={(o) => setPkgDialog((s) => ({ ...s, open: o }))} />
      <SellPackageDialog open={sell} onOpenChange={setSell} />
    </>
  )
}

// ---------------------------------------------------------------------
function ServicesTab({ onEdit, onNew }: { onEdit: (s: Service) => void; onNew: () => void }) {
  const q = useServices({ includeInactive: true })
  const save = useSaveService()
  const del = useDeleteService()
  const confirm = useConfirm()
  const { isAdmin } = useOrg()
  const toggle = (s: Service) => {
    const { id: _id, organization_id: _o, created_at: _c, ...values } = s
    save.mutate({ id: s.id, values: { ...values, active: !s.active } })
  }
  const actions = (s: Service) => (
    <Menu>
      <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Ações do serviço"><EllipsisVertical /></Button></MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={() => onEdit(s)}><Pencil /> Editar</MenuItem>
        <MenuItem onSelect={() => toggle(s)}><Power /> {s.active ? 'Desativar' : 'Ativar'}</MenuItem>
        {isAdmin && (
          <>
            <MenuSeparator />
            <MenuItem danger onSelect={async () => {
              if (await confirm({ title: `Excluir ${s.name}?`, description: 'Serviços com atendimentos ou vendas não podem ser excluídos — desative-os.', confirmLabel: 'Excluir', danger: true })) del.mutate(s.id)
            }}><Trash2 /> Excluir</MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  )
  return (
    <Card>
      {q.isLoading ? <TableSkeleton /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? (
        <EmptyState icon={Scissors} title="Nenhum serviço cadastrado" description="Cadastre os serviços que você oferece, com preço e duração, para usar na agenda e no caixa."
          action={<Button onClick={onNew}><Plus /> Cadastrar serviço</Button>} />
      ) : (
        <DataTable
          head={<><th>Serviço</th><th>Categoria</th><th>Preço</th><th>Duração</th><th>Retorno</th><th>Online</th><th className="w-12" /></>}
          mobile={q.data.map((s) => (
            <div key={s.id} className="flex items-start gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{s.name}</div>
                <div className="mt-0.5 text-xs text-muted">{serviceCategoryLabel(s.category)} · {formatCurrency(s.price)} · {s.duration_minutes} min</div>
                {!s.active && <Badge tone="muted" className="mt-2">Inativo</Badge>}
              </div>
              {actions(s)}
            </div>
          ))}
        >
          {q.data.map((s) => (
            <tr key={s.id} className={cn(!s.active && 'opacity-60')}>
              <td><div className="font-medium">{s.name}</div>{!s.active && <span className="text-xs text-subtle">Inativo</span>}</td>
              <td className="text-muted">{serviceCategoryLabel(s.category)}</td>
              <td className="tabular">{formatCurrency(s.price)}</td>
              <td className="tabular">{s.duration_minutes} min</td>
              <td className="tabular text-muted">{s.return_days ? `a cada ${s.return_days} dias` : '—'}</td>
              <td>{s.bookable_online ? <Badge tone="brand" dot>Agendável</Badge> : <Badge tone="muted">Só no balcão</Badge>}</td>
              <td>{actions(s)}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </Card>
  )
}

function ServiceDialog({ open, onOpenChange, item }: { open: boolean; onOpenChange: (o: boolean) => void; item: Service | null }) {
  const save = useSaveService()
  const { org, canWrite } = useOrg()
  const services = useServices({ includeInactive: true })
  const sugg = suggestionsFor(org.business_type)
  const options = mergeOptions(sugg.services, [...new Set((services.data ?? []).map((s) => s.category))].filter((c) => c !== 'outro'), serviceCategoryLabel)
  const [f, setF] = React.useState({ name: '', category: '' as ServiceCategory, price: '', duration: '60', returnDays: '', description: '', active: true, catalog: true, online: true })
  const [submitted, setSubmitted] = React.useState(false)
  React.useEffect(() => {
    if (!open) return
    setSubmitted(false)
    setF(item
      ? { name: item.name, category: item.category === 'outro' ? '' : serviceCategoryLabel(item.category), price: moneyInput(item.price), duration: String(item.duration_minutes), returnDays: item.return_days ? String(item.return_days) : '', description: item.description ?? '', active: item.active, catalog: item.catalog_visible, online: item.bookable_online }
      : { name: '', category: '', price: '', duration: '60', returnDays: '', description: '', active: true, catalog: true, online: true })
  }, [open, item])
  const price = parseMoney(f.price)
  const duration = Number(f.duration)
  const ret = f.returnDays ? Number(f.returnDays) : null
  const errors = {
    name: f.name.trim().length < 2 ? 'Informe o nome' : undefined,
    price: !(price >= 0) ? 'Valor inválido' : undefined,
    duration: !(Number.isInteger(duration) && duration >= 10 && duration <= 600) ? 'Entre 10 e 600 minutos' : undefined,
    returnDays: ret != null && !(Number.isInteger(ret) && ret >= 1 && ret <= 365) ? 'Entre 1 e 365 dias' : undefined,
  }
  const submit = () => {
    setSubmitted(true)
    if (Object.values(errors).some(Boolean)) return
    save.mutate({ id: item?.id, values: { name: f.name.trim(), category: toStoredServiceCategory(f.category), price, duration_minutes: duration, return_days: ret, description: f.description.trim() || null, active: f.active, catalog_visible: f.catalog, bookable_online: f.online } },
      { onSuccess: () => onOpenChange(false) })
  }
  const e: Partial<typeof errors> = submitted ? errors : {}
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={item ? 'Editar serviço' : 'Novo serviço'}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={submit} loading={save.isPending} disabled={!canWrite}>{item ? 'Salvar' : 'Cadastrar serviço'}</Button></>}>
      <div className="space-y-4">
        <Field label="Nome" htmlFor="sname" error={e.name}><Input id="sname" autoFocus placeholder={sugg.serviceExample} value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Categoria" htmlFor="scat" optional>
            <CategoryInput id="scat" options={options} value={f.category} onChange={(ev) => setF({ ...f, category: ev.target.value })} />
          </Field>
          <Field label="Preço (R$)" htmlFor="sprice" error={e.price}><Input id="sprice" inputMode="decimal" placeholder="0,00" value={f.price} onChange={(ev) => setF({ ...f, price: ev.target.value })} /></Field>
          <Field label="Duração (min)" htmlFor="sdur" error={e.duration}><Input id="sdur" inputMode="numeric" value={f.duration} onChange={(ev) => setF({ ...f, duration: ev.target.value })} /></Field>
        </div>
        <Field label="Retorno sugerido (dias)" htmlFor="sret" optional error={e.returnDays} hint="Ex.: 30 para um serviço mensal. Gera o lembrete “hora de voltar”.">
          <Input id="sret" inputMode="numeric" value={f.returnDays} onChange={(ev) => setF({ ...f, returnDays: ev.target.value })} />
        </Field>
        <Field label="Descrição" htmlFor="sdesc" optional><Textarea id="sdesc" rows={2} maxLength={1000} value={f.description} onChange={(ev) => setF({ ...f, description: ev.target.value })} /></Field>
        <div className="space-y-3">
          <Checkbox label="Pode ser agendado online" description="Aparece na página de agendamento da sua loja." checked={f.online} onChange={(ev) => setF({ ...f, online: ev.target.checked })} />
          <Checkbox label="Mostrar no catálogo" checked={f.catalog} onChange={(ev) => setF({ ...f, catalog: ev.target.checked })} />
          <Checkbox label="Serviço ativo" checked={f.active} onChange={(ev) => setF({ ...f, active: ev.target.checked })} />
        </div>
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------
function ProfessionalsTab({ onEdit, onNew }: { onEdit: (p: Professional) => void; onNew: () => void }) {
  const q = useProfessionals({ includeInactive: true })
  const del = useDeleteProfessional()
  const confirm = useConfirm()
  const { isAdmin } = useOrg()
  return (
    <Card>
      {q.isLoading ? <TableSkeleton /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? (
        <EmptyState icon={UserRound} title="Nenhum profissional cadastrado" description="Cadastre a equipe com os dias e horários de trabalho. A agenda usa isso para evitar conflitos e mostrar horários livres."
          action={isAdmin ? <Button onClick={onNew}><Plus /> Cadastrar profissional</Button> : undefined} />
      ) : (
        <div className="divide-y divide-border">
          {q.data.map((p) => (
            <div key={p.id} className={cn('flex items-center gap-3 px-5 py-3.5', !p.active && 'opacity-60')}>
              <span className="size-3 shrink-0 rounded-full" style={{ background: p.color }} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{p.name} {!p.active && <span className="text-xs text-subtle">(inativo)</span>}</div>
                <div className="text-xs text-muted">
                  {professionalRoleLabel(p.role)} · {p.work_days.slice().sort().map((d) => WEEKDAYS_SHORT[d]).join(', ')} · {p.work_start.slice(0, 5)}–{p.work_end.slice(0, 5)}
                </div>
              </div>
              {isAdmin && (
                <Menu>
                  <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Ações"><EllipsisVertical /></Button></MenuTrigger>
                  <MenuContent>
                    <MenuItem onSelect={() => onEdit(p)}><Pencil /> Editar</MenuItem>
                    <MenuSeparator />
                    <MenuItem danger onSelect={async () => {
                      if (await confirm({ title: `Remover ${p.name}?`, description: 'Os atendimentos dessa pessoa continuam na agenda, sem profissional definido. Para manter o histórico, prefira desativar.', confirmLabel: 'Remover', danger: true })) del.mutate(p.id)
                    }}><Trash2 /> Remover</MenuItem>
                  </MenuContent>
                </Menu>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

const COLORS = ['#22c58b', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#ef4444', '#64748b']

function ProfessionalDialog({ open, onOpenChange, item }: { open: boolean; onOpenChange: (o: boolean) => void; item: Professional | null }) {
  const save = useSaveProfessional()
  const { org } = useOrg()
  const pros = useProfessionals({ includeInactive: true })
  const roleOptions = mergeOptions(suggestionsFor(org.business_type).roles, [...new Set((pros.data ?? []).map((p) => p.role))].filter((r) => r !== 'outro'), professionalRoleLabel)
  const [f, setF] = React.useState({ name: '', role: '' as ProfessionalRole, phone: '', color: COLORS[0], days: [1, 2, 3, 4, 5, 6], start: '08:00', end: '18:00', active: true })
  const [submitted, setSubmitted] = React.useState(false)
  React.useEffect(() => {
    if (!open) return
    setSubmitted(false)
    setF(item
      ? { name: item.name, role: item.role === 'outro' ? '' : professionalRoleLabel(item.role), phone: item.phone ?? '', color: item.color, days: item.work_days, start: item.work_start.slice(0, 5), end: item.work_end.slice(0, 5), active: item.active }
      : { name: '', role: '', phone: '', color: COLORS[Math.floor(Math.random() * COLORS.length)], days: [1, 2, 3, 4, 5, 6], start: '08:00', end: '18:00', active: true })
  }, [open, item])
  const errors = {
    name: f.name.trim().length < 2 ? 'Informe o nome' : undefined,
    days: !f.days.length ? 'Escolha ao menos um dia' : undefined,
    hours: !(f.start < f.end) ? 'O fim deve ser depois do início' : undefined,
  }
  const submit = () => {
    setSubmitted(true)
    if (Object.values(errors).some(Boolean)) return
    save.mutate({ id: item?.id, values: { name: f.name.trim(), role: toStoredProfessionalRole(f.role), phone: f.phone.trim() || null, color: f.color, work_days: f.days, work_start: f.start, work_end: f.end, active: f.active } },
      { onSuccess: () => onOpenChange(false) })
  }
  const e: Partial<typeof errors> = submitted ? errors : {}
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={item ? 'Editar profissional' : 'Novo profissional'}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={submit} loading={save.isPending}>{item ? 'Salvar' : 'Cadastrar'}</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" htmlFor="pname" error={e.name}><Input id="pname" autoFocus value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} /></Field>
          <Field label="Função" htmlFor="prole" optional>
            <CategoryInput id="prole" options={roleOptions} value={f.role} onChange={(ev) => setF({ ...f, role: ev.target.value })} />
          </Field>
        </div>
        <Field label="Dias de trabalho" error={e.days}>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS_SHORT.map((d, i) => {
              const on = f.days.includes(i)
              return (
                <button key={d} type="button" onClick={() => setF({ ...f, days: on ? f.days.filter((x) => x !== i) : [...f.days, i] })}
                  className={cn('h-8 rounded-md border px-3 text-[13px] transition-colors', on ? 'border-brand/40 bg-brand/10 text-brand' : 'border-border text-muted hover:text-fg')}>
                  {d}
                </button>
              )
            })}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Início" htmlFor="pstart" error={e.hours}><Input id="pstart" type="time" value={f.start} onChange={(ev) => setF({ ...f, start: ev.target.value })} /></Field>
          <Field label="Fim" htmlFor="pend"><Input id="pend" type="time" value={f.end} onChange={(ev) => setF({ ...f, end: ev.target.value })} /></Field>
          <Field label="Telefone" htmlFor="pphone" optional className="col-span-2 sm:col-span-1"><Input id="pphone" inputMode="tel" value={f.phone} onChange={(ev) => setF({ ...f, phone: ev.target.value })} /></Field>
        </div>
        <Field label="Cor na agenda">
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button key={c} type="button" aria-label={`Cor ${c}`} onClick={() => setF({ ...f, color: c })}
                className={cn('size-7 rounded-full border-2', f.color === c ? 'border-fg' : 'border-transparent')} style={{ background: c }} />
            ))}
          </div>
        </Field>
        <Checkbox label="Profissional ativo" checked={f.active} onChange={(ev) => setF({ ...f, active: ev.target.checked })} />
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------
function PackagesTab({ onEdit, onNew }: { onEdit: (p: ServicePackage) => void; onNew: () => void }) {
  const q = usePackages({ includeInactive: true })
  const save = useSavePackage()
  const { isAdmin } = useOrg()
  return (
    <Card>
      {q.isLoading ? <TableSkeleton /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? (
        <EmptyState icon={Gift} title="Nenhum pacote cadastrado" description="Crie pacotes como “4 sessões por mês” com preço fechado. O saldo de sessões de cada cliente é controlado automaticamente na agenda."
          action={isAdmin ? <Button onClick={onNew}><Plus /> Cadastrar pacote</Button> : undefined} />
      ) : (
        <DataTable head={<><th>Pacote</th><th>Serviço</th><th>Sessões</th><th>Preço</th><th>Por sessão</th><th>Validade</th><th className="w-12" /></>}>
          {q.data.map((p) => (
            <tr key={p.id} className={cn(!p.active && 'opacity-60')}>
              <td className="font-medium">{p.name}{!p.active && <span className="ml-2 text-xs text-subtle">(inativo)</span>}</td>
              <td className="text-muted">{p.services?.name}</td>
              <td className="tabular">{p.sessions}</td>
              <td className="tabular">{formatCurrency(p.price)}</td>
              <td className="tabular text-muted">{formatCurrency(Number(p.price) / p.sessions)}</td>
              <td className="tabular text-muted">{p.validity_days} dias</td>
              <td>
                {isAdmin && (
                  <Menu>
                    <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Ações"><EllipsisVertical /></Button></MenuTrigger>
                    <MenuContent>
                      <MenuItem onSelect={() => onEdit(p)}><Pencil /> Editar</MenuItem>
                      <MenuItem onSelect={() => save.mutate({ id: p.id, values: { name: p.name, service_id: p.service_id, sessions: p.sessions, price: p.price, validity_days: p.validity_days, active: !p.active } })}>
                        <Power /> {p.active ? 'Desativar' : 'Ativar'}
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </Card>
  )
}

function PackageDialog({ open, onOpenChange, item }: { open: boolean; onOpenChange: (o: boolean) => void; item: ServicePackage | null }) {
  const save = useSavePackage()
  const services = useServices()
  const [f, setF] = React.useState({ name: '', service_id: '', sessions: '4', price: '', validity: '30', active: true })
  const [submitted, setSubmitted] = React.useState(false)
  React.useEffect(() => {
    if (!open) return
    setSubmitted(false)
    setF(item
      ? { name: item.name, service_id: item.service_id, sessions: String(item.sessions), price: moneyInput(item.price), validity: String(item.validity_days), active: item.active }
      : { name: '', service_id: '', sessions: '4', price: '', validity: '30', active: true })
  }, [open, item])
  const sessions = Number(f.sessions)
  const price = parseMoney(f.price)
  const validity = Number(f.validity)
  const svc = services.data?.find((s) => s.id === f.service_id)
  const errors = {
    name: f.name.trim().length < 2 ? 'Informe o nome' : undefined,
    service: !f.service_id ? 'Escolha o serviço' : undefined,
    sessions: !(Number.isInteger(sessions) && sessions >= 1 && sessions <= 100) ? 'Entre 1 e 100' : undefined,
    price: !(price >= 0) ? 'Valor inválido' : undefined,
    validity: !(Number.isInteger(validity) && validity >= 1 && validity <= 730) ? 'Entre 1 e 730 dias' : undefined,
  }
  const submit = () => {
    setSubmitted(true)
    if (Object.values(errors).some(Boolean)) return
    save.mutate({ id: item?.id, values: { name: f.name.trim(), service_id: f.service_id, sessions, price, validity_days: validity, active: f.active } }, { onSuccess: () => onOpenChange(false) })
  }
  const e: Partial<typeof errors> = submitted ? errors : {}
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={item ? 'Editar pacote' : 'Novo pacote'}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={submit} loading={save.isPending}>{item ? 'Salvar' : 'Cadastrar pacote'}</Button></>}>
      <div className="space-y-4">
        <Field label="Nome do pacote" htmlFor="kname" error={e.name}><Input id="kname" autoFocus placeholder="Ex.: Plano mensal — 4 sessões" value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} /></Field>
        <Field label="Serviço incluído" htmlFor="ksvc" error={e.service}>
          <Select id="ksvc" value={f.service_id} onChange={(ev) => setF({ ...f, service_id: ev.target.value })}>
            <option value="">Selecione</option>
            {services.data?.map((s) => <option key={s.id} value={s.id}>{s.name} — {formatCurrency(s.price)}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Sessões" htmlFor="kses" error={e.sessions}><Input id="kses" inputMode="numeric" value={f.sessions} onChange={(ev) => setF({ ...f, sessions: ev.target.value })} /></Field>
          <Field label="Preço (R$)" htmlFor="kprice" error={e.price}><Input id="kprice" inputMode="decimal" value={f.price} onChange={(ev) => setF({ ...f, price: ev.target.value })} /></Field>
          <Field label="Validade (dias)" htmlFor="kval" error={e.validity}><Input id="kval" inputMode="numeric" value={f.validity} onChange={(ev) => setF({ ...f, validity: ev.target.value })} /></Field>
        </div>
        {svc && price >= 0 && sessions > 0 && (
          <p className="text-[13px] text-muted">
            Avulso sairia {formatCurrency(Number(svc.price) * sessions)}. {price < Number(svc.price) * sessions && <span className="text-brand">Economia de {formatCurrency(Number(svc.price) * sessions - price)} para o cliente.</span>}
          </p>
        )}
        <Checkbox label="Pacote ativo (disponível para venda)" checked={f.active} onChange={(ev) => setF({ ...f, active: ev.target.checked })} />
      </div>
    </Dialog>
  )
}

export function SellPackageDialog({ open, onOpenChange, customer }: { open: boolean; onOpenChange: (o: boolean) => void; customer?: PickedCustomer | null }) {
  const { ctx, canWrite } = useOrg()
  const packages = usePackages()
  const sell = useSellPackage()
  const [cust, setCust] = React.useState<PickedCustomer | null>(customer ?? null)
  const pets = usePets(cust?.id)
  const [pkgId, setPkgId] = React.useState('')
  const [petId, setPetId] = React.useState('')
  const [requestId, setRequestId] = React.useState(newRequestId)
  const pkg = packages.data?.find((p) => p.id === pkgId)
  const total = Number(pkg?.price ?? 0)
  const pay = usePayments(total)
  const { reset } = pay
  React.useEffect(() => {
    if (!open) return
    setCust(customer ?? null)
    setPkgId('')
    setPetId('')
    setRequestId(newRequestId())
    reset()
  }, [open, customer, reset])
  const ready = cust && pkg && pay.valid && (!pay.hasFiado || pay.dueDate)
  const submit = () => {
    if (!ready) return
    sell.mutate({ customer_id: cust.id, pet_id: petId || null, package_id: pkg.id, payments: total > 0 ? pay.effective : [], due_date: pay.dueDate, request_id: requestId },
      { onSuccess: () => onOpenChange(false) })
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Vender pacote" description="O valor entra no financeiro agora; as sessões são descontadas a cada atendimento concluído."
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={submit} loading={sell.isPending} disabled={!ready || !canWrite}>Vender · {formatCurrency(total)}</Button></>}>
      <div className="space-y-4">
        <Field label="Cliente"><CustomerPicker value={cust} onChange={setCust} autoFocus={!customer} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pacote" htmlFor="sp-pkg">
            <Select id="sp-pkg" value={pkgId} onChange={(ev) => setPkgId(ev.target.value)}>
              <option value="">Selecione</option>
              {packages.data?.map((p) => <option key={p.id} value={p.id}>{p.name} — {formatCurrency(p.price)}</option>)}
            </Select>
          </Field>
          <Field label="Pet" htmlFor="sp-pet" optional>
            <Select id="sp-pet" value={petId} onChange={(ev) => setPetId(ev.target.value)} disabled={!cust}>
              <option value="">Qualquer pet do cliente</option>
              {pets.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </div>
        {pkg && <p className="text-[13px] text-muted">{pkg.sessions} sessões de {pkg.services?.name}, válidas por {pkg.validity_days} dias.</p>}
        {total > 0 && <Field label="Pagamento"><PaymentEditor total={total} state={pay} minDueDate={ctx.today} /></Field>}
      </div>
    </Dialog>
  )
}
