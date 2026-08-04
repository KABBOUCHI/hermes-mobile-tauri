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

export interface AudioPlayer {
  play: () => Promise<void>
  pause: () => void
  load: () => void
  onended: (() => void) | null
  onerror: (() => void) | null
}

export type AudioPlayerFactory = (dataUrl: string) => AudioPlayer

function browserAudioPlayer(dataUrl: string): AudioPlayer {
  return new Audio(dataUrl) as unknown as AudioPlayer
}

let requestId = 0
let activePlayer: AudioPlayer | null = null
let settleActive: ((spoken: boolean) => void) | null = null

/** Stop the current message, if any. Starting another message also stops it. */
export function stopSpeech(): void {
  requestId += 1
  activePlayer?.pause()
  activePlayer?.load()
  activePlayer = null
  settleActive?.(false)
  settleActive = null
}

/** Start a new gateway-backed speech request and return its cancellation token. */
export function beginSpeech(): number {
  stopSpeech()
  return requestId
}

/** Play one complete assistant reply returned by the gateway as a data URL. */
export function playSpeechDataUrl(
  dataUrl: string,
  expectedRequest = requestId,
  createPlayer: AudioPlayerFactory = browserAudioPlayer,
): Promise<boolean> {
  if (expectedRequest !== requestId || !/^data:audio\//i.test(dataUrl)) return Promise.resolve(false)

  let player: AudioPlayer
  try {
    player = createPlayer(dataUrl)
  } catch {
    return Promise.resolve(false)
  }

  const ownRequest = expectedRequest
  activePlayer = player

  return new Promise(resolve => {
    let settled = false
    const finish = (spoken: boolean) => {
      if (settled) return
      settled = true
      if (ownRequest === requestId) {
        activePlayer = null
        settleActive = null
      }
      resolve(ownRequest === requestId && spoken)
    }

    settleActive = finish
    player.onended = () => finish(true)
    player.onerror = () => finish(false)

    try {
      void player.play().catch(() => finish(false))
    } catch {
      finish(false)
    }
  })
}
