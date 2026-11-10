import * as React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, History, MessageCircle, ShieldOff } from 'lucide-react'
import { Badge, Card, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu'
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/ui/states'
import { ResultBadge, StageBadge } from '@/components/shared/badges'
import { ContactDialog, type ContactTarget } from '@/components/shared/ContactDialog'
import { useRecoveryQueue } from '@/features/replenishment/api'
import { attachProfiles } from '@/features/customers/api'
import { useOrg } from '@/features/org/OrgProvider'
import { supabase, unwrap } from '@/lib/supabase'
import { formatCurrency, formatDate, formatDateTime, formatPhone, formatRelativeDays } from '@/lib/format'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import type { ContactLog, PredictionView } from '@/types/models'

type Group = 'atrasadas' | 'hoje' | 'proximas' | 'aguardando'

function useRecentContacts() {
  const { org } = useOrg()
  return useQuery({
    queryKey: ['contacts', 'recent', org.id],
    queryFn: async () => {
      const logs = unwrap(
        await supabase
          .from('contact_logs')
          .select('*, customers(full_name)')
          .eq('organization_id', org.id)
          .order('contacted_at', { ascending: false })
          .limit(50),
      ) as (ContactLog & { customers: { full_name: string } | null })[]
      return (await attachProfiles(logs)) as typeof logs
    },
  })
}

export function RecoveryPage() {
  useDocumentTitle('Recuperação de clientes')
  const { org } = useOrg()
  const queue = useRecoveryQueue()
  const recent = useRecentContacts()
  const [contact, setContact] = React.useState<ContactTarget | null>(null)

  const groups: Record<Group, PredictionView[]> = { atrasadas: [], hoje: [], proximas: [], aguardando: [] }
  for (const p of queue.data ?? []) {
    if (p.stage === 'atrasada') groups.atrasadas.push(p)
    else if (p.stage === 'hoje') groups.hoje.push(p)
    else if (p.stage === 'proxima') groups.proximas.push(p)
    else if (p.stage === 'contatada') groups.aguardando.push(p)
  }

  const open = (p: PredictionView) =>
    setContact({
      customerId: p.customer_id,
      customerName: p.customer_name,
      phone: p.customer_phone,
      doNotContact: p.customer_do_not_contact,
      predictionId: p.id,
      productName: p.product_name,
      petName: p.pet_name,
      overdue: p.stage === 'atrasada',
    })

  const List = ({ items, empty }: { items: PredictionView[]; empty: string }) =>
    items.length === 0 ? (
      <EmptyState icon={CheckCircle2} title="Nada por aqui" description={empty} className="py-10" />
    ) : (
      <ul className="divide-y divide-border">
        {items.map((p) => (
          <li key={p.id} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/app/clientes/${p.customer_id}`} className="text-sm font-medium hover:text-brand">{p.customer_name}</Link>
                <StageBadge stage={p.stage} />
                {p.customer_do_not_contact && <Badge tone="danger"><ShieldOff className="size-3" /> Não contatar</Badge>}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                <span>{formatPhone(p.customer_phone)}</span>
                <span>{p.product_name}{p.pet_name && ` para ${p.pet_name}`}</span>
                <span>Previsão {formatDate(p.expected_date)} ({formatRelativeDays(p.days_until)})</span>
                <span>Potencial {formatCurrency(p.potential_value)}</span>
              </div>
            </div>
            <Button variant="whatsapp" size="sm" disabled={!p.customer_phone || p.customer_do_not_contact} onClick={() => open(p)}>
              <MessageCircle /> {p.stage === 'contatada' ? 'Novo contato' : 'Contatar'}
            </Button>
          </li>
        ))}
      </ul>
    )

  const total = groups.atrasadas.length + groups.hoje.length + groups.proximas.length

  return (
    <>
      <PageHeader
        title="Recuperação de clientes"
        description="Clientes próximos da recompra ou atrasados. Contato individual pelo WhatsApp, registrado apenas após sua confirmação."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          {queue.isLoading ? (
            <TableSkeleton rows={5} cols={3} />
          ) : queue.error ? (
            <ErrorState error={queue.error} onRetry={() => queue.refetch()} />
          ) : (
            <Tabs defaultValue={groups.atrasadas.length ? 'atrasadas' : groups.hoje.length ? 'hoje' : 'proximas'}>
              <TabsList className="px-3 pt-1">
                <TabsTrigger value="atrasadas" count={groups.atrasadas.length}>Atrasadas</TabsTrigger>
                <TabsTrigger value="hoje" count={groups.hoje.length}>Para hoje</TabsTrigger>
                <TabsTrigger value="proximas" count={groups.proximas.length}>Próximas</TabsTrigger>
                <TabsTrigger value="aguardando" count={groups.aguardando.length}>Aguardando compra</TabsTrigger>
              </TabsList>
              <TabsContent value="atrasadas"><List items={groups.atrasadas} empty="Nenhum cliente com recompra atrasada." /></TabsContent>
              <TabsContent value="hoje"><List items={groups.hoje} empty="Nenhuma recompra prevista para hoje." /></TabsContent>
              <TabsContent value="proximas"><List items={groups.proximas} empty={`Nenhuma recompra nos próximos ${org.soon_days} dias.`} /></TabsContent>
              <TabsContent value="aguardando"><List items={groups.aguardando} empty="Nenhum cliente contatado aguardando compra." /></TabsContent>
            </Tabs>
          )}
          {!queue.isLoading && total === 0 && groups.aguardando.length === 0 && !queue.error && (
            <p className="border-t border-border px-5 py-3 text-xs text-subtle">
              Dica: cadastre a duração média dos produtos e registre as compras para alimentar esta lista.
            </p>
          )}
        </Card>

        <Card>
          <CardHeader title="Histórico de contatos" description="Últimos registros da equipe" />
          {recent.isLoading ? (
            <TableSkeleton rows={4} cols={1} />
          ) : recent.error ? (
            <ErrorState error={recent.error} onRetry={() => recent.refetch()} />
          ) : !recent.data?.length ? (
            <EmptyState icon={History} title="Sem contatos" description="Os contatos confirmados aparecem aqui." className="py-10" />
          ) : (
            <ul className="max-h-[560px] divide-y divide-border overflow-y-auto border-t border-border">
              {recent.data.map((l) => (
                <li key={l.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link to={`/app/clientes/${l.customer_id}`} className="truncate text-[13px] font-medium hover:text-brand">{l.customers?.full_name}</Link>
                    <ResultBadge result={l.result} />
                  </div>
                  <div className="mt-0.5 text-[11px] text-subtle">
                    {formatDateTime(l.contacted_at, org.timezone)} · {l.profiles?.full_name ?? l.profiles?.email ?? 'Usuário'}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <ContactDialog target={contact} onClose={() => setContact(null)} />
    </>
  )
}
