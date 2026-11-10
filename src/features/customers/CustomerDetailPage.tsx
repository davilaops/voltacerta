import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowLeft,
  CalendarClock,
  Download,
  EllipsisVertical,
  Mail,
  MessageCircle,
  Pencil,
  PawPrint,
  Phone,
  Plus,
  ShieldOff,
  ShoppingBag,
  Trash2,
  UserX,
} from 'lucide-react'
import { Badge, Card, CardBody, CardHeader, Skeleton } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/dialog'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { ResultBadge, SituationBadge, StageBadge } from '@/components/shared/badges'
import { CustomerDialog, PetDialog } from '@/components/shared/CustomerDialog'
import { ContactDialog, type ContactTarget } from '@/components/shared/ContactDialog'
import { PurchaseDialog } from '@/components/shared/PurchaseDialog'
import {
  exportCustomerData,
  useCustomer,
  useCustomerContacts,
  useCustomerPredictions,
  useCustomerPurchases,
  useDeleteCustomer,
  useDeletePet,
  usePets,
  useSavePet,
} from './api'
import { useDeletePurchase } from '@/features/purchases/api'
import { useSetPredictionStatus } from '@/features/replenishment/api'
import { useOrg } from '@/features/org/OrgProvider'
import { SPECIES } from '@/domain/labels'
import { formatCurrency, formatDate, formatDateTime, formatNumber, formatPhone, formatRelativeDays } from '@/lib/format'
import { downloadFile } from '@/lib/csv'
import { errorMessage } from '@/lib/errors'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import type { Pet, PredictionView } from '@/types/models'

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { org, isAdmin } = useOrg()
  const customer = useCustomer(id)
  const pets = usePets(id)
  const purchases = useCustomerPurchases(id)
  const predictions = useCustomerPredictions(id)
  const contacts = useCustomerContacts(id)
  const del = useDeleteCustomer()
  const savePet = useSavePet(id!)
  const deletePet = useDeletePet(id!)
  const deletePurchase = useDeletePurchase()
  const setStatus = useSetPredictionStatus()
  const [editOpen, setEditOpen] = React.useState(false)
  const [petDialog, setPetDialog] = React.useState<{ open: boolean; pet: Pet | null }>({ open: false, pet: null })
  const [purchaseOpen, setPurchaseOpen] = React.useState(false)
  const [contact, setContact] = React.useState<ContactTarget | null>(null)
  useDocumentTitle(customer.data?.full_name ?? 'Cliente')

  if (customer.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (customer.error) return <Card><ErrorState error={customer.error} onRetry={() => customer.refetch()} /></Card>
  if (!customer.data) {
    return (
      <Card>
        <EmptyState icon={UserX} title="Cliente não encontrado" description="Ele pode ter sido excluído ou pertence a outro estabelecimento." action={<Button asChild variant="secondary"><Link to="/app/clientes">Voltar para clientes</Link></Button>} />
      </Card>
    )
  }

  const c = customer.data
  const active = (predictions.data ?? []).filter((p) => p.status === 'open' || p.status === 'contacted').sort((a, b) => a.expected_date.localeCompare(b.expected_date))
  const recovered = (predictions.data ?? []).filter((p) => p.recovered)
  const productFreq = new Map<string, { name: string; count: number; qty: number }>()
  for (const p of purchases.data ?? [])
    for (const it of p.purchase_items ?? []) {
      const cur = productFreq.get(it.product_id) ?? { name: it.products?.name ?? '—', count: 0, qty: 0 }
      cur.count += 1
      cur.qty += Number(it.quantity)
      productFreq.set(it.product_id, cur)
    }
  const usual = [...productFreq.values()].sort((a, b) => b.count - a.count).slice(0, 5)

  const startContact = (p?: PredictionView) =>
    setContact({
      customerId: c.id,
      customerName: c.full_name,
      phone: c.phone,
      doNotContact: c.do_not_contact,
      predictionId: p?.id ?? null,
      productName: p?.product_name ?? c.last_product_name,
      petName: pets.data?.[0]?.name,
      overdue: p ? p.stage === 'atrasada' : c.situation === 'inativo' || c.situation === 'precisa_contato',
    })

  const onDelete = async () => {
    const ok = await confirm({
      title: 'Excluir cliente e todos os dados?',
      description: `Isso remove definitivamente ${c.full_name}, seus pets, compras, previsões e histórico de contatos. Use também para atender pedidos de exclusão (LGPD). Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir definitivamente',
      danger: true,
    })
    if (ok) del.mutate(c.id, { onSuccess: () => navigate('/app/clientes') })
  }

  const onExport = async () => {
    try {
      const data = await exportCustomerData(c.id)
      downloadFile(`dados-${c.full_name.toLowerCase().replace(/\s+/g, '-')}.json`, JSON.stringify(data, null, 2), 'application/json')
      toast.success('Dados exportados.')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <>
      <Link to="/app/clientes" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Clientes
      </Link>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{c.full_name}</h1>
            <SituationBadge situation={c.situation} />
            {c.do_not_contact && <Badge tone="danger"><ShieldOff className="size-3" /> Não contatar</Badge>}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
            {c.phone && <span className="inline-flex items-center gap-1.5"><Phone className="size-3.5" />{formatPhone(c.phone)}</span>}
            {c.email && <span className="inline-flex items-center gap-1.5"><Mail className="size-3.5" />{c.email}</span>}
            <span>Cliente desde {formatDate(c.created_at)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="whatsapp" onClick={() => startContact(active[0])} disabled={!c.phone}>
            <MessageCircle /> WhatsApp
          </Button>
          <Button onClick={() => setPurchaseOpen(true)}>
            <ShoppingBag /> Registrar compra
          </Button>
          <Menu>
            <MenuTrigger asChild>
              <Button variant="secondary" size="icon" aria-label="Mais ações"><EllipsisVertical /></Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => setEditOpen(true)}><Pencil /> Editar cadastro</MenuItem>
              <MenuItem onSelect={onExport}><Download /> Exportar dados (LGPD)</MenuItem>
              {isAdmin && (
                <>
                  <MenuSeparator />
                  <MenuItem danger onSelect={onDelete}><Trash2 /> Excluir cliente</MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: 'Compras', value: formatNumber(c.purchases_count) },
          { label: 'Total gasto', value: formatCurrency(c.total_spent) },
          { label: 'Última compra', value: formatDate(c.last_purchase_date) },
          { label: 'Próxima recompra', value: formatDate(c.next_expected_date) },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <div className="text-xs text-muted">{s.label}</div>
            <div className="mt-1 text-lg font-semibold tabular">{s.value}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Próximas recompras previstas" description="Calculadas a partir das compras e do histórico do cliente" />
            {predictions.isLoading ? (
              <CardBody><Skeleton className="h-16 w-full" /></CardBody>
            ) : active.length === 0 ? (
              <CardBody><p className="text-sm text-subtle">Nenhuma recompra prevista. Registre uma compra para gerar previsões.</p></CardBody>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {active.map((p) => (
                  <li key={p.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{p.product_name}</span>
                        <StageBadge stage={p.stage} />
                      </div>
                      <div className="mt-0.5 text-xs text-muted">
                        Previsão {formatDate(p.expected_date)} ({formatRelativeDays(p.days_until)}) · {formatNumber(p.quantity)} un. · potencial {formatCurrency(p.potential_value)}
                        {p.history_samples > 0 && p.history_days != null && <> · ajustada pelo histórico ({p.history_samples} intervalos)</>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: p.id, status: 'ignored' })}>Ignorar</Button>
                      <Button size="sm" variant="whatsapp" onClick={() => startContact(p)} disabled={!c.phone}><MessageCircle /> Contatar</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <Tabs defaultValue="compras">
              <TabsList className="px-3 pt-1">
                <TabsTrigger value="compras" count={purchases.data?.length}>Compras</TabsTrigger>
                <TabsTrigger value="contatos" count={contacts.data?.length}>Contatos</TabsTrigger>
                <TabsTrigger value="recuperadas" count={recovered.length}>Vendas recuperadas</TabsTrigger>
              </TabsList>
              <TabsContent value="compras">
                {purchases.isLoading ? (
                  <CardBody className="pt-4"><Skeleton className="h-24 w-full" /></CardBody>
                ) : !purchases.data?.length ? (
                  <EmptyState icon={ShoppingBag} title="Nenhuma compra registrada" description="Registre a primeira compra para iniciar as previsões de recompra." action={<Button size="sm" onClick={() => setPurchaseOpen(true)}><Plus /> Registrar compra</Button>} className="py-10" />
                ) : (
                  <ul className="divide-y divide-border">
                    {purchases.data.map((p) => (
                      <li key={p.id} className="flex items-start gap-3 px-5 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium tabular">{formatDate(p.purchase_date)}</span>
                            <span className="text-sm font-semibold tabular">{formatCurrency(p.total)}</span>
                          </div>
                          <ul className="mt-1 space-y-0.5 text-xs text-muted">
                            {p.purchase_items?.map((it) => (
                              <li key={it.id}>{formatNumber(it.quantity)}× {it.products?.name} · {formatCurrency(it.unit_price)}</li>
                            ))}
                          </ul>
                          {p.notes && <p className="mt-1 text-xs text-subtle">{p.notes}</p>}
                        </div>
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Excluir compra"
                            onClick={async () => {
                              const ok = await confirm({ title: 'Excluir compra?', description: 'As previsões geradas por esta compra serão removidas e as anteriores reabertas.', confirmLabel: 'Excluir', danger: true })
                              if (ok) deletePurchase.mutate(p.id)
                            }}
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
              <TabsContent value="contatos">
                {contacts.isLoading ? (
                  <CardBody className="pt-4"><Skeleton className="h-24 w-full" /></CardBody>
                ) : !contacts.data?.length ? (
                  <p className="px-5 py-8 text-center text-sm text-subtle">Nenhum contato registrado.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {contacts.data.map((l) => (
                      <li key={l.id} className="px-5 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs text-muted">{formatDateTime(l.contacted_at, org.timezone)} · {l.profiles?.full_name ?? l.profiles?.email ?? 'Usuário'}</span>
                          <ResultBadge result={l.result} />
                        </div>
                        {l.message && <p className="mt-1.5 rounded-md bg-surface-2/60 px-3 py-2 text-[13px] text-fg/85">{l.message}</p>}
                        {l.follow_up_date && <p className="mt-1 text-xs text-warning">Retornar em {formatDate(l.follow_up_date)}</p>}
                        {l.notes && <p className="mt-1 text-xs text-subtle">{l.notes}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
              <TabsContent value="recuperadas">
                {!recovered.length ? (
                  <p className="px-5 py-8 text-center text-sm text-subtle">Nenhuma venda recuperada ainda.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {recovered.map((p) => (
                      <li key={p.id} className="flex items-center justify-between px-5 py-3 text-sm">
                        <span>{p.product_name} <span className="text-xs text-muted">· concluída em {formatDate(p.completed_at)}</span></span>
                        <span className="font-semibold tabular text-brand">{formatCurrency(p.recovered_amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            </Tabs>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Pets" action={<Button size="sm" variant="ghost" onClick={() => setPetDialog({ open: true, pet: null })}><Plus /> Adicionar</Button>} />
            <CardBody>
              {pets.isLoading ? (
                <Skeleton className="h-12 w-full" />
              ) : !pets.data?.length ? (
                <p className="text-sm text-subtle">Nenhum pet cadastrado.</p>
              ) : (
                <ul className="space-y-2">
                  {pets.data.map((p) => (
                    <li key={p.id} className="group flex items-center gap-3 rounded-md border border-border px-3 py-2">
                      <span className="grid size-8 place-items-center rounded-md bg-surface-2 text-brand"><PawPrint className="size-4" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{p.name}</div>
                        <div className="text-xs text-muted">{SPECIES[p.species]}{p.breed && ` · ${p.breed}`}{p.birth_date && ` · nasc. ${formatDate(p.birth_date)}`}</div>
                      </div>
                      <Button variant="ghost" size="icon-sm" aria-label="Editar pet" onClick={() => setPetDialog({ open: true, pet: p })}><Pencil /></Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remover pet"
                        onClick={async () => {
                          if (await confirm({ title: `Remover ${p.name}?`, description: 'O pet será removido do cadastro do cliente.', confirmLabel: 'Remover', danger: true })) deletePet.mutate(p.id)
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Produtos que costuma comprar" />
            <CardBody>
              {!usual.length ? (
                <p className="text-sm text-subtle">Sem histórico ainda.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {usual.map((u) => (
                    <li key={u.name} className="flex items-center justify-between gap-3">
                      <span className="truncate">{u.name}</span>
                      <span className="shrink-0 text-xs text-muted tabular">{u.count}× compras</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Dados e privacidade" />
            <CardBody className="space-y-2 text-[13px] text-muted">
              <div className="flex justify-between"><span>Autorizou mensagens</span><span className="text-fg">{c.marketing_consent ? `Sim · ${formatDate(c.consent_updated_at)}` : 'Não informado'}</span></div>
              <div className="flex justify-between"><span>Oposição ao contato</span><span className="text-fg">{c.do_not_contact ? `Sim · ${formatDate(c.do_not_contact_at)}` : 'Não'}</span></div>
              {c.notes && <p className="border-t border-border pt-2 text-fg/80">{c.notes}</p>}
            </CardBody>
          </Card>
          <Card className="p-4">
            <div className="flex items-start gap-3 text-[13px] text-muted">
              <CalendarClock className="mt-0.5 size-4 shrink-0 text-brand" />
              As previsões consideram a duração média de cada produto, a quantidade comprada e o intervalo real entre as compras deste cliente.
            </div>
          </Card>
        </div>
      </div>

      <CustomerDialog open={editOpen} onOpenChange={setEditOpen} customer={c} />
      <PetDialog
        open={petDialog.open}
        pet={petDialog.pet}
        onOpenChange={(o) => setPetDialog((s) => ({ ...s, open: o }))}
        loading={savePet.isPending}
        onSubmit={(values) => savePet.mutate({ id: petDialog.pet?.id, values }, { onSuccess: () => setPetDialog({ open: false, pet: null }) })}
      />
      <PurchaseDialog open={purchaseOpen} onOpenChange={setPurchaseOpen} customer={{ id: c.id, full_name: c.full_name }} />
      <ContactDialog target={contact} onClose={() => setContact(null)} />
    </>
  )
}
