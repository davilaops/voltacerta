import * as React from 'react'
import * as D from '@radix-ui/react-dialog'
import * as AD from '@radix-ui/react-alert-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './button'

const overlay = 'fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-fade-in'

interface DialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
}

/** Modal centralizado no desktop; vira "bottom sheet" no celular. */
export function Dialog({ open, onOpenChange, title, description, children, footer, size = 'md' }: DialogProps) {
  const width = size === 'sm' ? 'sm:max-w-md' : size === 'lg' ? 'sm:max-w-3xl' : 'sm:max-w-xl'
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlay} />
        <D.Content
          className={cn(
            'fixed z-50 flex max-h-[92dvh] w-full flex-col border border-border bg-surface shadow-pop outline-none',
            'inset-x-0 bottom-0 rounded-t-xl animate-slide-up',
            'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl',
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <D.Title className="text-base font-semibold text-fg">{title}</D.Title>
              {description ? (
                <D.Description className="mt-1 text-[13px] text-muted">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">{title}</D.Description>
              )}
            </div>
            <D.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Fechar">
                <X />
              </Button>
            </D.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
              {footer}
            </div>
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

/** Painel lateral (navegação móvel). */
export function Sheet({ open, onOpenChange, children, title }: { open: boolean; onOpenChange: (o: boolean) => void; children: React.ReactNode; title: string }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlay} />
        <D.Content className="fixed inset-y-0 left-0 z-50 flex w-[82vw] max-w-72 flex-col border-r border-border bg-bg shadow-pop outline-none animate-[slide-in_0.25s_ease-out]">
          <D.Title className="sr-only">{title}</D.Title>
          <D.Description className="sr-only">{title}</D.Description>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

interface ConfirmOptions {
  title: string
  description: string
  confirmLabel?: string
  danger?: boolean
}

type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>
const ConfirmCtx = React.createContext<ConfirmFn>(async () => false)

/** Diálogo de confirmação global: `const ok = await confirm({...})` */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)
  const confirm = React.useCallback<ConfirmFn>((o) => new Promise((resolve) => setState({ ...o, resolve })), [])
  const close = (v: boolean) => {
    state?.resolve(v)
    setState(null)
  }
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <AD.Root open={!!state} onOpenChange={(o) => !o && close(false)}>
        <AD.Portal>
          <AD.Overlay className={overlay} />
          <AD.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-5 shadow-pop animate-slide-up">
            <AD.Title className="text-base font-semibold">{state?.title}</AD.Title>
            <AD.Description className="mt-2 text-sm text-muted">{state?.description}</AD.Description>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AD.Cancel asChild>
                <Button variant="secondary">Cancelar</Button>
              </AD.Cancel>
              <AD.Action asChild>
                <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
                  {state?.confirmLabel ?? 'Confirmar'}
                </Button>
              </AD.Action>
            </div>
          </AD.Content>
        </AD.Portal>
      </AD.Root>
    </ConfirmCtx.Provider>
  )
}

export const useConfirm = () => React.useContext(ConfirmCtx)
