import * as React from 'react'
import { AlertTriangle, type LucideIcon } from 'lucide-react'
import { Button } from './button'
import { Skeleton } from './card'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

export function EmptyState({ icon: Icon, title, description, action, className }: { icon: LucideIcon; title: string; description: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center animate-fade-in', className)}>
      <div className="mb-4 grid size-11 place-items-center rounded-lg border border-border bg-surface-2 text-muted">
        <Icon className="size-5" />
      </div>
      <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-muted">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)} role="alert">
      <div className="mb-3 grid size-10 place-items-center rounded-lg bg-danger/10 text-danger">
        <AlertTriangle className="size-5" />
      </div>
      <p className="text-sm font-medium text-fg">Não foi possível carregar</p>
      <p className="mt-1 text-sm text-muted">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
  )
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-3.5">
          {Array.from({ length: cols }).map((__, j) => (
            <Skeleton key={j} className={cn('h-4', j === 0 ? 'w-40' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** Tabela responsiva: em telas pequenas, use `mobile` para renderizar cartões. */
export function DataTable({ head, children, mobile }: { head: React.ReactNode; children: React.ReactNode; mobile?: React.ReactNode }) {
  return (
    <>
      <div className={cn('overflow-x-auto', mobile && 'hidden md:block')}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-subtle [&>th]:px-5 [&>th]:py-2.5 [&>th]:font-medium">
              {head}
            </tr>
          </thead>
          <tbody className="divide-y divide-border [&>tr]:transition-colors [&>tr:hover]:bg-surface-2/50 [&_td]:px-5 [&_td]:py-3">
            {children}
          </tbody>
        </table>
      </div>
      {mobile && <div className="divide-y divide-border md:hidden">{mobile}</div>}
    </>
  )
}
