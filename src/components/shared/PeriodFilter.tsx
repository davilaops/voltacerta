import * as React from 'react'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/menu'
import { isValidPeriod, periodFromPreset, type Period, type PeriodPreset } from '@/lib/dates'

export function usePeriod(today: string, initial: Exclude<PeriodPreset, 'custom'> = '30d') {
  return React.useState<Period>(() => periodFromPreset(initial, today))
}

export function PeriodFilter({ value, onChange, today, maxDays = 366 }: { value: Period; onChange: (p: Period) => void; today: string; maxDays?: number }) {
  const [draft, setDraft] = React.useState({ from: value.from, to: value.to })
  React.useEffect(() => setDraft({ from: value.from, to: value.to }), [value.from, value.to])
  const invalid = value.preset === 'custom' && !isValidPeriod(draft, maxDays)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented<PeriodPreset>
        value={value.preset}
        onChange={(p) => (p === 'custom' ? onChange({ ...value, preset: 'custom' }) : onChange(periodFromPreset(p, today)))}
        options={[
          { value: '7d', label: '7 dias' },
          { value: '30d', label: '30 dias' },
          { value: '90d', label: '90 dias' },
          { value: 'custom', label: 'Personalizado' },
        ]}
      />
      {value.preset === 'custom' && (
        <div className="flex items-center gap-2 animate-fade-in">
          <Input
            type="date"
            aria-label="Data inicial"
            className="h-8 w-[150px] sm:h-8"
            value={draft.from}
            max={draft.to}
            aria-invalid={invalid}
            onChange={(e) => {
              const next = { ...draft, from: e.target.value }
              setDraft(next)
              if (isValidPeriod(next, maxDays)) onChange({ preset: 'custom', ...next })
            }}
          />
          <span className="text-subtle">–</span>
          <Input
            type="date"
            aria-label="Data final"
            className="h-8 w-[150px] sm:h-8"
            value={draft.to}
            max={today}
            aria-invalid={invalid}
            onChange={(e) => {
              const next = { ...draft, to: e.target.value }
              setDraft(next)
              if (isValidPeriod(next, maxDays)) onChange({ preset: 'custom', ...next })
            }}
          />
          {invalid && <span className="text-xs text-danger">Período inválido (máx. {maxDays} dias)</span>}
        </div>
      )}
    </div>
  )
}
