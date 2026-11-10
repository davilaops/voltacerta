import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  if (total <= pageSize) return null
  const last = Math.ceil(total / pageSize) - 1
  return (
    <div className="flex items-center justify-between border-t border-border px-5 py-3 text-[13px] text-muted">
      <span className="tabular">
        {page * pageSize + 1}–{Math.min(total, (page + 1) * pageSize)} de {total}
      </span>
      <div className="flex gap-1">
        <Button variant="ghost" size="icon-sm" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Página anterior">
          <ChevronLeft />
        </Button>
        <Button variant="ghost" size="icon-sm" disabled={page >= last} onClick={() => onPage(page + 1)} aria-label="Próxima página">
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}
