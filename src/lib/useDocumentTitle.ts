import { useEffect } from 'react'

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · VoltaCerta` : 'VoltaCerta — Recompra inteligente para pet shops'
  }, [title])
}
