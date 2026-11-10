import * as React from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, MessageCircle, TrendingUp } from 'lucide-react'
import { Logo } from '@/components/brand/Logo'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  useDocumentTitle(title)
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,520px)]">
      <aside className="relative hidden overflow-hidden border-r border-border bg-surface lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{ background: 'radial-gradient(600px circle at 20% 0%, rgb(34 197 139 / 0.10), transparent 60%)' }}
        />
        <Link to="/" className="relative">
          <Logo />
        </Link>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Seus clientes não precisam lembrar de voltar.
            <span className="text-brand"> O VoltaCerta lembra por você.</span>
          </h2>
          <ul className="mt-8 space-y-4 text-sm text-muted">
            {[
              { icon: CalendarClock, text: 'Previsão de recompra por cliente e produto' },
              { icon: MessageCircle, text: 'Contato pelo WhatsApp com mensagens prontas' },
              { icon: TrendingUp, text: 'Receita recuperada medida com dados reais' },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="grid size-8 place-items-center rounded-md border border-border bg-surface-2 text-brand">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-subtle">© {new Date().getFullYear()} VoltaCerta</p>
      </aside>
      <main className="flex flex-col justify-center px-5 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-sm page-enter">
          <Link to="/" className="mb-10 inline-block lg:hidden">
            <Logo />
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
        </div>
      </main>
    </div>
  )
}
