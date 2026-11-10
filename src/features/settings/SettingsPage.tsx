import { NavLink, Navigate, useParams } from 'react-router-dom'
import { Building2, MessageSquareText, RefreshCcw, ShieldCheck, UserRound, UsersRound } from 'lucide-react'
import { PageHeader } from '@/components/ui/states'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { cn } from '@/lib/utils'
import { OrganizationSettings } from './OrganizationSettings'
import { ProfileSettings } from './ProfileSettings'
import { PredictionSettings } from './PredictionSettings'
import { TemplateSettings } from './TemplateSettings'
import { TeamSettings } from './TeamSettings'
import { PrivacySettings } from './PrivacySettings'

const TABS = [
  { id: 'estabelecimento', label: 'Estabelecimento', icon: Building2, el: OrganizationSettings },
  { id: 'perfil', label: 'Perfil', icon: UserRound, el: ProfileSettings },
  { id: 'recompras', label: 'Recompras', icon: RefreshCcw, el: PredictionSettings },
  { id: 'mensagens', label: 'Mensagens', icon: MessageSquareText, el: TemplateSettings },
  { id: 'equipe', label: 'Equipe', icon: UsersRound, el: TeamSettings },
  { id: 'privacidade', label: 'Privacidade e dados', icon: ShieldCheck, el: PrivacySettings },
] as const

export function SettingsPage() {
  const { tab = 'estabelecimento' } = useParams()
  const current = TABS.find((t) => t.id === tab)
  useDocumentTitle(current ? `Configurações · ${current.label}` : 'Configurações')
  if (!current) return <Navigate to="/app/configuracoes" replace />
  const El = current.el
  return (
    <>
      <PageHeader title="Configurações" />
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Seções de configurações">
          {TABS.map(({ id, label, icon: Icon }) => (
            <NavLink
              key={id}
              to={`/app/configuracoes/${id}`}
              className={() =>
                cn(
                  'flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors',
                  id === tab ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2/60 hover:text-fg',
                )
              }
            >
              <Icon className={cn('size-4', id === tab ? 'text-brand' : 'text-subtle')} /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 space-y-4">
          <El />
        </div>
      </div>
    </>
  )
}
