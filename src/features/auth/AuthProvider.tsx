import * as React from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

interface AuthState {
  session: Session | null
  user: User | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthCtx = React.createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(null)
  const [loading, setLoading] = React.useState(true)
  const qc = useQueryClient()
  const manualSignOut = React.useRef(false)

  React.useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_OUT') {
        qc.clear()
        if (!manualSignOut.current) toast.info('Sua sessão foi encerrada. Entre novamente para continuar.')
        manualSignOut.current = false
      }
    })
    return () => data.subscription.unsubscribe()
  }, [qc])

  const signOut = React.useCallback(async () => {
    manualSignOut.current = true
    await supabase.auth.signOut()
    localStorage.removeItem('vc.currentOrg')
  }, [])

  return (
    <AuthCtx.Provider value={{ session, user: session?.user ?? null, loading, signOut }}>{children}</AuthCtx.Provider>
  )
}

export function useAuth() {
  const ctx = React.useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth fora do AuthProvider')
  return ctx
}
