import { describe, expect, it } from 'vitest'
import { gatewayImageKey, gatewayImagePathFromMarkdownSrc, pendingGatewayImageRequests } from './gatewayImageLoading'

describe('gatewayImagePathFromMarkdownSrc', () => {
  it('accepts absolute gateway paths while leaving portable image sources alone', () => {
    expect(gatewayImagePathFromMarkdownSrc('/home/user/project/preview.png')).toBe('/home/user/project/preview.png')
    expect(gatewayImagePathFromMarkdownSrc('https://example.com/preview.png')).toBeNull()
    expect(gatewayImagePathFromMarkdownSrc('//example.com/preview.png')).toBeNull()
    expect(gatewayImagePathFromMarkdownSrc('data:image/png;base64,pixels')).toBeNull()
  })
})

describe('pendingGatewayImageRequests', () => {
  it('returns only unresolved gateway-backed images and deduplicates requests', () => {
    const messages = [
      {
        id: 'user-1',
        role: 'user' as const,
        content: 'Review these',
        timestamp: 1,
        imageAttachments: [
          { label: 'Portable', src: 'data:image/png;base64,pixels' },
          { label: 'Remote', gatewayPath: '/tmp/remote.png' },
          { label: 'Remote again', gatewayPath: '/tmp/remote.png' },
        ],
      },
    ]

    const requests = pendingGatewayImageRequests(messages, 'session-1', new Set(), new Set())

    expect(requests).toEqual([
      {
        key: gatewayImageKey('session-1', messages[0], messages[0].imageAttachments![1], 1),
        path: '/tmp/remote.png',
      },
    ])
  })

  it('skips images that are already resolved or being resolved', () => {
    const message = {
      id: 'user-1',
      role: 'user' as const,
      content: 'Review this',
      timestamp: 1,
      imageAttachments: [{ label: 'Remote', gatewayPath: '/tmp/remote.png' }],
    }
    const key = gatewayImageKey('session-1', message, message.imageAttachments[0], 0)

    expect(pendingGatewayImageRequests([message], 'session-1', new Set([key]), new Set())).toEqual([])
    expect(pendingGatewayImageRequests([message], 'session-1', new Set(), new Set([key]))).toEqual([])
  })
})
