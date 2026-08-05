/**
 * Resolve the displayable image source from an `image_generate` tool result.
 *
 * The gateway serialises tool output as text in session history, while live
 * responses may carry the same payload as an object. Desktop prefers the host
 * path because it is the path the gateway can serve back to a remote client;
 * mobile follows that contract and falls back to inline/remote URL forms.
 */
function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  if (typeof value !== 'string' || !value.trim()) return null

  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function sourceFromValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  return sourceFromValue(record.url ?? record.data_url)
}

/** Return the image path or URL from a successful image-generation result. */
export function generatedImageFromToolResult(toolName: string | undefined, content: unknown): string | null {
  if (toolName !== 'image_generate') return null

  const record = recordFromUnknown(content)
  if (!record || record.success === false) return null

  const result = recordFromUnknown(record.result) || record
  if (result.success === false) return null

  for (const key of ['host_image', 'image', 'image_url', 'url', 'data_url']) {
    const source = sourceFromValue(result[key])
    if (source) return source
  }

  return null
}

/** Inline and remote URLs can be used directly by an image element. */
export function isInlineImageSource(source: string): boolean {
  return /^(?:https?|data):/i.test(source.trim())
}
