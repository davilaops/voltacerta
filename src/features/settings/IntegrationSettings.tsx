import * as React from 'react'
import { CheckCircle2, ExternalLink, FileText, MessageCircle, Send } from 'lucide-react'
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input, Select } from '@/components/ui/input'
import { ErrorState, TableSkeleton } from '@/components/ui/states'
import { useIntegrationSettings, useSaveFiscal, useSaveWhatsApp, useWhatsAppRun, useWhatsAppTest } from '@/features/integrations/api'
import { useOrg } from '@/features/org/OrgProvider'
import { AUTO_KIND } from '@/domain/labels'
import { formatDateTime } from '@/lib/format'
import { parseMoney } from '@/lib/money'
import type { AutoKind, IntegrationSettings as Settings } from '@/types/models'
import { ReadOnlyNotice } from './shared'

const PARAMS: Record<AutoKind, string> = {
  aniversario: '{{1}} nome do cliente, {{2}} nome do pet',
  pos_venda: '{{1}} nome do cliente',
  lembrete_agendamento: '{{1}} nome, {{2}} pet, {{3}} serviço, {{4}} data, {{5}} hora',
  retorno_servico: '{{1}} nome, {{2}} pet, {{3}} serviço',
  pacote_vencendo: '{{1}} nome, {{2}} pacote, {{3}} data de vencimento',
  recompra: '{{1}} nome, {{2}} produto',
}

export function IntegrationSettings() {
  const { isAdmin, refresh } = useOrg()
  const q = useIntegrationSettings(isAdmin)
  if (!isAdmin) return <ReadOnlyNotice />
  if (q.isLoading) return <Card><TableSkeleton rows={4} /></Card>
  if (q.error || !q.data) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
  return (
    <>
      <WhatsAppCard s={q.data} onSaved={refresh} />
      <FiscalCard s={q.data} onSaved={refresh} />
    </>
  )
}

