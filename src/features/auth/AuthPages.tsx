import * as React from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { MailCheck } from 'lucide-react'
import type { z } from 'zod'
import { AuthLayout } from './AuthLayout'
import { forgotSchema, loginSchema, resetSchema, signupSchema } from './schemas'
import { useAuth } from './AuthProvider'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input } from '@/components/ui/input'
import { appUrl, supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'

export function LoginPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/app'
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) })

  if (session) return <Navigate to={from} replace />

  const onSubmit = form.handleSubmit(async (values) => {
    const { error } = await supabase.auth.signInWithPassword(values)
    if (error) return toast.error(errorMessage(error))
    navigate(from, { replace: true })
  })

  const e = form.formState.errors
  return (
    <AuthLayout
      title="Entrar"
      subtitle="Acesse o painel do seu estabelecimento."
      footer={
        <>
          Ainda não tem conta?{' '}
          <Link to="/cadastro" className="font-medium text-brand hover:underline">
            Criar conta
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="E-mail" htmlFor="email" error={e.email?.message}>
          <Input id="email" type="email" autoComplete="email" aria-invalid={!!e.email} {...form.register('email')} />
        </Field>
        <Field label="Senha" htmlFor="password" error={e.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!e.password} {...form.register('password')} />
        </Field>
        <div className="flex justify-end">
          <Link to="/recuperar-senha" className="text-[13px] text-muted hover:text-fg">
            Esqueci minha senha
          </Link>
        </div>
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
          Entrar
        </Button>
      </form>
    </AuthLayout>
  )
}

export function SignupPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [sentTo, setSentTo] = React.useState<string | null>(null)
  const form = useForm<z.infer<typeof signupSchema>>({
    resolver: zodResolver(signupSchema),
    defaultValues: { acceptTerms: false },
  })

  if (session) return <Navigate to="/onboarding" replace />

  const onSubmit = form.handleSubmit(async (v) => {
    const { data, error } = await supabase.auth.signUp({
      email: v.email,
      password: v.password,
      options: { data: { full_name: v.fullName }, emailRedirectTo: `${appUrl}/onboarding` },
    })
    if (error) return toast.error(errorMessage(error))
    if (data.session) navigate('/onboarding', { replace: true })
    else setSentTo(v.email)
  })

  if (sentTo) {
    return (
      <AuthLayout title="Confirme seu e-mail">
        <div className="rounded-lg border border-border bg-surface p-5 text-sm text-muted">
          <MailCheck className="mb-3 size-6 text-brand" />
          Enviamos um link de confirmação para <strong className="text-fg">{sentTo}</strong>. Abra o e-mail para ativar sua conta e configurar seu estabelecimento.
        </div>
        <Button variant="secondary" className="mt-4 w-full" asChild>
          <Link to="/entrar">Ir para o login</Link>
        </Button>
      </AuthLayout>
    )
  }

  const e = form.formState.errors
  return (
    <AuthLayout
      title="Criar conta"
      subtitle="14 dias grátis. Sem cartão de crédito."
      footer={
        <>
          Já tem conta?{' '}
          <Link to="/entrar" className="font-medium text-brand hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Seu nome" htmlFor="fullName" error={e.fullName?.message}>
          <Input id="fullName" autoComplete="name" aria-invalid={!!e.fullName} {...form.register('fullName')} />
        </Field>
        <Field label="E-mail" htmlFor="email" error={e.email?.message}>
          <Input id="email" type="email" autoComplete="email" aria-invalid={!!e.email} {...form.register('email')} />
        </Field>
        <Field label="Senha" htmlFor="password" error={e.password?.message} hint="Mínimo de 8 caracteres, com letras e números.">
          <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!e.password} {...form.register('password')} />
        </Field>
        <div>
          <Checkbox
            label="Li e aceito os Termos de Uso e a Política de Privacidade"
            description="Seus dados são usados apenas para operar sua conta no VoltaCerta."
            {...form.register('acceptTerms')}
          />
          <div className="mt-1 flex gap-3 pl-7 text-xs">
            <Link to="/termos" target="_blank" className="text-brand hover:underline">Termos</Link>
            <Link to="/privacidade" target="_blank" className="text-brand hover:underline">Privacidade</Link>
          </div>
          {e.acceptTerms && <p className="mt-1 pl-7 text-xs text-danger">{e.acceptTerms.message}</p>}
        </div>
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
          Começar agora
        </Button>
      </form>
    </AuthLayout>
  )
}

export function ForgotPasswordPage() {
  const [sent, setSent] = React.useState(false)
  const form = useForm<z.infer<typeof forgotSchema>>({ resolver: zodResolver(forgotSchema) })
  const onSubmit = form.handleSubmit(async ({ email }) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${appUrl}/redefinir-senha` })
    if (error) return toast.error(errorMessage(error))
    setSent(true)
  })
  return (
    <AuthLayout
      title="Recuperar senha"
      subtitle="Enviaremos um link para você criar uma nova senha."
      footer={<Link to="/entrar" className="text-brand hover:underline">Voltar ao login</Link>}
    >
      {sent ? (
        <div className="rounded-lg border border-border bg-surface p-5 text-sm text-muted">
          <MailCheck className="mb-3 size-6 text-brand" />
          Se existir uma conta com este e-mail, você receberá o link em alguns instantes.
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="E-mail" htmlFor="email" error={form.formState.errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
            Enviar link
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}

export function ResetPasswordPage() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const form = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema) })
  const onSubmit = form.handleSubmit(async ({ password }) => {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) return toast.error(errorMessage(error))
    toast.success('Senha alterada com sucesso.')
    navigate('/app', { replace: true })
  })
  const e = form.formState.errors
  return (
    <AuthLayout title="Nova senha" subtitle="Escolha uma nova senha para sua conta.">
      {!loading && !session ? (
        <div className="rounded-lg border border-border bg-surface p-5 text-sm text-muted">
          Este link é inválido ou expirou.{' '}
          <Link to="/recuperar-senha" className="text-brand hover:underline">Solicite um novo link</Link>.
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Nova senha" htmlFor="password" error={e.password?.message}>
            <Input id="password" type="password" autoComplete="new-password" {...form.register('password')} />
          </Field>
          <Field label="Confirmar senha" htmlFor="confirm" error={e.confirm?.message}>
            <Input id="confirm" type="password" autoComplete="new-password" {...form.register('confirm')} />
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
            Salvar nova senha
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
