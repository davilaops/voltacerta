import { useQuery } from '@tanstack/react-query'
import { ShieldOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { rpc } from '@/lib/supabase'
import { useAuth } from './AuthProvider'

export interface AccountStatus {
  authenticated: boolean
  blocked: boolean
  blocked_reason: string | null
  super_admin: boolean
}

/** Situação da conta validada no banco (bloqueio e papel de plataforma). */
export function useAccountStatus() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['account-status', user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: () => rpc<AccountStatus>('get_account_status', {}),
  })
}

export function BlockedScreen({ reason }: { reason: string | null }) {
  const { signOut } = useAuth()
  return (
    <div className="grid min-h-dvh place-items-center bg-bg px-5">
      <div className="max-w-md rounded-xl border border-border bg-surface p-6 text-center">
        <ShieldOff className="mx-auto size-7 text-danger" />
        <h1 className="mt-4 text-lg font-semibold">Acesso bloqueado</h1>
        <p className="mt-2 text-sm text-muted">
          Sua conta foi bloqueada pela equipe VoltaCerta{reason ? `: ${reason}` : '.'} Para mais informações, fale com o suporte.
        </p>
        <Button variant="secondary" className="mt-6" onClick={() => signOut()}>Sair</Button>
      </div>
    </div>
  )
}
