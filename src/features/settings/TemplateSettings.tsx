import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Badge, Card, CardBody, CardHeader, Skeleton } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, useConfirm } from '@/components/ui/dialog'
import { Field, Input, Textarea } from '@/components/ui/input'
import { ErrorState } from '@/components/ui/states'
import { useTemplates } from '@/features/replenishment/api'
import { useOrg } from '@/features/org/OrgProvider'
import { rpc, supabase, unwrap } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { renderTemplate, TEMPLATE_VARIABLES } from '@/lib/whatsapp'
import type { MessageTemplate } from '@/types/models'
import { ReadOnlyNotice } from './shared'

export function TemplateSettings() {
  const { org, isAdmin } = useOrg()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const q = useTemplates()
  const [editing, setEditing] = React.useState<{ open: boolean; tpl: MessageTemplate | null }>({ open: false, tpl: null })
  const [name, setName] = React.useState('')
  const [body, setBody] = React.useState('')
  const bodyRef = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    if (editing.open) {
      setName(editing.tpl?.name ?? '')
      setBody(editing.tpl?.body ?? 'Olá, {nome}! ')
    }
  }, [editing])

  const invalidate = () => qc.invalidateQueries({ queryKey: ['templates'] })
  const save = useMutation({
    mutationFn: async () => {
      if (name.trim().length < 2) throw new Error('Informe um nome com ao menos 2 caracteres')
      if (body.trim().length < 5) throw new Error('A mensagem está muito curta')
      if (editing.tpl) unwrap(await supabase.from('message_templates').update({ name: name.trim(), body: body.trim() }).eq('id', editing.tpl.id).select())
      else unwrap(await supabase.from('message_templates').insert({ organization_id: org.id, name: name.trim(), body: body.trim(), kind: 'custom' }).select())
    },
    onSuccess: () => {
      toast.success('Modelo salvo.')
      setEditing({ open: false, tpl: null })
      invalidate()
    },
    onError: (e) => toast.error(e instanceof Error && !('code' in e) ? e.message : errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('message_templates').delete().eq('id', id).select()),
    onSuccess: () => { toast.success('Modelo excluído.'); invalidate() },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const restore = useMutation({
    mutationFn: () => rpc<void>('restore_default_templates', { p_org: org.id }),
    onSuccess: () => { toast.success('Modelos padrão restaurados.'); invalidate() },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const insertVar = (v: string) => {
    const el = bodyRef.current
    if (!el) return setBody((b) => b + v)
    const start = el.selectionStart
    const next = body.slice(0, start) + v + body.slice(el.selectionEnd)
    setBody(next)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + v.length, start + v.length) })
  }

  return (
    <>
      {!isAdmin && <ReadOnlyNotice />}
      <Card>
        <CardHeader
          title="Modelos de mensagem do WhatsApp"
          description="Variáveis são substituídas automaticamente no momento do contato."
          action={
            isAdmin && (
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  loading={restore.isPending}
                  onClick={async () => {
                    if (await confirm({ title: 'Restaurar modelos padrão?', description: 'Os 3 modelos padrão voltam ao texto original. Modelos personalizados são mantidos.', confirmLabel: 'Restaurar' }))
                      restore.mutate()
                  }}
                >
                  <RotateCcw /> Restaurar padrão
                </Button>
                <Button size="sm" onClick={() => setEditing({ open: true, tpl: null })}><Plus /> Novo modelo</Button>
              </div>
            )
          }
        />
        <CardBody className="space-y-3">
          {q.isLoading ? (
            [0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)
          ) : q.error ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : (
            q.data?.map((t) => (
              <div key={t.id} className="rounded-md border border-border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{t.name}</span>
                    {t.is_default && <Badge tone="muted">Padrão</Badge>}
                  </div>
                  {isAdmin && (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon-sm" aria-label="Editar modelo" onClick={() => setEditing({ open: true, tpl: t })}><Pencil /></Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Excluir modelo"
                        onClick={async () => {
                          if (await confirm({ title: `Excluir "${t.name}"?`, description: 'O histórico de contatos que usou este modelo é preservado.', confirmLabel: 'Excluir', danger: true })) remove.mutate(t.id)
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-muted">{t.body}</p>
              </div>
            ))
          )}
        </CardBody>
      </Card>

      <Dialog
        open={editing.open}
        onOpenChange={(o) => setEditing((s) => ({ ...s, open: o }))}
        title={editing.tpl ? 'Editar modelo' : 'Novo modelo'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing({ open: false, tpl: null })}>Cancelar</Button>
            <Button onClick={() => save.mutate()} loading={save.isPending}>Salvar modelo</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Nome do modelo" htmlFor="tname">
            <Input id="tname" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Mensagem" htmlFor="tbody">
            <Textarea id="tbody" ref={bodyRef} rows={5} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATE_VARIABLES.map((v) => (
              <button key={v} type="button" onClick={() => insertVar(v)} className="rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-xs text-muted hover:text-fg">
                {v}
              </button>
            ))}
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-subtle">Pré-visualização</p>
            <div className="rounded-lg rounded-tl-none bg-[#0b3d2e] px-3 py-2 text-[13px] text-[#e7fbef]">
              {renderTemplate(body, { nome: 'Maria Souza', produto: 'Ração Premium 15kg', pet: 'Thor', loja: org.name })}
            </div>
          </div>
        </div>
      </Dialog>
    </>
  )
}
