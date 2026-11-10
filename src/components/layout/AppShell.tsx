import * as React from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  Check,
  ChevronsUpDown,
  CreditCard,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  MessageCircle,
  Package,
  RefreshCcw,
  Settings,
  ShoppingBag,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { Logo, LogoMark } from '@/components/brand/Logo'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/dialog'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { useAuth } from '@/features/auth/AuthProvider'
import { useOrg } from '@/features/org/OrgProvider'
import { PLANS, ROLE } from '@/domain/labels'
import { isDevEnvironment } from '@/lib/supabase'
import { cn, initials } from '@/lib/utils'
import { diffDaysISO } from '@/lib/dates'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

export const NAV: NavItem[] = [
  { to: '/app', label: 'Visão geral', icon: LayoutDashboard, end: true },
  { to: '/app/clientes', label: 'Clientes', icon: Users },
  { to: '/app/produtos', label: 'Produtos', icon: Package },
  { to: '/app/compras', label: 'Compras', icon: ShoppingBag },
  { to: '/app/recompras', label: 'Recompras', icon: RefreshCcw },
  { to: '/app/recuperacao', label: 'Recuperação de clientes', icon: MessageCircle },
  { to: '/app/relatorios', label: 'Relatórios', icon: BarChart3 },
  { to: '/app/configuracoes', label: 'Configurações', icon: Settings },
]

