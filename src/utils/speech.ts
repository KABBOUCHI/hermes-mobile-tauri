const EMOJI_RE = /(?:[\u{1F000}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|[\u{FE0F}\u{200D}]|[\u{E0020}-\u{E007F}])+/gu
const FENCED_CODE_RE = /```[\s\S]*?(?:```|$)/g
const INLINE_CODE_RE = /`([^`]+)`/g
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g
const URL_RE = /\bhttps?:\/\/\S+/gi

/** Keep spoken replies useful without reading markdown syntax or code aloud. */
export function sanitizeTextForSpeech(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/(\p{L})-\n(\p{L})/gu, '$1$2')
    .replace(FENCED_CODE_RE, ' ')
    .replace(MARKDOWN_LINK_RE, '$1')
    .replace(INLINE_CODE_RE, '$1')
    .replace(URL_RE, ' link ')
    .replace(EMOJI_RE, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>#]/g, '')
    .replace(/^\s*[-+*]\s+/gm, '')
    .replace(/[ \t]*\n{2,}[ \t]*/g, '. ')
    .replace(/[ \t]*\n[ \t]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface SpeechUtterance {
  text: string
  onend: (() => void) | null
  onerror: (() => void) | null
}

export interface SpeechEngine {
  createUtterance: (text: string) => SpeechUtterance
  speak: (utterance: SpeechUtterance) => void
  cancel: () => void
}

function browserSpeechEngine(): SpeechEngine | null {
  if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
    return null
  }

  return {
    createUtterance: (text: string) => {
      const utterance = new SpeechSynthesisUtterance(text)
      return utterance as unknown as SpeechUtterance
    },
    speak: utterance => window.speechSynthesis.speak(utterance as SpeechSynthesisUtterance),
    cancel: () => window.speechSynthesis.cancel(),
  }
}

let requestId = 0
let activeEngine: SpeechEngine | null = null
let settleActive: ((spoken: boolean) => void) | null = null

/** Stop the current message, if any. Starting another message also stops it. */
export function stopSpeech(): void {
  requestId += 1
  activeEngine?.cancel()
  activeEngine = null
  settleActive?.(false)
  settleActive = null
}

/** Speak one complete assistant message using the device's built-in voice. */
export function speakText(text: string, engine: SpeechEngine | null = browserSpeechEngine()): Promise<boolean> {
  stopSpeech()
  const spokenText = sanitizeTextForSpeech(text)
  if (!spokenText || !engine) return Promise.resolve(false)

  const ownRequest = requestId
  activeEngine = engine

  return new Promise(resolve => {
    let settled = false
    const finish = (spoken: boolean) => {
      if (settled) return
      settled = true
      if (ownRequest === requestId) {
        activeEngine = null
        settleActive = null
      }
      resolve(ownRequest === requestId && spoken)
    }

    settleActive = finish
    const utterance = engine.createUtterance(spokenText)
    utterance.onend = () => finish(true)
    utterance.onerror = () => finish(false)

    try {
      engine.speak(utterance)
    } catch {
      finish(false)
    }
  })
}
