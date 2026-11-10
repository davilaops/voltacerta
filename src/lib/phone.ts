/** Espelha public.normalize_phone() do banco (a validação definitiva é no servidor). */
export function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null
  let d = p.replace(/\D/g, '')
  if (!d) return null
  d = d.replace(/^0+/, '')
  if (d.length === 10 || d.length === 11) d = '55' + d
  if (d.length < 10 || d.length > 15) return null
  return d
}