const MOBILE_NAV = [NAV[0], NAV[1], NAV[4], NAV[5]]

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Navegação principal">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'group flex h-9 items-center gap-3 rounded-md px-2.5 text-[13.5px] font-medium transition-colors',
              isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2/60 hover:text-fg',
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon className={cn('size-4 shrink-0', isActive ? 'text-brand' : 'text-subtle group-hover:text-muted')} />
              <span className="truncate">{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

function OrgSwitcher() {
  const { org, memberships, switchOrg } = useOrg()
  const navigate = useNavigate()
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border bg-surface-2 text-[11px] font-semibold text-fg">
            {initials(org.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-fg">{org.name}</span>
            <span className="block truncate text-[11px] text-subtle">{org.city ? `${org.city}${org.state ? ` · ${org.state}` : ''}` : 'Estabelecimento'}</span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-subtle" />
        </button>
      </MenuTrigger>
      <MenuContent align="start">
        {memberships.map((m) => (
          <MenuItem key={m.organizations.id} onSelect={() => { switchOrg(m.organizations.id); navigate('/app') }}>
            <span className="flex-1 truncate">{m.organizations.name}</span>
            {m.organizations.id === org.id && <Check className="text-brand" />}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onSelect={() => navigate('/onboarding?novo=1')}>Adicionar estabelecimento</MenuItem>
      </MenuContent>
    </Menu>
  )
}

function SidebarFooter({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth()
  const { ctx, role } = useOrg()
  const navigate = useNavigate()
  const plan = PLANS.find((p) => p.id === ctx.plan)
  const trialDays = ctx.effective_status === 'trialing' && ctx.trial_ends_at ? Math.max(0, diffDaysISO(ctx.trial_ends_at.slice(0, 10), ctx.today)) : null
  const name = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? ''

  return (
    <div className="space-y-1 border-t border-border pt-3">
      <Link
        to="/app/plano"
        onClick={onNavigate}
        className="mb-2 block rounded-md border border-border bg-surface-2/50 px-3 py-2.5 transition-colors hover:border-border-strong"
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wide text-subtle">Plano atual</span>
          <CreditCard className="size-3.5 text-subtle" />
        </div>
        <div className="mt-0.5 text-[13px] font-semibold text-fg">{plan?.name}</div>
        {trialDays != null && <div className="text-[11px] text-warning">Teste grátis · {trialDays} {trialDays === 1 ? 'dia' : 'dias'} restantes</div>}
        {ctx.customer_limit != null && (
          <div className="mt-2">
            <div className="h-1 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (ctx.customer_count / ctx.customer_limit) * 100)}%` }} />
            </div>
            <div className="mt-1 text-[11px] text-subtle tabular">{ctx.customer_count} de {ctx.customer_limit} clientes</div>
          </div>
        )}
      </Link>
      <NavLink
        to="/app/ajuda"
        onClick={onNavigate}
        className={({ isActive }) => cn('flex h-9 items-center gap-3 rounded-md px-2.5 text-[13.5px] font-medium transition-colors', isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2/60 hover:text-fg')}
      >
        <HelpCircle className="size-4 text-subtle" /> Ajuda
      </NavLink>
      <Menu>
        <MenuTrigger asChild>
          <button className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand/15 text-[11px] font-semibold text-brand">{initials(name)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-fg">{name}</span>
              <span className="block text-[11px] text-subtle">{ROLE[role]}</span>
            </span>
          </button>
        </MenuTrigger>
        <MenuContent align="start">
          <MenuItem onSelect={() => { onNavigate?.(); navigate('/app/configuracoes/perfil') }}>
            <UserRound /> Meu perfil
          </MenuItem>
          <MenuSeparator />
          <MenuItem danger onSelect={() => signOut().then(() => navigate('/entrar'))}>
            <LogOut /> Sair da conta
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  )
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-4 px-3 py-4">
      <div className="px-2">
        <Logo />
      </div>
      <OrgSwitcher />
      <div className="flex-1 overflow-y-auto">
        <NavLinks onNavigate={onNavigate} />
      </div>
      <SidebarFooter onNavigate={onNavigate} />
    </div>
  )
}

function SubscriptionBanner() {
  const { ctx, isAdmin } = useOrg()
  const s = ctx.effective_status
  let text: string | null = null
  let tone = 'border-warning/30 bg-warning/10 text-warning'
  if (s === 'expired' || s === 'canceled') {
    text = 'Sua assinatura não está ativa. Os dados continuam disponíveis para consulta, mas novos registros estão bloqueados.'
    tone = 'border-danger/30 bg-danger/10 text-[#ff8a8a]'
  } else if (s === 'past_due') {
    text = 'Identificamos um pagamento pendente. Regularize para evitar a suspensão.'
  } else if (s === 'trialing' && ctx.trial_ends_at && diffDaysISO(ctx.trial_ends_at.slice(0, 10), ctx.today) <= 3) {
    text = 'Seu período de teste termina em breve. Escolha um plano para continuar usando o VoltaCerta.'
  }
  if (!text) return null
  return (
    <div className={cn('flex flex-col gap-2 border-b px-4 py-2.5 text-[13px] sm:flex-row sm:items-center sm:justify-between lg:px-8', tone)}>
      <span>{text}</span>
      {isAdmin && (
        <Link to="/app/plano" className="shrink-0 font-semibold underline-offset-4 hover:underline">
          Ver planos
        </Link>
      )}
    </div>
  )
}

export function AppShell() {
  const [open, setOpen] = React.useState(false)
  const location = useLocation()
  React.useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  return (
    <div className="min-h-dvh bg-bg">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-border bg-bg lg:block">
        <SidebarContent />
      </aside>

      <Sheet open={open} onOpenChange={setOpen} title="Menu">
        <SidebarContent onNavigate={() => setOpen(false)} />
      </Sheet>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Abrir menu">
            <MenuIcon />
          </Button>
          <Link to="/app" className="flex items-center gap-2">
            <LogoMark />
            <span className="text-sm font-semibold">VoltaCerta</span>
          </Link>
        </header>
        {isDevEnvironment && (
          <div className="border-b border-info/20 bg-info/5 px-4 py-1.5 text-center text-[11px] font-medium uppercase tracking-wider text-info lg:px-8">
            Ambiente de desenvolvimento · pagamentos não são processados
          </div>
        )}
        <SubscriptionBanner />
        <main key={location.pathname} className="mx-auto max-w-[1280px] px-4 pb-28 pt-6 page-enter sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">
          <Outlet />
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Navegação rápida">
        {MOBILE_NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => cn('flex flex-col items-center gap-1 py-2.5 text-[10.5px] font-medium', isActive ? 'text-brand' : 'text-subtle')}
          >
            <Icon className="size-5" />
            <span className="max-w-full truncate px-1">{label === 'Recuperação de clientes' ? 'Recuperar' : label}</span>
          </NavLink>
        ))}
        <button onClick={() => setOpen(true)} className="flex flex-col items-center gap-1 py-2.5 text-[10.5px] font-medium text-subtle">
          <MenuIcon className="size-5" />
          Mais
        </button>
      </nav>
    </div>
  )
}
