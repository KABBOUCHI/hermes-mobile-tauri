import { describe, expect, it, vi } from 'vitest'
import { sanitizeTextForSpeech, speakText, stopSpeech, type SpeechEngine, type SpeechUtterance } from './speech'

function fakeSpeechEngine() {
  let current: SpeechUtterance | null = null
  const engine: SpeechEngine = {
    createUtterance: (text: string) => ({ text, onend: null, onerror: null }),
    speak: vi.fn(utterance => { current = utterance }),
    cancel: vi.fn(),
  }
  return { engine, current: () => current }
}

describe('sanitizeTextForSpeech', () => {
  it('removes markdown, links, emoji, and fenced code while preserving prose', () => {
    expect(sanitizeTextForSpeech('## Hello **there** [docs](https://example.com)\n```ts\nconst x = 1\n``` 🚀'))
      .toBe('Hello there docs')
  })
})

describe('speakText', () => {
  it('speaks sanitized text and resolves when playback ends', async () => {
    const { engine, current } = fakeSpeechEngine()
    const pending = speakText('**Hello**', engine)

    expect(engine.speak).toHaveBeenCalledTimes(1)
    expect(current()?.text).toBe('Hello')
    current()?.onend?.()

    await expect(pending).resolves.toBe(true)
})

  it('cancels and resolves the active request as stopped', async () => {
    const { engine } = fakeSpeechEngine()
    const pending = speakText('Read this', engine)

    stopSpeech()

    expect(engine.cancel).toHaveBeenCalledTimes(1)
    await expect(pending).resolves.toBe(false)
  })

  it('does not invoke an engine for empty text', async () => {
    const { engine } = fakeSpeechEngine()

    await expect(speakText('```code```', engine)).resolves.toBe(false)
    expect(engine.speak).not.toHaveBeenCalled()
  })
})
