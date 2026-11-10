const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const num = new Intl.NumberFormat('pt-BR')
const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
const shortDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' })

export const formatCurrency = (v: number | string | null | undefined) => brl.format(Number(v ?? 0))
export const formatNumber = (v: number | string | null | undefined) => num.format(Number(v ?? 0))
export const formatPercent = (v: number | null | undefined) => (v == null ? '—' : `${num.format(v)}%`)

/** Datas "YYYY-MM-DD" (sem hora) são formatadas como datas locais, sem deslocamento de fuso. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return dateFmt.format(new Date(iso.slice(0, 10) + 'T00:00:00Z'))
}

export function formatShortDate(iso: string): string {
  return shortDate.format(new Date(iso.slice(0, 10) + 'T00:00:00Z')).replace('.', '')
}

export function formatDateTime(iso: string | null | undefined, timeZone = 'America/Sao_Paulo'): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone }).format(new Date(iso))
}

export function formatRelativeDays(days: number): string {
  if (days === 0) return 'hoje'
  if (days === 1) return 'amanhã'
  if (days === -1) return 'ontem'
  return days > 0 ? `em ${days} dias` : `há ${Math.abs(days)} dias`
}

/** Exibe telefone brasileiro: 5511988887777 -> (11) 98888-7777 */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '—'
  let d = raw.replace(/\D/g, '')
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2)
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return raw
}
