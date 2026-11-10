export const DEFAULT_TZ = 'America/Sao_Paulo'

/** Data local (YYYY-MM-DD) em um fuso horário — evita o erro clássico de usar UTC. */
export function todayISO(timeZone = DEFAULT_TZ, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function diffDaysISO(a: string, b: string): number {
  return Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000)
}

export type PeriodPreset = '7d' | '30d' | '90d' | 'custom'
export interface Period {
  preset: PeriodPreset
  from: string
  to: string
}

export function periodFromPreset(preset: Exclude<PeriodPreset, 'custom'>, today = todayISO()): Period {
  const days = preset === '7d' ? 6 : preset === '30d' ? 29 : 89
  return { preset, from: addDaysISO(today, -days), to: today }
}

export function isValidPeriod(p: { from: string; to: string }, maxDays = 366): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.from) || !/^\d{4}-\d{2}-\d{2}$/.test(p.to)) return false
  const span = diffDaysISO(p.to, p.from)
  return span >= 0 && span <= maxDays
}
