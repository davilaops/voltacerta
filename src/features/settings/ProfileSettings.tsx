import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { useAuth } from '@/features/auth/AuthProvider'
import { passwordSchema } from '@/features/auth/schemas'
import { appUrl, supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'

const nameSchema = z.object({ full_name: z.string().trim().min(2, 'Informe seu nome').max(120) })
const emailSchema = z.object({ email: z.string().trim().email('E-mail inválido') })
const pwSchema = z.object({ password: passwordSchema, confirm: z.string() }).refine((d) => d.password === d.confirm, { message: 'As senhas não conferem', path: ['confirm'] })

export function ProfileSettings() {
  const { user } = useAuth()
  const nameForm = useForm<z.infer<typeof nameSchema>>({ resolver: zodResolver(nameSchema), values: { full_name: (user?.user_metadata?.full_name as string) ?? '' } })
  const emailForm = useForm<z.infer<typeof emailSchema>>({ resolver: zodResolver(emailSchema), values: { email: user?.email ?? '' } })
  const pwForm = useForm<z.infer<typeof pwSchema>>({ resolver: zodResolver(pwSchema), defaultValues: { password: '', confirm: '' } })

  const saveName = nameForm.handleSubmit(async ({ full_name }) => {
    const [a, b] = await Promise.all([
      supabase.auth.updateUser({ data: { full_name } }),
      supabase.from('profiles').update({ full_name }).eq('id', user!.id),
    ])
    if (a.error || b.error) return toast.error(errorMessage(a.error ?? b.error))
    toast.success('Nome atualizado.')
  })
  const saveEmail = emailForm.handleSubmit(async ({ email }) => {
    if (email === user?.email) return
    const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: `${appUrl}/app/configuracoes/perfil` })
    if (error) return toast.error(errorMessage(error))
    toast.success('Enviamos um link de confirmação para o novo e-mail.')
  })
  const savePw = pwForm.handleSubmit(async ({ password }) => {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) return toast.error(errorMessage(error))
    pwForm.reset()
    toast.success('Senha alterada.')
  })

  return (
    <>
      <Card>
        <CardHeader title="Nome" />
        <CardBody>
          <form onSubmit={saveName} className="flex flex-col gap-3 sm:flex-row sm:items-end" noValidate>
            <Field label="Nome completo" htmlFor="fn" error={nameForm.formState.errors.full_name?.message} className="flex-1">
              <Input id="fn" {...nameForm.register('full_name')} />
            </Field>
            <Button type="submit" loading={nameForm.formState.isSubmitting}>Salvar</Button>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="E-mail" description="A alteração só vale após confirmar o link enviado ao novo endereço." />
        <CardBody>
          <form onSubmit={saveEmail} className="flex flex-col gap-3 sm:flex-row sm:items-end" noValidate>
            <Field label="E-mail" htmlFor="em" error={emailForm.formState.errors.email?.message} className="flex-1">
              <Input id="em" type="email" {...emailForm.register('email')} />
            </Field>
            <Button type="submit" variant="secondary" loading={emailForm.formState.isSubmitting}>Alterar e-mail</Button>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Senha" />
        <CardBody>
          <form onSubmit={savePw} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" noValidate>
            <Field label="Nova senha" htmlFor="np" error={pwForm.formState.errors.password?.message}>
              <Input id="np" type="password" autoComplete="new-password" {...pwForm.register('password')} />
            </Field>
            <Field label="Confirmar" htmlFor="cp" error={pwForm.formState.errors.confirm?.message}>
              <Input id="cp" type="password" autoComplete="new-password" {...pwForm.register('confirm')} />
            </Field>
            <Button type="submit" variant="secondary" loading={pwForm.formState.isSubmitting}>Alterar senha</Button>
          </form>
        </CardBody>
      </Card>
    </>
  )
}
