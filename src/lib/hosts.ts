/**
 * Arquitetura de subdomínios:
 *   VITE_SITE_URL  -> landing page        (ex.: https://voltacerta.com.br)
 *   VITE_APP_URL   -> painel do cliente   (ex.: https://app.voltacerta.com.br)
 *   VITE_ADMIN_URL -> painel Super Admin  (ex.: https://admin.voltacerta.com.br)
 *
 * Um único build é publicado nos três domínios; a "superfície" é escolhida
 * pelo hostname. Em desenvolvimento (mesma origem para tudo), o admin fica em /admin.
 */
export type Surface = 'site' | 'app' | 'admin' | 'all'

const env = import.meta.env
const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'

function parse(u: string | undefined): URL | null {
  try {
    return u ? new URL(u) : null
  } catch {
    return null
  }
}

export const SITE_URL = parse(env.VITE_SITE_URL as string | undefined)
export const APP_URL = parse(env.VITE_APP_URL as string | undefined)
export const ADMIN_URL = parse(env.VITE_ADMIN_URL as string | undefined)

export function detectSurface(hostname: string): Surface {
  if (ADMIN_URL && hostname === ADMIN_URL.hostname && ADMIN_URL.hostname !== APP_URL?.hostname) return 'admin'
  if (APP_URL && SITE_URL && APP_URL.hostname !== SITE_URL.hostname) {
    if (hostname === APP_URL.hostname) return 'app'
    if (hostname === SITE_URL.hostname || hostname === `www.${SITE_URL.hostname}`) return 'site'
  }
  return 'all' // desenvolvimento / domínio único
}

export const surface: Surface = typeof window !== 'undefined' ? detectSurface(window.location.hostname) : 'all'

/** Prefixo de rotas do painel admin: "/" no subdomínio próprio, "/admin" em desenvolvimento. */
export const ADMIN_BASENAME = surface === 'admin' ? '/' : '/admin'

export function isAdminEntry(pathname: string): boolean {
  return surface === 'admin' || (surface === 'all' && (pathname === '/admin' || pathname.startsWith('/admin/')))
}

/** URL para uma rota do painel do cliente (absoluta se estiver em outro subdomínio). */
export function appHref(path: string): string {
  if (surface === 'site' && APP_URL) return new URL(path, APP_URL).toString()
  return path
}

export function isExternalHref(href: string): boolean {
  return /^https?:\/\//.test(href) && !href.startsWith(origin)
}

/** Base pública usada nos links de e-mail (confirmação, recuperação de senha). */
export const appBaseUrl = (APP_URL ?? parse(origin)!).origin
export const adminBaseUrl = ADMIN_URL ? ADMIN_URL.origin : `${origin}/admin`
