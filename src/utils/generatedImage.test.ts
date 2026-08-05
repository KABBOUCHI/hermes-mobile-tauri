import { describe, expect, it } from 'vitest'
import { generatedImageFromToolResult } from './generatedImage'

describe('generatedImageFromToolResult', () => {
  it('prefers the gateway-visible host image path', () => {
    expect(generatedImageFromToolResult('image_generate', JSON.stringify({
      agent_visible_image: '/sandbox/cat.png',
      host_image: '/host/cat.png',
      image: '/host/cat.png',
      success: true,
    }))).toBe('/host/cat.png')
  })

  it('accepts inline image URLs from a successful result', () => {
    expect(generatedImageFromToolResult('image_generate', JSON.stringify({
      image_url: { url: 'data:image/png;base64,pixels' },
      success: true,
    }))).toBe('data:image/png;base64,pixels')
  })

  it('ignores failed and unrelated tool results', () => {
    expect(generatedImageFromToolResult('image_generate', JSON.stringify({
      image: 'https://cdn.example/cat.png',
      success: false,
    }))).toBeNull()
    expect(generatedImageFromToolResult('read_file', JSON.stringify({
      image: '/host/not-a-generated-image.png',
      success: true,
    }))).toBeNull()
  })
})
