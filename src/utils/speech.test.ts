import { describe, expect, it, vi } from 'vitest'
import { beginSpeech, playSpeechDataUrl, sanitizeTextForSpeech, stopSpeech, type AudioPlayer } from './speech'

function fakeAudioPlayer() {
  let current: AudioPlayer | null = null
  const player: AudioPlayer = {
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    load: vi.fn(),
    onended: null,
    onerror: null,
  }
  const createPlayer = vi.fn(() => {
    current = player
    return player
  })
  return { createPlayer, player: () => current }
}

describe('sanitizeTextForSpeech', () => {
  it('removes markdown, links, emoji, and fenced code while preserving prose', () => {
    expect(sanitizeTextForSpeech('## Hello **there** [docs](https://example.com)\n```ts\nconst x = 1\n``` 🚀'))
      .toBe('Hello there docs')
  })
})

describe('playSpeechDataUrl', () => {
  it('plays gateway audio and resolves when playback ends', async () => {
    const { createPlayer, player } = fakeAudioPlayer()
    const requestId = beginSpeech()
    const pending = playSpeechDataUrl('data:audio/mpeg;base64,AA==', requestId, createPlayer)

    expect(createPlayer).toHaveBeenCalledWith('data:audio/mpeg;base64,AA==')
    expect(player()?.play).toHaveBeenCalledTimes(1)
    player()?.onended?.()

    await expect(pending).resolves.toBe(true)
  })

  it('cancels and resolves the active request as stopped', async () => {
    const { createPlayer, player } = fakeAudioPlayer()
    const requestId = beginSpeech()
    const pending = playSpeechDataUrl('data:audio/mpeg;base64,AA==', requestId, createPlayer)

    stopSpeech()

    expect(player()?.pause).toHaveBeenCalledTimes(1)
    expect(player()?.load).toHaveBeenCalledTimes(1)
    await expect(pending).resolves.toBe(false)
  })

  it('does not create a player for a stale request or invalid audio', async () => {
    const { createPlayer } = fakeAudioPlayer()
    const requestId = beginSpeech()
    stopSpeech()

    await expect(playSpeechDataUrl('data:audio/mpeg;base64,AA==', requestId, createPlayer)).resolves.toBe(false)
    await expect(playSpeechDataUrl('not-audio', beginSpeech(), createPlayer)).resolves.toBe(false)
    expect(createPlayer).not.toHaveBeenCalled()
  })
})
