import { Lock } from 'lucide-react'

export function ReadOnlyNotice() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2/50 px-3 py-2 text-[13px] text-muted">
      <Lock className="size-4 shrink-0" /> Somente proprietários e administradores podem alterar esta seção.
    </div>
  )
}
