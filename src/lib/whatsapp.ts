import { normalizePhone } from './phone'

export interface TemplateVars {
  nome?: string | null
  produto?: string | null
  pet?: string | null
  loja?: string | null
  servico?: string | null
  data?: string | null
  hora?: string | null
  pacote?: string | null
}

/** Substitui {nome}, {produto}, {pet}, {loja}, {servico}, {data}, {hora}, {pacote}. Usa apenas o primeiro nome do cliente. */
export function renderTemplate(body: string, vars: TemplateVars): string {
  const firstName = vars.nome?.trim().split(/\s+/)[0] ?? ''
  const map: Record<string, string> = {
    nome: firstName,
    produto: vars.produto?.trim() || 'seus produtos',
    pet: vars.pet?.trim() || 'seu pet',
    loja: vars.loja?.trim() || '',
    servico: vars.servico?.trim() || 'atendimento',
    data: vars.data?.trim() || '',
    hora: vars.hora?.trim() || '',
    pacote: vars.pacote?.trim() || 'pacote',
  }
  return body.replace(/\{(nome|produto|pet|loja|servico|data|hora|pacote)\}/g, (_, k: string) => map[k])
}

/** Link wa.me com mensagem corretamente codificada. Retorna null sem telefone válido. */
export function buildWhatsAppLink(phone: string | null | undefined, message?: string): string | null {
  const n = normalizePhone(phone)
  if (!n) return null
  const base = `https://wa.me/${n}`
  return message ? `${base}?text=${encodeURIComponent(message)}` : base
}

export const TEMPLATE_VARIABLES = ['{nome}', '{produto}', '{pet}', '{loja}', '{servico}', '{data}', '{hora}', '{pacote}'] as const
