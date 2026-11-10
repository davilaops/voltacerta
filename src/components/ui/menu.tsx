import * as React from 'react'
import * as DM from '@radix-ui/react-dropdown-menu'
import * as T from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

export const Menu = DM.Root
export const MenuTrigger = DM.Trigger

export function MenuContent({ children, align = 'end' }: { children: React.ReactNode; align?: 'start' | 'end' }) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={6}
        className="z-50 min-w-44 rounded-lg border border-border bg-surface p-1 shadow-pop animate-fade-in"
      >
        {children}
      </DM.Content>
    </DM.Portal>
  )
}

export function MenuItem({ className, danger, ...props }: DM.DropdownMenuItemProps & { danger?: boolean }) {
  return (
    <DM.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none transition-colors [&_svg]:size-4',
        danger ? 'text-[#ff7a7a] data-[highlighted]:bg-danger/10' : 'text-fg/90 data-[highlighted]:bg-surface-2',
        className,
      )}
      {...props}
    />
  )
}

export const MenuSeparator = () => <DM.Separator className="my-1 h-px bg-border" />

export const Tabs = T.Root
export const TabsContent = T.Content

export function TabsList({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <T.List className={cn('flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]', className)}>{children}</T.List>
  )
}

export function TabsTrigger({ value, children, count }: { value: string; children: React.ReactNode; count?: number }) {
  return (
    <T.Trigger
      value={value}
      className="relative -mb-px flex shrink-0 items-center gap-2 border-b-2 border-transparent px-3 py-2.5 text-sm text-muted transition-colors hover:text-fg data-[state=active]:border-brand data-[state=active]:text-fg"
    >
      {children}
      {count != null && (
        <span className="rounded-full bg-surface-2 px-1.5 py-px text-[11px] tabular text-muted">{count}</span>
      )}
    </T.Trigger>
  )
}

/** Controle segmentado (filtros de período, etc.) */
export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-md border border-border bg-surface p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-7 rounded-[5px] px-3 text-[13px] font-medium transition-colors',
            value === o.value ? 'bg-surface-3 text-fg shadow-sm' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
