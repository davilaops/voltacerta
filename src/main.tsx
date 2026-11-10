import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { App } from './App'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { ConfirmProvider } from '@/components/ui/dialog'
import { isAuthError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import './index.css'

/** Sessão expirada em qualquer consulta => encerra a sessão local (redireciona ao login). */
const onError = (err: unknown) => {
  if (isAuthError(err)) void supabase.auth.signOut()
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !isAuthError(err) && count < 2,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ConfirmProvider>
          <App />
          <Toaster
            theme="dark"
            position="top-right"
            toastOptions={{
              classNames: {
                toast: '!bg-surface !border !border-border !text-fg !shadow-pop !rounded-lg',
                description: '!text-muted',
              },
            }}
          />
        </ConfirmProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
