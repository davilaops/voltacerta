import { useEffect } from 'react'

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · VoltaCerta` : 'VoltaCerta — Sistema de gestão e recompra para o seu negócio'
  }, [title])
}
