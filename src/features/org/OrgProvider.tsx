import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { rpc, supabase, unwrap } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import type { MemberRole, Organization, OrgContext } from '@/types/models'

interface Membership {
  role: MemberRole
  organizations: Organization
}

interface OrgState {
  org: Organization
  ctx: OrgContext
  memberships: Membership[]
  role: MemberRole
  isAdmin: boolean
  canWrite: boolean
  switchOrg: (id: string) => void
  refresh: () => Promise<void>
}

const OrgCtx = React.createContext<OrgState | null>(null)
const STORAGE_KEY = 'vc.currentOrg'

/** Carrega as organizações do usuário (via RLS) e aceita convites pendentes. */
export function useMemberships() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['memberships', user?.id],
    enabled: !!user,
    queryFn: async () => {
      await rpc<number>('accept_pending_invitations', {}).catch(() => 0)
      const rows = unwrap(
        await supabase
          .from('organization_members')
          .select('role, organizations(*)')
          .eq('user_id', user!.id)
          .order('created_at'),
      ) as unknown as Membership[]
      return rows.filter((r) => r.organizations)
    },
  })
}

export function OrgProvider({ memberships, children }: { memberships: Membership[]; children: React.ReactNode }) {
  const qc = useQueryClient()
  const [currentId, setCurrentId] = React.useState<string>(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    return memberships.find((m) => m.organizations.id === saved)?.organizations.id ?? memberships[0].organizations.id
  })
  const membership = memberships.find((m) => m.organizations.id === currentId) ?? memberships[0]
  const org = membership.organizations

  const ctxQuery = useQuery({
    queryKey: ['org-context', org.id],
    queryFn: () => rpc<OrgContext>('get_org_context', { p_org: org.id }),
    staleTime: 60_000,
  })

  const switchOrg = React.useCallback(
    (id: string) => {
      localStorage.setItem(STORAGE_KEY, id)
      setCurrentId(id)
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'memberships' })
    },
    [qc],
  )

  const refresh = React.useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['memberships'] }),
      qc.invalidateQueries({ queryKey: ['org-context'] }),
    ])
  }, [qc])

  if (!ctxQuery.data) {
    if (ctxQuery.error) throw ctxQuery.error
    return <FullscreenLoader />
  }

  const role = ctxQuery.data.role
  const value: OrgState = {
    org,
    ctx: ctxQuery.data,
    memberships,
    role,
    isAdmin: role === 'owner' || role === 'admin',
    canWrite: ctxQuery.data.can_write,
    switchOrg,
    refresh,
  }
  return <OrgCtx.Provider value={value}>{children}</OrgCtx.Provider>
}

export function useOrg() {
  const ctx = React.useContext(OrgCtx)
  if (!ctx) throw new Error('useOrg fora do OrgProvider')
  return ctx
}

export function FullscreenLoader() {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg">
      <div className="flex flex-col items-center gap-4 animate-fade-in">
        <div className="grid size-10 place-items-center rounded-xl bg-brand text-brand-fg">
          <svg viewBox="0 0 32 32" className="size-6">
            <path d="M9 16.5l4.5 4.5L23 11.5" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="h-0.5 w-24 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full w-1/3 rounded-full bg-brand" style={{ animation: 'vc-load 1.1s ease-in-out infinite' }} />
        </div>
        <style>{`@keyframes vc-load{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>
      </div>
    </div>
  )
}
