import * as React from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AlertTriangle, Database } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import { FullscreenLoader, OrgProvider, useMemberships } from '@/features/org/OrgProvider'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/states'
import { LandingPage } from '@/pages/LandingPage'
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from '@/features/auth/AuthPages'
import { NotFoundPage, PrivacyPage, TermsPage } from '@/pages/LegalPages'
import { isSupabaseConfigured } from '@/lib/supabase'
import { APP_URL, surface } from '@/lib/hosts'
import { BlockedScreen, useAccountStatus } from '@/features/auth/accountStatus'

// Rotas do painel carregadas sob demanda (bundle inicial menor para a landing)
const lazyNamed = <T extends Record<string, React.ComponentType>>(loader: () => Promise<T>, name: keyof T) =>
  React.lazy(() => loader().then((m) => ({ default: m[name] })))

const OnboardingPage = lazyNamed(() => import('@/features/onboarding/OnboardingPage'), 'OnboardingPage')
const DashboardPage = lazyNamed(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage')
const CustomersPage = lazyNamed(() => import('@/features/customers/CustomersPage'), 'CustomersPage')
const CustomerDetailPage = lazyNamed(() => import('@/features/customers/CustomerDetailPage'), 'CustomerDetailPage')
const ProductsPage = lazyNamed(() => import('@/features/products/ProductsPage'), 'ProductsPage')
const PurchasesPage = lazyNamed(() => import('@/features/purchases/PurchasesPage'), 'PurchasesPage')
const ReplenishmentPage = lazyNamed(() => import('@/features/replenishment/ReplenishmentPage'), 'ReplenishmentPage')
const RecoveryPage = lazyNamed(() => import('@/features/recovery/RecoveryPage'), 'RecoveryPage')
const ReportsPage = lazyNamed(() => import('@/features/reports/ReportsPage'), 'ReportsPage')
const SettingsPage = lazyNamed(() => import('@/features/settings/SettingsPage'), 'SettingsPage')
const PlanPage = lazyNamed(() => import('@/features/billing/PlanPage'), 'PlanPage')
const HelpPage = lazyNamed(() => import('@/pages/HelpPage'), 'HelpPage')

function RequireAuth() {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return <FullscreenLoader />
  if (!session) return <Navigate to="/entrar" replace state={{ from: location.pathname }} />
  return <AccountGate />
}

/** Bloqueio de conta é decidido no banco; aqui só exibimos o estado. */
function AccountGate() {
  const status = useAccountStatus()
  if (status.isLoading) return <FullscreenLoader />
  if (status.data?.blocked) return <BlockedScreen reason={status.data.blocked_reason} />
  return <Outlet />
}

/** No domínio da landing, rotas do painel levam ao subdomínio do app. */
function ExternalRedirect() {
  const location = useLocation()
  React.useEffect(() => {
    if (APP_URL) window.location.replace(new URL(location.pathname + location.search + location.hash, APP_URL).toString())
  }, [location])
  return <FullscreenLoader />
}

/** Garante que o usuário tem um estabelecimento com onboarding concluído. */
function RequireOrg() {
  const memberships = useMemberships()
  if (memberships.isLoading) return <FullscreenLoader />
  if (memberships.error) return <div className="grid min-h-dvh place-items-center"><ErrorState error={memberships.error} onRetry={() => memberships.refetch()} /></div>
  const list = memberships.data ?? []
  const ready = list.filter((m) => m.organizations.onboarding_completed || m.role !== 'owner')
  if (!ready.length) return <Navigate to="/onboarding" replace />
  return (
    <OrgProvider memberships={ready}>
      <Outlet />
    </OrgProvider>
  )
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error('[VoltaCerta] Erro não tratado:', error)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="grid min-h-dvh place-items-center bg-bg px-5 text-center">
        <div>
          <AlertTriangle className="mx-auto size-8 text-warning" />
          <h1 className="mt-4 text-lg font-semibold">Algo deu errado</h1>
          <p className="mt-2 text-sm text-muted">Recarregue a página. Se o problema continuar, fale com o suporte.</p>
          <Button className="mt-6" onClick={() => window.location.reload()}>Recarregar</Button>
        </div>
      </div>
    )
  }
}

export function NotConfigured() {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg px-5">
      <div className="max-w-md rounded-xl border border-border bg-surface p-6">
        <Database className="size-6 text-warning" />
        <h1 className="mt-4 text-lg font-semibold">Supabase não configurado</h1>
        <p className="mt-2 text-sm text-muted">
          Defina <code className="text-fg">VITE_SUPABASE_URL</code> e <code className="text-fg">VITE_SUPABASE_ANON_KEY</code> no arquivo <code className="text-fg">.env.local</code> e reinicie o servidor. Veja o README.
        </p>
      </div>
    </div>
  )
}

export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <React.Suspense fallback={<FullscreenLoader />}>
          <Routes>
            <Route path="/" element={surface === 'app' ? <Navigate to="/app" replace /> : <LandingPage />} />
            <Route path="/privacidade" element={<PrivacyPage />} />
            <Route path="/termos" element={<TermsPage />} />
            {surface === 'site' ? (
              <Route path="*" element={<ExternalRedirect />} />
            ) : isSupabaseConfigured ? (
              <>
                <Route path="/entrar" element={<LoginPage />} />
                <Route path="/cadastro" element={<SignupPage />} />
                <Route path="/recuperar-senha" element={<ForgotPasswordPage />} />
                <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
                <Route element={<RequireAuth />}>
                  <Route path="/onboarding" element={<OnboardingPage />} />
                  <Route element={<RequireOrg />}>
                    <Route path="/app" element={<AppShell />}>
                      <Route index element={<DashboardPage />} />
                      <Route path="clientes" element={<CustomersPage />} />
                      <Route path="clientes/:id" element={<CustomerDetailPage />} />
                      <Route path="produtos" element={<ProductsPage />} />
                      <Route path="compras" element={<PurchasesPage />} />
                      <Route path="recompras" element={<ReplenishmentPage />} />
                      <Route path="recuperacao" element={<RecoveryPage />} />
                      <Route path="relatorios" element={<ReportsPage />} />
                      <Route path="configuracoes" element={<SettingsPage />} />
                      <Route path="configuracoes/:tab" element={<SettingsPage />} />
                      <Route path="plano" element={<PlanPage />} />
                      <Route path="ajuda" element={<HelpPage />} />
                      <Route path="*" element={<Navigate to="/app" replace />} />
                    </Route>
                  </Route>
                </Route>
              </>
            ) : (
              <Route path="*" element={<NotConfigured />} />
            )}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </React.Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
