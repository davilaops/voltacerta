import * as React from 'react'
import { Link } from 'react-router-dom'
import { appHref, isExternalHref } from '@/lib/hosts'

/** Link para rotas do painel do cliente; vira link absoluto quando o painel está em outro subdomínio. */
export const AppLink = React.forwardRef<HTMLAnchorElement, { to: string; className?: string; children: React.ReactNode; onClick?: () => void }>(
  ({ to, ...props }, ref) => {
    const href = appHref(to)
    return isExternalHref(href) ? <a ref={ref} href={href} {...props} /> : <Link ref={ref} to={href} {...props} />
  },
)
AppLink.displayName = 'AppLink'
