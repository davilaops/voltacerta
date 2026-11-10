import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, ShieldCheck, Trash2 } from 'lucide-react'
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/dialog'
import { Field, Textarea } from '@/components/ui/input'
import { useOrg } from '@/features/org/OrgProvider'
import { useAuth } from '@/features/auth/AuthProvider'
import { supabase, unwrap } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { downloadFile, toCsv } from '@/lib/csv'
import { formatDate, formatDateTime } from '@/lib/format'

export function PrivacySettings() {
  const { org, role, isAdmin } = useOrg()
  const { user } = useAuth()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [reason, setReason] = React.useState('')
  const [exporting, setExporting] = React.useState(false)

  const requests = useQuery({
    queryKey: ['deletion-requests', org.id],
    enabled: role === 'owner',
    queryFn: async () => unwrap(await supabase.from('data_deletion_requests').select('*').eq('organization_id', org.id).order('created_at', { ascending: false })) as { id: string; status: string; created_at: string }[],
  })
  const request = useMutation({
    mutationFn: async () => unwrap(await supabase.from('data_deletion_requests').insert({ organization_id: org.id, requested_by: user!.id, reason: reason || null }).select()),
    onSuccess: () => {
      toast.success('Solicitação registrada. Nossa equipe confirmará por e-mail antes de excluir.')
      setReason('')
      qc.invalidateQueries({ queryKey: ['deletion-requests'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const exportCustomers = async () => {
    setExporting(true)
    try {
      const rows: Record<string, unknown>[] = []
      for (let from = 0; ; from += 1000) {
        const batch = unwrap(
          await supabase.from('v_customers').select('full_name, phone, email, pet_names, purchases_count, total_spent, last_purchase_date, marketing_consent, do_not_contact, created_at').eq('organization_id', org.id).order('full_name').range(from, from + 999),
        ) as Record<string, unknown>[]
        rows.push(...batch)
        if (batch.length < 1000) break
      }
      const csv = toCsv(rows, [
        { key: 'full_name', label: 'Nome' },
        { key: 'phone', label: 'Telefone' },
        { key: 'email', label: 'E-mail' },
        { key: 'pet_names', label: 'Pets' },
        { key: 'purchases_count', label: 'Compras' },
        { key: 'total_spent', label: 'Total gasto', format: (v) => String(v ?? '').replace('.', ',') },
        { key: 'last_purchase_date', label: 'Última compra', format: (v) => (v ? formatDate(String(v)) : '') },
        { key: 'marketing_consent', label: 'Autorizou mensagens', format: (v) => (v ? 'Sim' : 'Não') },
        { key: 'do_not_contact', label: 'Não contatar', format: (v) => (v ? 'Sim' : 'Não') },
        { key: 'created_at', label: 'Cadastro', format: (v) => formatDateTime(String(v), org.timezone) },
      ])
      downloadFile(`clientes-${org.name.toLowerCase().replace(/\s+/g, '-')}.csv`, csv)
      toast.success(`${rows.length} clientes exportados.`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  const pending = requests.data?.find((r) => r.status === 'pending' || r.status === 'processing')

  return (
    <>
      <Card>
        <CardHeader title="Como tratamos os dados" />
        <CardBody className="space-y-2 text-[13px] leading-relaxed text-muted">
          <p className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" />Os dados dos seus clientes são usados exclusivamente para organizar compras, prever recompras e registrar contatos feitos pela sua equipe.</p>
          <p>Cada estabelecimento tem seus dados isolados no banco de dados. Nenhuma informação é compartilhada entre estabelecimentos.</p>
          <p>Registre no cadastro do cliente se ele autorizou mensagens e respeite pedidos de oposição ao contato — o sistema bloqueia contatos para clientes marcados como “não contatar”.</p>
          <p>Para atender um pedido de exclusão de um cliente, abra o cadastro dele e use “Excluir cliente”. Para pedidos de acesso, use “Exportar dados (LGPD)”.</p>
        </CardBody>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader title="Exportar dados" description="Planilha CSV com todos os clientes do estabelecimento." />
          <CardBody>
            <Button variant="secondary" onClick={exportCustomers} loading={exporting}><Download /> Exportar clientes (CSV)</Button>
          </CardBody>
        </Card>
      )}

      {role === 'owner' && (
        <Card className="border-danger/30">
          <CardHeader title="Excluir conta do estabelecimento" description="Solicita a exclusão definitiva de todos os dados deste estabelecimento." />
          <CardBody className="space-y-3">
            {pending ? (
              <div className="flex items-center gap-2 text-sm text-muted">
                <Badge tone="warning">Em análise</Badge> Solicitação enviada em {formatDate(pending.created_at)}.
              </div>
            ) : (
              <>
                <Field label="Motivo" htmlFor="reason" optional>
                  <Textarea id="reason" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
                <Button
                  variant="danger"
                  loading={request.isPending}
                  onClick={async () => {
                    if (await confirm({ title: 'Solicitar exclusão definitiva?', description: 'Após a confirmação pela nossa equipe, todos os clientes, compras e históricos serão excluídos e não poderão ser recuperados. Exporte seus dados antes, se precisar.', confirmLabel: 'Solicitar exclusão', danger: true }))
                      request.mutate()
                  }}
                >
                  <Trash2 /> Solicitar exclusão
                </Button>
              </>
            )}
          </CardBody>
        </Card>
      )}
    </>
  )
}
