import { supabase } from './supabase'

/** Converte "1.234,56" / "12,5" / 12.5 em número. Vazio => NaN. */
export function parseMoney(v: string | number | null | undefined): number {
  if (typeof v === 'number') return v
  const s = String(v ?? '').trim()
  if (!s) return NaN
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  return Number(normalized)
}

/** Número para o campo de texto no formato brasileiro (12.5 -> "12,50"). */
export function moneyInput(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return ''
  return Number(v).toFixed(2).replace('.', ',')
}

export const round2 = (v: number) => Math.round(v * 100) / 100

/** Chama uma Edge Function e lança erro com o código devolvido no corpo (ex.: FISCAL_DATA_MISSING). */
export async function invokeFunction<T>(name: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body: body as Record<string, unknown> })
  if (error) {
    let code = error.message
    let detail: string | undefined
    try {
      const parsed = await (error as { context?: Response }).context?.json()
      if (parsed?.error) code = parsed.error
      if (parsed?.detail) detail = String(parsed.detail)
    } catch {
      /* corpo indisponível */
    }
    const err = new Error(code) as Error & { details?: string }
    err.details = detail
    throw err
  }
  return data as T
}
