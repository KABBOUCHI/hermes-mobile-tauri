/**
 * Desktop emits explicit preview actions as markdown links whose href starts
 * with #preview/. Keep the wire format small and decode it only at the UI
 * boundary, where the mobile client can choose an appropriate fallback.
 */
export function previewTargetFromMarkdownHref(href?: string): string | null {
  if (!href?.startsWith('#preview:') && !href?.startsWith('#preview/')) return null

  try {
    const target = decodeURIComponent(href.slice('#preview'.length + 1)).trim()
    return target || null
  } catch {
    return null
  }
}

export function previewName(target: string): string {
  try {
    const url = new URL(target)
    if (url.protocol === 'file:') {
      return decodeURIComponent(url.pathname).split(/[\\/]/).filter(Boolean).pop() || target
    }

    const file = url.pathname.split('/').filter(Boolean).pop()
    return file || url.host
  } catch {
    return target.split(/[\\/]/).filter(Boolean).pop() || target
  }
}
