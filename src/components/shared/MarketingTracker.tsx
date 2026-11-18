import * as React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Cookie } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { captureAttribution, getConsent, isTrackablePath, onConsentChange, pixelConfigured, setConsent, trackPageView } from '@/lib/tracking'

/**
 * Registra a origem da visita (UTM) e, com consentimento, a visualização de página no
 * Meta Pixel. Mostra o aviso de cookies só nas páginas públicas e só se o Pixel existir.
 */
export function MarketingTracker() {
  const location = useLocation()
  const [consent, setLocal] = React.useState(getConsent)

  React.useEffect(() => onConsentChange(() => setLocal(getConsent())), [])

  React.useEffect(() => {
    captureAttribution(location.search, location.pathname)
  }, [location.search, location.pathname])

  React.useEffect(() => {
    if (consent === 'granted') trackPageView()
  }, [location.pathname, consent])

  if (!pixelConfigured || consent || !isTrackablePath(location.pathname)) return null

  return (
    <div role="dialog" aria-label="Aviso de cookies" className="fixed inset-x-0 bottom-0 z-50 p-3 sm:bottom-4 sm:left-4 sm:right-auto sm:max-w-sm sm:p-0">
      <div className="rounded-xl border border-border bg-surface p-4 shadow-pop">
        <div className="flex gap-3">
          <Cookie className="mt-0.5 size-5 shrink-0 text-brand" />
          <p className="text-[13px] leading-relaxed text-muted">
            Usamos cookies da Meta para medir nossos anúncios. Nenhum dado do seu pet shop é enviado.{' '}
            <Link to="/privacidade" className="text-fg underline">Saiba mais</Link>
          </p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="secondary" size="sm" onClick={() => setConsent('denied')}>Recusar</Button>
          <Button size="sm" onClick={() => setConsent('granted')}>Aceitar</Button>
        </div>
      </div>
    </div>
  )
}
