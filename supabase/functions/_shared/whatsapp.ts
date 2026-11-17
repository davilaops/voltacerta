// WhatsApp Business Cloud API (Meta) — envio de mensagem de modelo (template).
// POST https://graph.facebook.com/{versão}/{phone-number-id}/messages
// Authorization: Bearer {token}. Fora da janela de 24h só é permitido enviar
// modelos APROVADOS no WhatsApp Manager, com opt-in do cliente.
export const GRAPH_VERSION = 'v23.0'

export type ReminderKind = 'aniversario' | 'pos_venda' | 'lembrete_agendamento' | 'retorno_servico' | 'pacote_vencendo' | 'recompra'

export interface PendingMessage {
  dedupe_key: string
  kind: ReminderKind
  customer_id: string
  customer_name: string
  phone: string
  pet_name: string | null
  service_name: string | null
  product_name: string | null
  prediction_id: string | null
  date: string | null
  time: string | null
  template: { name: string; language: string } | null
}

/** Ordem fixa das variáveis {{1}}, {{2}}… de cada modelo (documentada na tela de integrações). */
export const TEMPLATE_PARAMS: Record<ReminderKind, string[]> = {
  aniversario: ['nome', 'pet'],
  pos_venda: ['nome'],
  lembrete_agendamento: ['nome', 'pet', 'servico', 'data', 'hora'],
  retorno_servico: ['nome', 'pet', 'servico'],
  pacote_vencendo: ['nome', 'pacote', 'data'],
  recompra: ['nome', 'produto'],
}

export function firstName(full: string): string {
  return (full ?? '').trim().split(/\s+/)[0] || 'cliente'
}

export function paramValues(m: PendingMessage): string[] {
  const map: Record<string, string> = {
    nome: firstName(m.customer_name),
    pet: m.pet_name || 'seu pet',
    servico: m.service_name || 'atendimento',
    pacote: m.service_name || 'pacote',
    produto: m.product_name || 'produto',
    data: m.date || '',
    hora: m.time || '',
  }
  return TEMPLATE_PARAMS[m.kind].map((k) => map[k])
}

/** Número no formato E.164 (+55…). phone_normalized já vem como 55DDDNÚMERO. */
export function toE164(phone: string): string | null {
  const d = (phone ?? '').replace(/\D/g, '')
  if (d.length < 12 || d.length > 13) return null
  return `+${d}`
}

export function buildTemplateBody(m: PendingMessage) {
  const to = toE164(m.phone)
  if (!to || !m.template) return null
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: m.template.name,
      language: { code: m.template.language || 'pt_BR' },
      components: [{ type: 'body', parameters: paramValues(m).map((text) => ({ type: 'text', text })) }],
    },
  }
}

/** Texto aproximado (para o histórico de contatos). */
export function previewText(m: PendingMessage): string {
  return `[${m.template?.name ?? m.kind}] ${paramValues(m).join(' · ')}`
}

export type SendResult = { ok: true; id: string } | { ok: false; error: string; code?: number }

export async function sendTemplate(
  phoneNumberId: string, token: string, body: unknown, fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  const res = await fetchImpl(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  // deno-lint-ignore no-explicit-any
  const data: any = await res.json().catch(() => ({}))
  const id = data?.messages?.[0]?.id
  if (res.ok && typeof id === 'string') return { ok: true, id }
  const err = data?.error
  const details = err?.error_data?.details ? ` — ${err.error_data.details}` : ''
  return { ok: false, error: `${err?.message ?? `HTTP ${res.status}`}${details}`.slice(0, 500), code: err?.code }
}
