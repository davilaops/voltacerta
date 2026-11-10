import * as React from 'react'
import { cn } from '@/lib/utils'
import type { Tone } from '@/domain/labels'

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-border bg-surface shadow-card', className)} {...props} />
}

export function CardHeader({ className, title, description, action }: { className?: string; title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-5 pt-5 pb-3', className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />
}

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-fg/80 border-border-strong',
  brand: 'bg-brand/10 text-brand border-brand/25',
  warning: 'bg-warning/10 text-warning border-warning/25',
  danger: 'bg-danger/10 text-[#ff7a7a] border-danger/25',
  info: 'bg-info/10 text-info border-info/25',
  muted: 'bg-surface-2 text-muted border-border',
}

export function Badge({ tone = 'neutral', className, children, dot }: { tone?: Tone; className?: string; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium', toneClasses[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('rounded-md bg-surface-2 animate-shimmer', className)}
      style={{ backgroundImage: 'linear-gradient(90deg, transparent 0, rgb(255 255 255 / 0.04) 50%, transparent 100%)', backgroundSize: '800px 100%' }}
    />
  )
}

export function Separator({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-border', className)} />
}
