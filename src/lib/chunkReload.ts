/**
 * Recuperação automática após uma nova publicação.
 *
 * Cada deploy gera arquivos JS com novos nomes (hash). Uma aba aberta antes do
 * deploy ainda aponta para os nomes antigos; ao navegar para uma tela carregada
 * sob demanda, o arquivo antigo não existe mais e o import falha. Nesses casos
 * recarregamos a página UMA vez para buscar a versão nova.
 */
const KEY = 'voltacerta:chunk-reload-at'

export function isChunkLoadError(error: unknown): boolean {
  const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Unable to preload CSS/i.test(msg)
}

/** Recarrega a página, no máximo uma vez a cada 30 s (evita laço se o problema for outro). */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0)
    if (Date.now() - last < 30_000) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    /* sessionStorage indisponível: recarrega mesmo assim */
  }
  window.location.reload()
  return true
}
