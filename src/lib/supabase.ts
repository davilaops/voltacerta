import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)
export const isDevEnvironment = (import.meta.env.VITE_APP_ENV ?? import.meta.env.MODE) !== 'production'
export const appUrl =
  (import.meta.env.VITE_APP_URL as string | undefined) ?? (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173')

// Apenas a chave pública (anon). Segredos e service role ficam nas Edge Functions.
export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

/** Executa uma RPC lançando erro (nunca falha silenciosamente). */
export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

export function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error
  return res.data as T
}
