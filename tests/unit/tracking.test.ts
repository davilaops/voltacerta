import { beforeEach, describe, expect, it, vi } from 'vitest'

function fakeStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
}

async function load(pixelId = '') {
  vi.resetModules()
  vi.stubEnv('VITE_META_PIXEL_ID', pixelId)
  const localStorage = fakeStorage()
  vi.stubGlobal('window', { localStorage, location: { origin: 'https://voltacerta-brown.vercel.app', pathname: '/' } })
  vi.stubGlobal('document', { referrer: '' })
  return import('@/lib/tracking')
}

describe('tracking', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('nunca mede painel, admin, onboarding nem lojas dos clientes', async () => {
    const t = await load()
    for (const p of ['/app', '/app/clientes/1', '/admin', '/loja/pet-legal', '/onboarding', '/redefinir-senha']) expect(t.isTrackablePath(p)).toBe(false)
    for (const p of ['/', '/cadastro', '/entrar', '/privacidade', '/aplicativo']) expect(t.isTrackablePath(p)).toBe(true)
  })

  it('pixel só é considerado configurado com ID numérico', async () => {
    expect((await load('')).pixelConfigured).toBe(false)
    expect((await load('abc')).pixelConfigured).toBe(false)
    expect((await load('123456789012345')).pixelConfigured).toBe(true)
  })

  it('guarda a origem da campanha (primeiro toque) e não sobrescreve outra campanha', async () => {
    const t = await load()
    t.captureAttribution('', '/')
    expect(t.getAttribution().landing).toBe('/')
    t.captureAttribution('?utm_source=facebook&utm_campaign=teste&fbclid=abc', '/')
    expect(t.getAttribution()).toMatchObject({ utm_source: 'facebook', utm_campaign: 'teste', fbclid: 'abc' })
    t.captureAttribution('?utm_source=google', '/cadastro')
    expect(t.getAttribution().utm_source).toBe('facebook')
  })

  it('não captura origem dentro do painel nem da loja online', async () => {
    const t = await load()
    t.captureAttribution('?utm_source=facebook', '/loja/pet-legal')
    expect(t.getAttribution()).toEqual({})
  })

  it('sem consentimento não carrega o pixel', async () => {
    const t = await load('123456789012345')
    t.trackEvent('CompleteRegistration')
    expect((globalThis as unknown as { window: { fbq?: unknown } }).window.fbq).toBeUndefined()
    expect(t.getConsent()).toBeNull()
  })
})
