import * as React from 'react'
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { toast } from 'sonner'
import {
  Building2,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Tags,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { LogoMark } from '@/components/brand/Logo'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { useAuth } from '@/features/auth/AuthProvider'
import { useAccountStatus } from '@/features/auth/accountStatus'
import { loginSchema } from '@/features/auth/schemas'
import { FullscreenLoader } from '@/features/org/OrgProvider'
import { ErrorBoundary, NotConfigured } from '@/App'
import { ADMIN_BASENAME, appHref } from '@/lib/hosts'
import { isDemoMode, isSupabaseConfigured, supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { cn } from '@/lib/utils'

const lazyNamed = <T extends Record<string, React.ComponentType>>(loader: () => Promise<T>, name: keyof T) =>
  React.lazy(() => loader().then((m) => ({ default: m[name] })))

const AdminDashboard = lazyNamed(() => import('./pages/AdminDashboard'), 'AdminDashboard')
const AdminOrganizations = lazyNamed(() => import('./pages/AdminOrganizations'), 'AdminOrganizations')
const AdminOrganizationDetail = lazyNamed(() => import('./pages/AdminOrganizationDetail'), 'AdminOrganizationDetail')
const AdminSubscriptions = lazyNamed(() => import('./pages/AdminSubscriptions'), 'AdminSubscriptions')
const AdminUsers = lazyNamed(() => import('./pages/AdminUsers'), 'AdminUsers')
const AdminAudit = lazyNamed(() => import('./pages/AdminAudit'), 'AdminAudit')
const AdminPlans = lazyNamed(() => import('./pages/AdminPlans'), 'AdminPlans')

const NAV: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/', label: 'Visão geral', icon: LayoutDashboard, end: true },
  { to: '/estabelecimentos', label: 'Estabelecimentos', icon: Building2 },
  { to: '/assinaturas', label: 'Assinaturas', icon: CreditCard },
  { to: '/usuarios', label: 'Usuários', icon: Users },
  { to: '/planos', label: 'Planos', icon: Tags },
  { to: '/auditoria', label: 'Auditoria', icon: ScrollText },
]

function AdminBrand() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight">VoltaCerta</span>
      <span className="rounded-md border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning">Admin</span>
    </span>
  )
}

function AdminLogin() {
  useDocumentTitle('Admin · Entrar')
  const { session } = useAuth()
  const navigate = useNavigate()
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) })
  if (session) return <Navigate to="/" replace />
  const onSubmit = form.handleSubmit(async (v) => {
    const { error } = await supabase.auth.signInWithPassword(v)
    if (error) return toast.error(errorMessage(error))
    navigate('/', { replace: true })
  })
  const e = form.formState.errors
  return (
    <div className="grid min-h-dvh place-items-center bg-bg px-5">
      <div className="w-full max-w-sm page-enter">
        <AdminBrand />
        <h1 className="mt-8 text-2xl font-semibold tracking-tight">Painel administrativo</h1>
        <p className="mt-1.5 text-sm text-muted">Acesso restrito à equipe VoltaCerta.</p>
        <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
          <Field label="E-mail" htmlFor="aemail" error={e.email?.message}>
            <Input id="aemail" type="email" autoComplete="email" {...form.register('email')} />
          </Field>
          <Field label="Senha" htmlFor="apass" error={e.password?.message}>
            <Input id="apass" type="password" autoComplete="current-password" {...form.register('password')} />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>Entrar</Button>
        </form>
        <a href={appHref('/recuperar-senha')} className="mt-4 block text-center text-[13px] text-muted hover:text-fg">Esqueci minha senha</a>
      </div>
    </div>
  )
}

/** A autorização real está no banco (is_super_admin). Este guard só decide o que exibir. */
function RequireSuperAdmin() {
  const { session, loading, signOut } = useAuth()
  const location = useLocation()
  const status = useAccountStatus()
  if (loading || (session && status.isLoading)) return <FullscreenLoader />
  if (!session) return <Navigate to="/entrar" replace state={{ from: location.pathname }} />
  if (!status.data?.super_admin) {
    return (
      <div className="grid min-h-dvh place-items-center bg-bg px-5">
        <div className="max-w-md rounded-xl border border-border bg-surface p-6 text-center">
          <ShieldAlert className="mx-auto size-7 text-danger" />
          <h1 className="mt-4 text-lg font-semibold">Acesso negado</h1>
          <p className="mt-2 text-sm text-muted">Esta conta não tem permissão de Super Admin. A tentativa não concede nenhum acesso aos dados.</p>
          <Button variant="secondary" className="mt-6" onClick={() => signOut()}>Sair e trocar de conta</Button>
        </div>
      </div>
    )
  }
  return <AdminShell />
}

function AdminNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Navegação administrativa">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn('group flex h-9 items-center gap-3 rounded-md px-2.5 text-[13.5px] font-medium transition-colors', isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2/60 hover:text-fg')
          }
        >
          {({ isActive }) => (
            <>
              <Icon className={cn('size-4', isActive ? 'text-warning' : 'text-subtle')} />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

function AdminSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth()
  return (
    <div className="flex h-full flex-col gap-6 px-3 py-4">
      <div className="px-2"><AdminBrand /></div>
      <div className="flex-1"><AdminNav onNavigate={onNavigate} /></div>
      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center gap-2 px-2 text-[12px] text-muted">
          <ShieldCheck className="size-4 shrink-0 text-warning" />
          <span className="truncate">{user?.email}</span>
        </div>
        <button onClick={() => signOut()} className="flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-[13.5px] font-medium text-muted hover:bg-surface-2 hover:text-fg">
          <LogOut className="size-4 text-subtle" /> Sair
        </button>
      </div>
    </div>
  )
}

function AdminShell() {
  const [open, setOpen] = React.useState(false)
  const location = useLocation()
  return (
    <div className="min-h-dvh bg-bg">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-border bg-bg lg:block"><AdminSidebar /></aside>
      <Sheet open={open} onOpenChange={setOpen} title="Menu administrativo"><AdminSidebar onNavigate={() => setOpen(false)} /></Sheet>
      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Abrir menu"><MenuIcon /></Button>
          <AdminBrand />
        </header>
        <div className="border-b border-warning/20 bg-warning/5 px-4 py-1.5 text-center text-[11px] font-medium uppercase tracking-wider text-warning lg:px-8">
          {isDemoMode ? 'Modo demonstração · dados de exemplo' : 'Ambiente administrativo · todas as ações são auditadas'}
        </div>
        <main key={location.pathname} className="mx-auto max-w-[1280px] px-4 pb-16 pt-6 page-enter sm:px-6 lg:px-8 lg:pt-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export function AdminRoot() {
  return (
    <ErrorBoundary>
      <BrowserRouter basename={ADMIN_BASENAME}>
        <React.Suspense fallback={<FullscreenLoader />}>
          {!isSupabaseConfigured ? (
            <NotConfigured />
          ) : (
            <Routes>
              <Route path="/entrar" element={<AdminLogin />} />
              <Route element={<RequireSuperAdmin />}>
                <Route index element={<AdminDashboard />} />
                <Route path="estabelecimentos" element={<AdminOrganizations />} />
                <Route path="estabelecimentos/:id" element={<AdminOrganizationDetail />} />
                <Route path="assinaturas" element={<AdminSubscriptions />} />
                <Route path="usuarios" element={<AdminUsers />} />
                <Route path="planos" element={<AdminPlans />} />
                <Route path="auditoria" element={<AdminAudit />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          )}
        </React.Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