function WhatsAppCard({ s, onSaved }: { s: Settings; onSaved: () => Promise<void> }) {
  const save = useSaveWhatsApp()
  const run = useWhatsAppRun()
  const test = useWhatsAppTest()
  const [f, setF] = React.useState({ enabled: s.whatsapp_enabled, phoneId: s.whatsapp_phone_number_id ?? '', token: '', kinds: s.whatsapp_auto_kinds, templates: s.whatsapp_templates })
  const [testPhone, setTestPhone] = React.useState('')
  const [testKind, setTestKind] = React.useState<AutoKind>('aniversario')
  React.useEffect(() => setF({ enabled: s.whatsapp_enabled, phoneId: s.whatsapp_phone_number_id ?? '', token: '', kinds: s.whatsapp_auto_kinds, templates: s.whatsapp_templates }), [s])
  const setTpl = (k: AutoKind, name: string) => {
    const t = { ...f.templates }
    if (name.trim()) t[k] = { name: name.trim().toLowerCase(), language: t[k]?.language ?? 'pt_BR' }
    else delete t[k]
    setF({ ...f, templates: t })
  }
  const submit = () => save.mutate(
    { enabled: f.enabled, phone_number_id: f.phoneId, token: f.token ? f.token : null, templates: f.templates, auto_kinds: f.kinds.filter((k) => f.templates[k]) },
    { onSuccess: () => { setF((st) => ({ ...st, token: '' })); onSaved() } },
  )
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><MessageCircle className="size-4 text-[#4ade80]" /> WhatsApp automático</span>}
        description="Envio automático pela API oficial do WhatsApp Business (Meta), sem você precisar clicar. Exige conta no Meta Business e modelos de mensagem aprovados."
        action={s.whatsapp_enabled ? <Badge tone="brand" dot>Ativo</Badge> : <Badge tone="muted">Desligado</Badge>}
      />
      <CardBody className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted">
          <li>Crie um app em <a className="text-brand hover:underline" href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer">developers.facebook.com <ExternalLink className="inline size-3" /></a> com o produto WhatsApp e conecte o número da loja.</li>
          <li>Copie o <strong className="text-fg">ID do número de telefone</strong> e gere um <strong className="text-fg">token permanente</strong> (usuário do sistema).</li>
          <li>No WhatsApp Manager, crie e aprove os modelos de mensagem com as variáveis na ordem indicada abaixo.</li>
        </ol>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ID do número de telefone" htmlFor="wa-id"><Input id="wa-id" inputMode="numeric" value={f.phoneId} onChange={(e) => setF({ ...f, phoneId: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Token de acesso" htmlFor="wa-tok" hint={s.whatsapp_has_token ? 'Já configurado. Preencha só para trocar.' : 'Guardado com segurança; nunca é exibido de novo.'}>
            <Input id="wa-tok" type="password" autoComplete="off" placeholder={s.whatsapp_has_token ? '••••••••••••' : ''} value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} />
          </Field>
        </div>
        <div className="space-y-2">
          <div className="text-[13px] font-medium">Mensagens automáticas</div>
          {(Object.keys(AUTO_KIND) as AutoKind[]).map((k) => (
            <div key={k} className="grid items-center gap-2 rounded-md border border-border bg-bg/40 p-3 sm:grid-cols-[240px_1fr]">
              <Checkbox label={AUTO_KIND[k]} checked={f.kinds.includes(k)}
                onChange={(e) => setF({ ...f, kinds: e.target.checked ? [...f.kinds, k] : f.kinds.filter((x) => x !== k) })} />
              <div>
                <Input aria-label={`Nome do modelo para ${AUTO_KIND[k]}`} placeholder="nome_do_modelo_aprovado" className="h-8 sm:h-8" value={f.templates[k]?.name ?? ''} onChange={(e) => setTpl(k, e.target.value)} />
                <p className="mt-1 text-[11px] text-subtle">Variáveis: {PARAMS[k]}</p>
              </div>
            </div>
          ))}
          <p className="text-xs text-subtle">Mensagens de relacionamento só vão para clientes com consentimento de contato marcado no cadastro. Quem pediu para não receber contato nunca recebe.</p>
        </div>
        <Checkbox label="Ativar envio automático" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-subtle">
            Últimos 30 dias: {s.dispatches_30d.sent} enviada(s){s.dispatches_30d.failed ? `, ${s.dispatches_30d.failed} com erro` : ''}
            {s.whatsapp_last_run_at ? ` · última execução ${formatDateTime(s.whatsapp_last_run_at)}` : ''}
          </span>
          <div className="flex gap-2">
            {s.whatsapp_enabled && <Button variant="secondary" loading={run.isPending} onClick={() => run.mutate()}><Send /> Enviar pendentes agora</Button>}
            <Button loading={save.isPending} onClick={submit}>Salvar WhatsApp</Button>
          </div>
        </div>
        {s.whatsapp_has_token && s.whatsapp_phone_number_id && (
          <div className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_220px_auto]">
            <Input aria-label="Telefone para teste" placeholder="Seu WhatsApp com DDD" inputMode="tel" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
            <Select aria-label="Modelo para teste" value={testKind} onChange={(e) => setTestKind(e.target.value as AutoKind)}>
              {(Object.keys(AUTO_KIND) as AutoKind[]).filter((k) => s.whatsapp_templates[k]).map((k) => <option key={k} value={k}>{AUTO_KIND[k]}</option>)}
            </Select>
            <Button variant="secondary" loading={test.isPending} disabled={!testPhone || !s.whatsapp_templates[testKind]} onClick={() => test.mutate({ phone: testPhone, kind: testKind })}>Enviar teste</Button>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function FiscalCard({ s, onSaved }: { s: Settings; onSaved: () => Promise<void> }) {
  const { role } = useOrg()
  const save = useSaveFiscal()
  const init = React.useCallback(() => ({
    enabled: s.fiscal_enabled, env: s.fiscal_environment, token: '', cnpj: s.fiscal_cnpj ?? '', ie: s.fiscal_ie ?? '', im: s.fiscal_im ?? '',
    city: s.fiscal_city_code ?? '', simples: s.fiscal_simples, csosn: s.fiscal_icms_situation, item: s.fiscal_service_item,
    taxCode: s.fiscal_municipal_tax_code ?? '', iss: s.fiscal_iss_rate != null ? String(s.fiscal_iss_rate).replace('.', ',') : '',
  }), [s])
  const [f, setF] = React.useState(init)
  React.useEffect(() => setF(init()), [init])
  const isOwner = role === 'owner'
  const iss = f.iss ? parseMoney(f.iss) : null
  const submit = () => save.mutate({
    enabled: f.enabled, environment: f.env, token: f.token || null, cnpj: f.cnpj, ie: f.ie, im: f.im, city_code: f.city,
    simples: f.simples, icms_situation: f.csosn, service_item: f.item, municipal_tax_code: f.taxCode, iss_rate: iss != null && iss >= 0 ? iss : null,
  }, { onSuccess: () => { setF((st) => ({ ...st, token: '' })); onSaved() } })
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><FileText className="size-4 text-info" /> Nota fiscal (NFC-e e NFS-e)</span>}
        description="Emissão pela Focus NFe: NFC-e para venda de produtos e NFS-e para serviços. Exige CNPJ, certificado digital A1 e cadastro na Focus NFe."
        action={s.fiscal_enabled ? <Badge tone="brand" dot>{s.fiscal_environment === 'producao' ? 'Produção' : 'Homologação (teste)'}</Badge> : <Badge tone="muted">Desligado</Badge>}
      />
      <CardBody className="space-y-4">
        {!isOwner && <p className="text-[13px] text-warning">Somente o proprietário pode alterar a configuração fiscal.</p>}
        <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted">
          <li>Crie a conta em <a className="text-brand hover:underline" href="https://focusnfe.com.br" target="_blank" rel="noopener noreferrer">focusnfe.com.br <ExternalLink className="inline size-3" /></a>, cadastre a empresa e envie o certificado A1.</li>
          <li>Para NFC-e, informe o CSC (código de segurança do contribuinte) no painel da Focus.</li>
          <li>Copie o token da empresa e cole abaixo. Comece em <strong className="text-fg">homologação</strong> para testar sem valor fiscal.</li>
          <li>Preencha o NCM de cada produto (cadastro do produto → dados fiscais).</li>
        </ol>
        <fieldset disabled={!isOwner} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Ambiente" htmlFor="fi-env">
              <Select id="fi-env" value={f.env} onChange={(e) => setF({ ...f, env: e.target.value as 'homologacao' | 'producao' })}>
                <option value="homologacao">Homologação (teste)</option>
                <option value="producao">Produção</option>
              </Select>
            </Field>
            <Field label="Token da empresa (Focus NFe)" htmlFor="fi-tok" className="sm:col-span-2" hint={s.fiscal_has_token ? 'Já configurado. Preencha só para trocar.' : undefined}>
              <Input id="fi-tok" type="password" autoComplete="off" placeholder={s.fiscal_has_token ? '••••••••••••' : ''} value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} />
            </Field>
            <Field label="CNPJ" htmlFor="fi-cnpj"><Input id="fi-cnpj" inputMode="numeric" value={f.cnpj} onChange={(e) => setF({ ...f, cnpj: e.target.value })} /></Field>
            <Field label="Inscrição estadual" htmlFor="fi-ie" optional><Input id="fi-ie" value={f.ie} onChange={(e) => setF({ ...f, ie: e.target.value })} /></Field>
            <Field label="Inscrição municipal" htmlFor="fi-im" optional hint="Obrigatória para NFS-e"><Input id="fi-im" value={f.im} onChange={(e) => setF({ ...f, im: e.target.value })} /></Field>
            <Field label="Código do município (IBGE)" htmlFor="fi-city" optional hint="7 dígitos. Ex.: São Paulo 3550308"><Input id="fi-city" inputMode="numeric" maxLength={7} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Situação tributária ICMS (CSOSN/CST)" htmlFor="fi-csosn" hint="Simples Nacional sem crédito: 102"><Input id="fi-csosn" inputMode="numeric" value={f.csosn} onChange={(e) => setF({ ...f, csosn: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Item da lista de serviço (LC 116)" htmlFor="fi-item" hint="Consulte seu contador (ex.: 05.08)"><Input id="fi-item" value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} /></Field>
            <Field label="Código tributário do município" htmlFor="fi-tax" optional><Input id="fi-tax" value={f.taxCode} onChange={(e) => setF({ ...f, taxCode: e.target.value })} /></Field>
            <Field label="Alíquota do ISS (%)" htmlFor="fi-iss" optional><Input id="fi-iss" inputMode="decimal" value={f.iss} onChange={(e) => setF({ ...f, iss: e.target.value })} /></Field>
          </div>
          <Checkbox label="Optante pelo Simples Nacional" checked={f.simples} onChange={(e) => setF({ ...f, simples: e.target.checked })} />
          <Checkbox label="Ativar emissão de notas" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
        </fieldset>
        <p className="text-xs text-subtle">A configuração tributária (CSOSN, alíquotas, NCM) deve ser validada pelo seu contador. As notas são emitidas na tela de Caixa ou em Compras.</p>
        {isOwner && (
          <div className="flex justify-end">
            <Button loading={save.isPending} onClick={submit}><CheckCircle2 /> Salvar nota fiscal</Button>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
