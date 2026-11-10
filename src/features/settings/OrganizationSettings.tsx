import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { ImagePlus, Trash2 } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/input'
import { useOrg } from '@/features/org/OrgProvider'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { BR_STATES, BUSINESS_TYPE } from '@/domain/labels'
import { initials } from '@/lib/utils'
import { ReadOnlyNotice } from './shared'

const schema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  address: z.string().trim().max(200).optional().or(z.literal('')),
  city: z.string().trim().max(80).optional().or(z.literal('')),
  state: z.string().optional().or(z.literal('')),
  business_type: z.string().optional().or(z.literal('')),
})
type Values = z.infer<typeof schema>

export function logoUrl(path: string | null): string | null {
  if (!path) return null
  return supabase.storage.from('org-logos').getPublicUrl(path).data.publicUrl
}

export function OrganizationSettings() {
  const { org, isAdmin, refresh } = useOrg()
  const [uploading, setUploading] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: {
      name: org.name,
      phone: org.phone ?? '',
      address: org.address ?? '',
      city: org.city ?? '',
      state: org.state ?? '',
      business_type: org.business_type ?? '',
    },
  })

  const onSubmit = form.handleSubmit(async (v) => {
    const { error } = await supabase
      .from('organizations')
      .update({
        name: v.name,
        phone: v.phone || null,
        address: v.address || null,
        city: v.city || null,
        state: v.state || null,
        business_type: v.business_type || null,
      })
      .eq('id', org.id)
    if (error) return toast.error(errorMessage(error))
    toast.success('Dados do estabelecimento salvos.')
    await refresh()
  })

  const onLogo = async (file: File) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return toast.error('Use uma imagem PNG, JPG ou WEBP.')
    if (file.size > 1024 * 1024) return toast.error('A imagem deve ter no máximo 1 MB.')
    setUploading(true)
    try {
      const ext = file.type.split('/')[1]
      const path = `${org.id}/logo-${Date.now()}.${ext}`
      const up = await supabase.storage.from('org-logos').upload(path, file, { upsert: false, contentType: file.type })
      if (up.error) throw up.error
      const { error } = await supabase.from('organizations').update({ logo_path: path }).eq('id', org.id)
      if (error) throw error
      if (org.logo_path) await supabase.storage.from('org-logos').remove([org.logo_path])
      toast.success('Logo atualizada.')
      await refresh()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setUploading(false)
    }
  }

  const removeLogo = async () => {
    if (!org.logo_path) return
    const { error } = await supabase.from('organizations').update({ logo_path: null }).eq('id', org.id)
    if (error) return toast.error(errorMessage(error))
    await supabase.storage.from('org-logos').remove([org.logo_path])
    toast.success('Logo removida.')
    await refresh()
  }

  const e = form.formState.errors
  const url = logoUrl(org.logo_path)

  return (
    <>
      {!isAdmin && <ReadOnlyNotice />}
      <Card>
        <CardHeader title="Logo" description="Aparece no painel do estabelecimento." />
        <CardBody className="flex items-center gap-4">
          {url ? (
            <img src={url} alt="Logo do estabelecimento" className="size-16 rounded-lg border border-border object-cover" />
          ) : (
            <div className="grid size-16 place-items-center rounded-lg border border-border bg-surface-2 text-lg font-semibold">{initials(org.name)}</div>
          )}
          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(ev) => ev.target.files?.[0] && onLogo(ev.target.files[0])} />
              <Button variant="secondary" size="sm" loading={uploading} onClick={() => fileRef.current?.click()}>
                <ImagePlus /> Enviar imagem
              </Button>
              {org.logo_path && (
                <Button variant="ghost" size="sm" onClick={removeLogo}><Trash2 /> Remover</Button>
              )}
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Dados do estabelecimento" />
        <CardBody>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <fieldset disabled={!isAdmin} className="space-y-4">
              <Field label="Nome do estabelecimento" htmlFor="oname" error={e.name?.message}>
                <Input id="oname" {...form.register('name')} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Telefone comercial" htmlFor="ophone" optional>
                  <Input id="ophone" type="tel" {...form.register('phone')} />
                </Field>
                <Field label="Tipo de estabelecimento" htmlFor="otype" optional>
                  <Select id="otype" {...form.register('business_type')}>
                    <option value="">Selecione</option>
                    {Object.entries(BUSINESS_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
              </div>
              <Field label="Endereço" htmlFor="oaddr" optional>
                <Input id="oaddr" {...form.register('address')} />
              </Field>
              <div className="grid grid-cols-[1fr_100px] gap-4">
                <Field label="Cidade" htmlFor="ocity" optional>
                  <Input id="ocity" {...form.register('city')} />
                </Field>
                <Field label="UF" htmlFor="ostate" optional>
                  <Select id="ostate" {...form.register('state')}>
                    <option value="">—</option>
                    {BR_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </Field>
              </div>
            </fieldset>
            {isAdmin && (
              <div className="flex justify-end">
                <Button type="submit" loading={form.formState.isSubmitting}>Salvar</Button>
              </div>
            )}
          </form>
        </CardBody>
      </Card>
    </>
  )
}
