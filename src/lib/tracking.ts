/**
 * Medição de anúncios (Meta Pixel) e origem do cadastro (UTM).
 *
 * - O Pixel só carrega com VITE_META_PIXEL_ID definido E consentimento do visitante (LGPD).
 * - Nunca roda no painel, no admin nem na loja online dos estabelecimentos (/loja), cujos
 *   visitantes são clientes dos estabelecimentos, não nossos.
 * - Nenhum dado pessoal (nome, e-mail, telefone) é enviado ao Pixel.
 */
type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...a: unknown[]) => void; queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown }

declare global {
  interface Window {
    fbq?: Fbq
    _fbq?: Fbq
  }
}

const PIXEL_ID = ((import.meta.env.VITE_META_PIXEL_ID as string | undefined) ?? '').trim()
const CONSENT_KEY = 'vc.cookieConsent'
const ATTRIBUTION_KEY = 'vc.attribution'

export type Consent = 'granted' | 'denied'

export const pixelConfigured = /^\d{5,20}$/.test(PIXEL_ID)

/** Rotas onde nunca medimos: painel, admin, onboarding interno e lojas públicas dos clientes. */
export function isTrackablePath(pathname: string): boolean {
  return !/^\/(app|admin|loja|onboarding|redefinir-senha)(\/|$)/.test(pathname)
}

function safeGet(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function safeSet(storage: Storage | undefined, key: string, value: string) {
  try {
    storage?.setItem(key, value)
  } catch {
    /* modo privado / armazenamento bloqueado */
  }
}

const local = typeof window !== 'undefined' ? window.localStorage : undefined

export function getConsent(): Consent | null {
  const v = safeGet(local, CONSENT_KEY)
  return v === 'granted' || v === 'denied' ? v : null
}

const listeners = new Set<() => void>()
export function onConsentChange(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function setConsent(value: Consent) {
  safeSet(local, CONSENT_KEY, value)
  if (value === 'granted') loadPixel()
  listeners.forEach((fn) => fn())
}

let loaded = false

/** Snippet oficial do Meta Pixel (fbevents.js). */
function boot() {
  if (loaded || !pixelConfigured || typeof window === 'undefined') return
  loaded = true
  if (!window.fbq) {
    const n: Fbq = function (...args: unknown[]) {
      if (n.callMethod) n.callMethod(...args)
      else n.queue!.push(args)
    } as Fbq
    n.push = n
    n.loaded = true
    n.version = '2.0'
    n.queue = []
    window.fbq = n
    window._fbq = n
    const s = document.createElement('script')
    s.async = true
    s.src = 'https://connect.facebook.net/en_US/fbevents.js'
    document.head.appendChild(s)
  }
  window.fbq('init', PIXEL_ID)
}

/** Carrega o Pixel apenas em páginas públicas do VoltaCerta. */
function loadPixel() {
  if (typeof window !== 'undefined' && isTrackablePath(window.location.pathname)) boot()
}

export function trackPageView() {
  if (!pixelConfigured || getConsent() !== 'granted' || !isTrackablePath(window.location.pathname)) return
  boot()
  window.fbq?.('track', 'PageView')
}

type StandardEvent = 'CompleteRegistration' | 'StartTrial' | 'Purchase' | 'Lead' | 'InitiateCheckout'

/**
 * Evento padrão do Meta (sempre exige consentimento). `force` permite disparar em rota
 * não medida, como o pagamento confirmado dentro do painel; nesse caso só o evento é
 * enviado, sem PageView.
 */
export function trackEvent(event: StandardEvent, params?: Record<string, string | number>, opts?: { force?: boolean }) {
  if (!pixelConfigured || getConsent() !== 'granted' || typeof window === 'undefined') return
  if (!opts?.force && !isTrackablePath(window.location.pathname)) return
  boot()
  window.fbq?.('track', event, params ?? {})
}

// ---------------------------------------------------------------------------
// Origem do cadastro (primeiro toque): guardada só no navegador e enviada junto
// com o cadastro, para saber qual anúncio trouxe cada conta. Não depende de cookies
// de terceiros nem do Pixel.
// ---------------------------------------------------------------------------
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const
export type Attribution = Partial<Record<(typeof UTM_KEYS)[number] | 'fbclid' | 'landing' | 'referrer' | 'first_seen', string>>

export function captureAttribution(search: string, pathname: string) {
  if (typeof window === 'undefined' || !isTrackablePath(pathname)) return
  const params = new URLSearchParams(search)
  const found: Attribution = {}
  for (const k of UTM_KEYS) {
    const v = params.get(k)
    if (v) found[k] = v.slice(0, 100)
  }
  const fbclid = params.get('fbclid')
  if (fbclid) found.fbclid = fbclid.slice(0, 200)
  if (!Object.keys(found).length) {
    if (safeGet(local, ATTRIBUTION_KEY)) return
    // visita direta/orgânica: registra só a primeira página e a origem
    const ref = document.referrer && !document.referrer.startsWith(window.location.origin) ? document.referrer : ''
    safeSet(local, ATTRIBUTION_KEY, JSON.stringify({ landing: pathname, referrer: ref.slice(0, 200), first_seen: new Date().toISOString() }))
    return
  }
  // campanha paga sobrescreve visita orgânica anterior, mas não outra campanha
  const prev = getAttribution()
  if (prev.utm_source || prev.fbclid) return
  safeSet(local, ATTRIBUTION_KEY, JSON.stringify({ ...found, landing: pathname, first_seen: new Date().toISOString() }))
}

export function getAttribution(): Attribution {
  try {
    const raw = safeGet(local, ATTRIBUTION_KEY)
    const v = raw ? (JSON.parse(raw) as unknown) : null
    if (!v || typeof v !== 'object') return {}
    const out: Attribution = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === 'string') out[k as keyof Attribution] = val
    return out
  } catch {
    return {}
  }
}
