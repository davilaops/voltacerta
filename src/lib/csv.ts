export type CsvColumn<T> = { key: keyof T & string; label: string; format?: (v: unknown, row: T) => string }

function escapeCell(v: string): string {
  // Evita injeção de fórmula ao abrir no Excel/Sheets
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** CSV com separador ";" e BOM UTF-8 (abre corretamente no Excel em pt-BR). */
export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCell(c.label)).join(';')
  const lines = rows.map((row) =>
    columns
      .map((c) => {
        const raw = row[c.key]
        const text = c.format ? c.format(raw, row) : raw == null ? '' : String(raw)
        return escapeCell(text)
      })
      .join(';'),
  )
  return '﻿' + [header, ...lines].join('\r\n')
}

export function downloadFile(filename: string, content: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
