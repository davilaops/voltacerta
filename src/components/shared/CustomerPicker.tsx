import * as React from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useCustomerSearch } from '@/features/customers/api'
import { formatPhone } from '@/lib/format'

export interface PickedCustomer {
  id: string
  full_name: string
  phone?: string | null
}

/** Busca e seleção de cliente (nome ou telefone). */
export function CustomerPicker({
  value,
  onChange,
  placeholder = 'Buscar cliente por nome ou telefone',
  emptyLabel,
  autoFocus,
}: {
  value: PickedCustomer | null
  onChange: (c: PickedCustomer | null) => void
  placeholder?: string
  /** Texto exibido quando nenhum cliente está selecionado e a seleção é opcional (ex.: "Consumidor final"). */
  emptyLabel?: string
  autoFocus?: boolean
}) {
  const [search, setSearch] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const customers = useCustomerSearch(search)

  if (value) {
    return (
      <div className="flex h-10 items-center justify-between gap-2 rounded-md border border-border bg-surface-2/60 px-3 text-sm sm:h-9">
        <span className="min-w-0 truncate">
          <span className="font-medium">{value.full_name}</span>
          {value.phone && <span className="ml-2 text-xs text-subtle">{formatPhone(value.phone)}</span>}
        </span>
        <button type="button" className="shrink-0 text-subtle hover:text-fg" aria-label="Remover cliente" onClick={() => onChange(null)}>
          <X className="size-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <Input
        autoFocus={autoFocus}
        placeholder={emptyLabel ? `${emptyLabel} — ou ${placeholder.toLowerCase()}` : placeholder}
        className="pl-9"
        value={search}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setSearch(e.target.value)
          setOpen(true)
        }}
        aria-label="Buscar cliente"
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-surface shadow-pop">
          {customers.isLoading && <div className="px-3 py-2 text-[13px] text-subtle">Buscando…</div>}
          {customers.data?.length === 0 && <div className="px-3 py-2 text-[13px] text-subtle">Nenhum cliente encontrado.</div>}
          {customers.data?.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(c)
                setSearch('')
                setOpen(false)
              }}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface-2"
            >
              <span className="truncate">{c.full_name}</span>
              <span className="ml-2 shrink-0 text-xs text-subtle">{c.phone ? formatPhone(c.phone) : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
