<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { renderMarkdown } from '../utils/markdown'
import { highlightRenderedHtml } from '../utils/renderedSearchHighlight'
import { extractUnifiedDiff, summarizeToolActivity, thoughtActivityLabel } from '../utils/activitySummary'
import PatchDiff from '../components/PatchDiff.vue'
import { isNearChatBottom } from '../utils/chatScroll'
import { writeClipboardText } from '../utils/clipboard'
import { useAuth } from '../composables/useAuth'
import { useGateway, type ModelProvider } from '../composables/useGateway'
import { useToast } from '../composables/useToast'
import { openUrl } from '@tauri-apps/plugin-opener'

const router = useRouter()
const route = useRoute()
const auth = useAuth()
const toast = useToast()
const gw = useGateway()

const sending = ref(false)
const selectedSessionId = ref((route.params.id as string) || '')
const isNewSession = ref(!selectedSessionId.value)

// ── Model Picker ──
const modelPickerOpen = ref(false)
const headerMenuOpen = ref(false)
const modelProviders = ref<ModelProvider[]>([])
const currentModel = ref('')
const currentProvider = ref('')
const modelLoading = ref(false)
const switchingModel = ref(false)

async function loadModels() {
  modelLoading.value = true
  const opts = await gw.fetchModels(auth.gatewayUrl.value)
  modelProviders.value = opts.providers
  currentModel.value = opts.model || ''
  currentProvider.value = opts.provider || ''
  modelLoading.value = false
}

async function selectModel(provider: string, model: string) {
  if (switchingModel.value) return
  switchingModel.value = true
  try {
    const ok = await gw.setModel(auth.gatewayUrl.value, provider, model)
    if (ok) {
      currentModel.value = model
      currentProvider.value = provider
      modelPickerOpen.value = false
    }
  } finally {
    switchingModel.value = false
  }
}

const currentModelShort = computed(() => {
  if (!currentModel.value) return 'Model'
  return gw.modelShort(currentModel.value)
})

function toggleModelPicker() {
  modelPickerOpen.value = !modelPickerOpen.value
  if (modelPickerOpen.value && modelProviders.value.length === 0) {
    loadModels()
  }
}

function closeModelPicker() {
  modelPickerOpen.value = false
}

function openSearchFromMenu() {
  headerMenuOpen.value = false
  if (!searchOpen.value) toggleSearch()
}

function refreshMessages() {
  headerMenuOpen.value = false
  if (selectedSessionId.value) {
    void gw.fetchMessages(auth.gatewayUrl.value, selectedSessionId.value)
  }
}

function exportChatFromMenu() {
  headerMenuOpen.value = false
  void exportChat()
}

const selectedSessionTitle = computed(() => {
  if (!selectedSessionId.value) return 'New Chat'
  const s = gw.sessions.value.find(s => s.id === selectedSessionId.value)
  return s?.title || s?.preview || 'Session'
})

// Load messages when entering with an existing session
onMounted(async () => {
  if (selectedSessionId.value) {
    try {
      await gw.fetchMessages(auth.gatewayUrl.value, selectedSessionId.value)
    } catch (err: any) {
      toast.show(err.message || 'Failed to load messages', 'error')
    }
  }
  // Load current model for the pill
  loadModels()

  // Keyboard overlap handling for mobile
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onViewportResize)
    onViewportResize()
  }
})

onUnmounted(() => {
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', onViewportResize)
  }
})

function onViewportResize() {
  const vh = window.visualViewport?.height || window.innerHeight
  document.documentElement.style.setProperty('--app-height', `${vh}px`)
}

const input = ref('')
const scrollEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
// ── User message editing ──
const editingIdx = ref<number | null>(null)
const editText = ref('')
const editEl = ref<HTMLTextAreaElement | null>(null)
const editing = ref(false)

function startEdit(idx: number) {
  const msg = gw.messages.value[idx]
  if (!msg || msg.role !== 'user') return
  editingIdx.value = idx
  editText.value = msg.content
  nextTick(() => {
    editEl.value?.focus()
    editEl.value?.select()
  })
}

function cancelEdit() {
  editingIdx.value = null
  editText.value = ''
}

async function saveEdit() {
  const idx = editingIdx.value
  if (idx === null || !selectedSessionId.value || editing.value) return
  const text = editText.value.trim()
  if (!text) return

  editing.value = true
  try {
    await gw.editMessage(auth.gatewayUrl.value, selectedSessionId.value, idx, text)
  } catch (err: any) {
    toast.show(err.message || 'Edit failed', 'error')
  } finally {
    editing.value = false
    editingIdx.value = null
    editText.value = ''
  }
}

function handleEditKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    saveEdit()
  } else if (e.key === 'Escape') {
    cancelEdit()
  }
}

function autoResizeEdit() {
  if (!editEl.value) return
  editEl.value.style.height = 'auto'
  editEl.value.style.height = Math.min(editEl.value.scrollHeight, 120) + 'px'
}

// Watch for route changes (navigating between sessions without remount)
watch(() => route.params.id, async (newId) => {
  selectedSessionId.value = (newId as string) || ''
  isNewSession.value = !selectedSessionId.value
  // The module-level message store is reused across routes. Clear it in Vue's
  // synchronous route phase so the outgoing session cannot paint beneath the
  // next session title while its request is starting.
  gw.messages.value = []
  gw.error.value = ''
  searchQuery.value = ''
  searchOpen.value = false
  editingIdx.value = null
  editText.value = ''
  closeActionSheet()
  matchIndices.value = []
  currentMatchIdx.value = -1
  shouldFollowMessages.value = true
  if (selectedSessionId.value) {
    try {
      await gw.fetchMessages(auth.gatewayUrl.value, selectedSessionId.value)
    } catch (err: any) {
      toast.show(err.message || 'Failed to load messages', 'error')
    }
  }
}, { flush: 'sync' })

// ── Message search ──
const searchOpen = ref(false)
const searchQuery = ref('')
const searchInputEl = ref<HTMLInputElement | null>(null)
const matchIndices = ref<number[]>([])
const currentMatchIdx = ref(-1)

function toggleSearch() {
  searchOpen.value = !searchOpen.value
  if (!searchOpen.value) {
    searchQuery.value = ''
    matchIndices.value = []
    currentMatchIdx.value = -1
  } else {
    nextTick(() => searchInputEl.value?.focus())
  }
}

function computeMatches() {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) {
    matchIndices.value = []
    currentMatchIdx.value = -1
    return
  }
  const indices: number[] = []
  for (let i = 0; i < gw.messages.value.length; i++) {
    const msg = gw.messages.value[i]
    if (msg.content && msg.content.toLowerCase().includes(q)) {
      indices.push(i)
    }
  }
  matchIndices.value = indices
  currentMatchIdx.value = indices.length > 0 ? 0 : -1

  if (indices.length > 0) {
    scrollToMatch(indices[0])
  }
}

function nextMatch() {
  if (matchIndices.value.length === 0) return
  currentMatchIdx.value = (currentMatchIdx.value + 1) % matchIndices.value.length
  scrollToMatch(matchIndices.value[currentMatchIdx.value])
}

function prevMatch() {
  if (matchIndices.value.length === 0) return
  currentMatchIdx.value = (currentMatchIdx.value - 1 + matchIndices.value.length) % matchIndices.value.length
  scrollToMatch(matchIndices.value[currentMatchIdx.value])
}

function scrollToMatch(msgIndex: number) {
  nextTick(() => {
    const el = scrollEl.value
    if (!el) return
    const msgEl = el.querySelector(`[data-msg-idx="${msgIndex}"]`)
    if (msgEl) {
      msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  })
}

function highlightText(content: string, query: string): string {
  return highlightRenderedHtml(renderMarkdown(content), query)
}

function isMatch(idx: number): boolean {
  return matchIndices.value.includes(idx)
}

function currentMatchCount(): string {
  if (matchIndices.value.length === 0) return ''
  return `${currentMatchIdx.value + 1}/${matchIndices.value.length}`
}

function handleSearchKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    if (e.shiftKey) {
      prevMatch()
    } else {
      nextMatch()
    }
  } else if (e.key === 'Escape') {
    toggleSearch()
  }
}

function goBack() {
  router.push({ name: 'sessions' })
}

function handleSend() {
  const text = input.value.trim()
  if (!text || sending.value) return
  sendText(text)
}

function sendText(text: string, preserveUserMessage = false) {
  sending.value = true
  shouldFollowMessages.value = true

  // Generate session ID for new sessions
  if (!selectedSessionId.value) {
    selectedSessionId.value = crypto.randomUUID()
  }

  // A failed turn already has its user message in the thread. Preserve that
  // record when retrying so the chat does not display the same prompt twice.
  if (!preserveUserMessage) {
    gw.messages.value.push({
      role: 'user',
      content: text,
      timestamp: Date.now() / 1000,
    })
  }

  input.value = ''
  if (inputEl.value) {
    inputEl.value.style.height = 'auto'
  }

  gw.sendMessage(auth.gatewayUrl.value, selectedSessionId.value, text, isNewSession.value)
    .then((result) => {
      if (result?.newSessionId) {
        selectedSessionId.value = result.newSessionId
        isNewSession.value = false
      }
    })
    .catch((err: any) => {
      const message = err.message || 'Unknown error'
      // sendMessage adds an assistant bubble before submitting. Retain any
      // streamed partial response and make that same bubble retryable instead
      // of appending a duplicate error after it.
      const last = gw.messages.value[gw.messages.value.length - 1]
      if (last?.role === 'assistant') {
        if (!last.content) last.content = message
        last.error = true
      } else {
        gw.messages.value.push({
          role: 'assistant',
          content: message,
          timestamp: Date.now() / 1000,
          error: true,
        })
      }
    })
    .finally(() => {
      sending.value = false
    })
}

function retryFailed(failedMsgIdx: number) {
  if (sending.value) return
  // Find the user message that preceded this failed assistant message.
  for (let i = failedMsgIdx - 1; i >= 0; i--) {
    if (gw.messages.value[i].role === 'user') {
      const userText = gw.messages.value[i].content
      // Keep the original user message and replace only its failed response.
      gw.messages.value.splice(failedMsgIdx, 1)
      sendText(userText, true)
      return
    }
  }
}

// Gateway failures are local display state, just as they are on desktop. Keep
// partial streamed output when it exists, but remove an empty failure bubble so
// a resolved or dismissed error does not linger in the transcript.
function dismissFailed(failedMsgIdx: number) {
  const failed = gw.messages.value[failedMsgIdx]
  if (!failed?.error) return

  if (failed.content.trim() || failed.reasoning || failed.toolCalls?.length) {
    failed.error = false
  } else {
    gw.messages.value.splice(failedMsgIdx, 1)
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

// ── Jump to bottom button ──
const showJumpToBottom = ref(false)
const shouldFollowMessages = ref(true)

function checkScrollPosition() {
  const el = scrollEl.value
  if (!el) return
  shouldFollowMessages.value = isNearChatBottom(el)
  showJumpToBottom.value = !shouldFollowMessages.value
}

function scrollToBottom() {
  const el = scrollEl.value
  if (!el) return
  shouldFollowMessages.value = true
  showJumpToBottom.value = false
  el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
}

// Update jump-to-bottom visibility on scroll
function onScroll() {
  checkScrollPosition()
}

// ── Pull-to-refresh in chat ──
const pullStart = ref(0)
const pullDelta = ref(0)

function onChatTouchStart(e: TouchEvent) {
  if (scrollEl.value && scrollEl.value.scrollTop === 0) {
    pullStart.value = e.touches[0].clientY
  }
}

function onChatTouchMove(e: TouchEvent) {
  if (pullStart.value === 0) return
  const delta = e.touches[0].clientY - pullStart.value
  if (delta > 0 && scrollEl.value && scrollEl.value.scrollTop === 0) {
    pullDelta.value = Math.min(delta * 0.5, 80)
  }
}

async function onChatTouchEnd() {
  if (pullDelta.value > 50 && selectedSessionId.value) {
    await gw.fetchMessages(auth.gatewayUrl.value, selectedSessionId.value)
  }
  pullStart.value = 0
  pullDelta.value = 0
}

function autoResize() {
  if (!inputEl.value) return
  inputEl.value.style.height = 'auto'
  inputEl.value.style.height = Math.min(inputEl.value.scrollHeight, 120) + 'px'
}

function render(content: string): string {
  return renderMarkdown(content)
}

// Desktop opens rendered images in a dedicated zoomable viewer. Keep the mobile
// equivalent local to the message surface so the markdown renderer stays pure.
const imagePreview = ref<{ src: string; alt: string } | null>(null)

function openImagePreview(image: HTMLImageElement) {
  const src = image.currentSrc || image.src
  if (!src) return
  imagePreview.value = { src, alt: image.alt || 'Image preview' }
}

function openAttachmentPreview(src: string, label: string) {
  if (!src) return
  imagePreview.value = { src, alt: label }
}

const resolvedGatewayImages = ref<Record<string, string>>({})
const resolvingGatewayImages = new Set<string>()

function imageAttachmentKey(
  message: { id?: string; timestamp: number },
  attachment: { src?: string; gatewayPath?: string },
  index: number,
): string {
  return `${selectedSessionId.value}:${message.id || message.timestamp}:${attachment.gatewayPath || attachment.src || index}`
}

function imageAttachmentSrc(
  message: { id?: string; timestamp: number },
  attachment: { src?: string; gatewayPath?: string },
  index: number,
): string {
  return attachment.src || resolvedGatewayImages.value[imageAttachmentKey(message, attachment, index)] || ''
}

async function resolveGatewayImageAttachments() {
  const requests = gw.messages.value.flatMap(message => {
    if (message.role !== 'user') return []
    return (message.imageAttachments || []).flatMap((attachment, attachmentIndex) => {
      if (!attachment.gatewayPath) return []
      const key = imageAttachmentKey(message, attachment, attachmentIndex)
      if (resolvedGatewayImages.value[key] || resolvingGatewayImages.has(key)) return []
      return [{ key, path: attachment.gatewayPath }]
    })
  })

  await Promise.all(requests.map(async request => {
    resolvingGatewayImages.add(request.key)
    try {
      const src = await gw.fetchMediaDataUrl(auth.gatewayUrl.value, request.path)
      if (src) resolvedGatewayImages.value = { ...resolvedGatewayImages.value, [request.key]: src }
    } finally {
      resolvingGatewayImages.delete(request.key)
    }
  }))
}

const imageAttachmentSignature = computed(() => gw.messages.value
  .flatMap(message => (message.imageAttachments || []).map(attachment => `${message.id || message.timestamp}:${attachment.gatewayPath || attachment.src || ''}`))
  .join('|'))

watch(imageAttachmentSignature, () => {
  void resolveGatewayImageAttachments()
}, { immediate: true })

function closeImagePreview() {
  imagePreview.value = null
}

function handleMessagesClick(e: Event) {
  const clickedImage = (e.target as HTMLElement).closest('img.md-img') as HTMLImageElement | null
  if (clickedImage) {
    e.preventDefault()
    e.stopPropagation()
    openImagePreview(clickedImage)
    return
  }

  const clickedLink = (e.target as HTMLElement).closest('a.md-link') as HTMLAnchorElement | null
  if (clickedLink) {
    e.preventDefault()
    e.stopPropagation()
    try {
      const url = new URL(clickedLink.href)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Unsupported link')
      openUrl(url.href).catch(() => toast.show('Unable to open link', 'error'))
    } catch {
      toast.show('Invalid link', 'error')
    }
    return
  }

  const target = (e.target as HTMLElement).closest('.md-code-copy') as HTMLElement | null
  if (!target) return
  const codeBlock = target.closest('.md-code-wrap')
  const code = codeBlock?.querySelector('code')?.textContent || codeBlock?.querySelector('.md-code')?.textContent || ''
  if (code) {
    void writeClipboardText(code).then(copied => {
      target.textContent = copied ? '✓ Copied' : 'Copy failed'
      setTimeout(() => { target.textContent = 'Copy' }, 1500)
    })
  }
}

// ── Message Action Sheet ──
const actionSheetOpen = ref(false)
const actionSheetMsgIdx = ref<number>(-1)
const actionSheetMsg = computed(() => {
  if (actionSheetMsgIdx.value < 0) return null
  return gw.messages.value[actionSheetMsgIdx.value] || null
})
const actionSheetIsLastAssistant = computed(() => {
  const msgs = gw.messages.value
  const idx = actionSheetMsgIdx.value
  return idx >= 0 && msgs[idx]?.role === 'assistant' && idx === msgs.length - 1
})

const hasShareApi = typeof navigator !== 'undefined' && !!navigator.share

let longPressTimer: ReturnType<typeof setTimeout> | null = null

function handleMessageLongPress(e: TouchEvent, idx: number) {
  const touch = e.touches[0]
  longPressTimer = setTimeout(() => {
    openActionSheet(idx)
  }, 500)
  // Store start position to detect movement
  const startY = touch.clientY
  const onMove = (ev: TouchEvent) => {
    if (Math.abs(ev.touches[0].clientY - startY) > 10) {
      clearTimeout(longPressTimer!)
      longPressTimer = null
    }
  }
  const onEnd = () => {
    clearTimeout(longPressTimer!)
    longPressTimer = null
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onEnd)
  }
  document.addEventListener('touchmove', onMove)
  document.addEventListener('touchend', onEnd)
}

function handleMessageTouchEnd() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

function openActionSheet(idx: number) {
  actionSheetMsgIdx.value = idx
  actionSheetOpen.value = true
}

function closeActionSheet() {
  actionSheetOpen.value = false
  actionSheetMsgIdx.value = -1
}

async function actionCopyText() {
  const msg = actionSheetMsg.value
  if (msg?.content) {
    const copied = await writeClipboardText(msg.content)
    toast.show(copied ? 'Copied to clipboard' : 'Unable to access clipboard', copied ? 'success' : 'error')
  }
  closeActionSheet()
}

function actionEdit() {
  const idx = actionSheetMsgIdx.value
  closeActionSheet()
  startEdit(idx)
}

function actionRetry() {
  const idx = actionSheetMsgIdx.value
  closeActionSheet()
  retryFailed(idx)
}

function actionDismissError() {
  const idx = actionSheetMsgIdx.value
  closeActionSheet()
  dismissFailed(idx)
}

async function actionRegenerate() {
  closeActionSheet()
  await handleRegenerate()
}

async function actionShare() {
  const msg = actionSheetMsg.value
  if (msg?.content && navigator.share) {
    try {
      await navigator.share({ text: msg.content })
    } catch { /* cancelled */ }
  }
  closeActionSheet()
}

async function actionRestore() {
  const idx = actionSheetMsgIdx.value
  const msg = actionSheetMsg.value
  closeActionSheet()

  if (sending.value || !selectedSessionId.value || !msg || msg.role !== 'user') return
  if (!window.confirm('Restore from this message? Messages after it will be replaced.')) return

  const originalMessages = [...gw.messages.value]
  sending.value = true
  shouldFollowMessages.value = true
  try {
    await gw.restoreMessage(auth.gatewayUrl.value, selectedSessionId.value, idx)
  } catch (err: any) {
    // A failed truncating submit must not leave the local timeline pretending
    // the restore succeeded; desktop restores the prior authoritative view too.
    gw.messages.value = originalMessages
    toast.show(err.message || 'Restore failed', 'error')
  } finally {
    sending.value = false
  }
}

function isThinking(content: string): boolean {
  return content.includes('<think>') && !content.includes('</think>')
}

function messageKey(message: { id?: string; role: string; timestamp: number }, idx: number): string {
  return `${selectedSessionId.value || 'new'}:${message.id || `${message.role}-${message.timestamp}-${idx}`}`
}

function toolResults(message: {
  toolResults?: { id: string; name: string; content: string; timestamp: number; diff?: string }[]
  id?: string
  toolName?: string
  content: string
  timestamp: number
}) {
  return message.toolResults || [{
    id: message.id || 'tool',
    name: message.toolName || 'Tool',
    content: message.content,
    timestamp: message.timestamp,
  }]
}

function toolSummaryLabel(message: Parameters<typeof toolResults>[0]): string {
  const results = toolResults(message)
  return summarizeToolActivity(results)
}

function isActivityMessage(message: { role: string; content: string; reasoning?: string; toolCalls?: unknown[] }): boolean {
  return message.role === 'tool' || (message.role === 'assistant' && !message.content && Boolean(message.reasoning || message.toolCalls?.length))
}

function thoughtLabel(message: { timestamp: number }, idx: number): string {
  const next = gw.messages.value.slice(idx + 1).find(item => item.timestamp > message.timestamp)
  return thoughtActivityLabel(next ? next.timestamp - message.timestamp : 0)
}

function activityThoughtLabel(seconds: number): string {
  return thoughtActivityLabel(seconds)
}

function toolDiff(content: string, diff?: string): string | null {
  return diff || extractUnifiedDiff(content)
}

const hasMessages = computed(() => gw.messages.value.length > 0)

// Keep the currently streaming tail fully laid out, while allowing Chromium to
// skip paint and layout work for settled history. This follows desktop's thread
// list strategy: virtualising a turn still receiving deltas can preserve an old
// intrinsic height and make the scroll position drift.
const LIVE_TAIL_MESSAGES = 12
function shouldVirtualizeMessage(idx: number): boolean {
  return idx < gw.messages.value.length - LIVE_TAIL_MESSAGES
}

// ── Date separators ──
function getDateLabel(ts: number): string {
  if (!ts) return ''
  const date = new Date(ts * 1000)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday)
  startOfYesterday.setDate(startOfYesterday.getDate() - 1)

  if (date >= startOfToday) return 'Today'
  if (date >= startOfYesterday) return 'Yesterday'

  const diff = Math.floor((startOfToday.getTime() - date.getTime()) / 86400000)
  if (diff < 7) {
    return date.toLocaleDateString(undefined, { weekday: 'long' })
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function showDateSeparator(idx: number): boolean {
  const msgs = gw.messages.value
  if (idx === 0) return !!msgs[0]?.timestamp
  const prev = msgs[idx - 1]
  const curr = msgs[idx]
  if (!prev?.timestamp || !curr?.timestamp) return false
  const prevDate = new Date(prev.timestamp * 1000)
  const currDate = new Date(curr.timestamp * 1000)
  return prevDate.toDateString() !== currDate.toDateString()
}

// ── Live elapsed timer during streaming ──
const elapsedDisplay = ref('')
let elapsedTimer: ReturnType<typeof setInterval> | null = null

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function startElapsedTimer() {
  if (elapsedTimer) return
  elapsedTimer = setInterval(() => {
    if (gw.turnStartedAt.value) {
      elapsedDisplay.value = formatElapsed(Date.now() - gw.turnStartedAt.value)
    }
  }, 1000)
  if (gw.turnStartedAt.value) {
    elapsedDisplay.value = formatElapsed(Date.now() - gw.turnStartedAt.value)
  }
}

function stopElapsedTimer() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer)
    elapsedTimer = null
  }
  elapsedDisplay.value = ''
}

watch(() => gw.turnStartedAt.value, (val) => {
  if (val) {
    startElapsedTimer()
  } else {
    stopElapsedTimer()
  }
}, { immediate: true })

// Keep following only while the reader is already at the newest messages.
// This mirrors the desktop thread: a new streamed turn must not pull someone
// reading older context back to the composer.
watch(() => gw.messages.value.length, async () => {
  await nextTick()
  const el = scrollEl.value
  if (el && shouldFollowMessages.value) {
    el.scrollTop = el.scrollHeight
  }
})

// Streaming updates grow the final bubble without stealing the reader's place.
watch(() => {
  const msgs = gw.messages.value
  if (msgs.length === 0) return ''
  return msgs[msgs.length - 1].content
}, async () => {
  await nextTick()
  const el = scrollEl.value
  if (el && shouldFollowMessages.value) {
    el.scrollTop = el.scrollHeight
  }
})

// ── Export Chat ─────────────────────────────────────
// Keep the portable export aligned with desktop: structured data remains useful
// after it leaves the app, unlike a rendered transcript that loses message roles
// and timestamps.
function sanitizeFilenamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

async function exportChat() {
  const msgs = gw.messages.value
  if (!msgs.length) {
    toast.show('No messages to export', 'info')
    return
  }

  const title = selectedSessionTitle.value || 'Hermes Chat'
  const session = gw.sessions.value.find(item => item.id === selectedSessionId.value) || null
  const fileName = `${sanitizeFilenamePart(title) || 'session'}-${sanitizeFilenamePart(selectedSessionId.value).slice(0, 8) || 'chat'}.json`
  const serialized = JSON.stringify({
    exported_at: new Date().toISOString(),
    session_id: selectedSessionId.value || null,
    title,
    session,
    message_count: msgs.length,
    messages: msgs,
  }, null, 2)

  try {
    const file = new File([serialized], fileName, { type: 'application/json' })
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title, files: [file] })
      return
    }

    // Some Android WebViews cannot share files but can still send text to a
    // target app. Preserve the complete JSON instead of silently degrading it.
    if (navigator.share) {
      await navigator.share({ title, text: serialized })
      return
    }

    if (navigator.clipboard) {
      await navigator.clipboard.writeText(serialized)
      toast.show('Chat JSON copied to clipboard', 'success')
      return
    }

    toast.show('Export not available on this device', 'error')
  } catch (err: any) {
    if (err?.name === 'AbortError') return
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(serialized)
        toast.show('Chat JSON copied to clipboard', 'success')
      } else {
        toast.show(err?.message || 'Export failed', 'error')
      }
    } catch {
      toast.show('Export failed', 'error')
    }
  }
}

// ── Regenerate ───────────────────────────────────────
async function handleRegenerate() {
  if (sending.value) return
  if (!selectedSessionId.value) return

  sending.value = true
  try {
    await gw.regenerateLastMessage(auth.gatewayUrl.value, selectedSessionId.value)
  } catch (err: any) {
    toast.show(err.message || 'Regenerate failed', 'error')
  } finally {
    sending.value = false
  }
}

// ── Stop / Interrupt ─────────────────────────────────
async function handleStop() {
  const runtimeId = gw.activeRuntimeId.value
  if (!runtimeId) {
    sending.value = false
    return
  }
  try {
    await gw.interruptSession(runtimeId)
  } catch {
    // Best-effort
  }
  sending.value = false
}

function formatTime(ts: number): string {
  return gw.formatTime(ts)
}
</script>

<template>
  <div class="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-app-bg font-sans text-app-text">
    <!-- Header -->
    <div class="flex min-h-14 shrink-0 items-center gap-2 border-b border-app-border bg-app-surface px-4 py-3">
      <button class="cursor-pointer border-0 bg-transparent px-1 text-[22px] leading-none text-app-accent" @click="goBack">‹</button>
      <div class="flex-1 truncate text-[15px] font-semibold tracking-[-0.02em]">{{ selectedSessionTitle }}</div>
      <button class="flex max-w-[120px] shrink-0 cursor-pointer items-center gap-1 rounded-md border border-app-border bg-app-surface-2 px-2 py-1 text-xs font-medium text-app-muted transition-all hover:border-app-accent hover:bg-app-accent/10 hover:text-app-accent" @click="toggleModelPicker" :class="{ active: modelPickerOpen }">
        <span class="truncate">{{ currentModelShort }}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div class="relative shrink-0">
        <button
          class="flex cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-1.5 text-app-muted transition-colors hover:bg-app-surface-2 hover:text-app-text"
          :class="{ active: headerMenuOpen }"
          aria-label="Chat actions"
          @click="headerMenuOpen = !headerMenuOpen"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
        </button>
        <div v-if="headerMenuOpen" class="absolute top-[calc(100%+6px)] right-0 z-30 min-w-[148px] rounded-lg border border-app-border bg-app-surface-2 p-1 shadow-[0_10px_24px_rgba(0,0,0,0.32)]">
          <button class="block w-full cursor-pointer rounded-md border-0 bg-transparent px-3 py-2 text-left text-[13px] text-app-text transition-colors hover:bg-app-surface-3 disabled:cursor-default disabled:opacity-40" @click="openSearchFromMenu">Search messages</button>
          <button class="block w-full cursor-pointer rounded-md border-0 bg-transparent px-3 py-2 text-left text-[13px] text-app-text transition-colors hover:bg-app-surface-3 disabled:cursor-default disabled:opacity-40" :disabled="!selectedSessionId || gw.loadingMessages.value" @click="refreshMessages">Refresh</button>
          <button class="block w-full cursor-pointer rounded-md border-0 bg-transparent px-3 py-2 text-left text-[13px] text-app-text transition-colors hover:bg-app-surface-3 disabled:cursor-default disabled:opacity-40" :disabled="!hasMessages" @click="exportChatFromMenu">Export chat</button>
        </div>
      </div>
    </div>

    <!-- Search bar -->
    <div v-if="searchOpen" class="flex shrink-0 items-center gap-1.5 border-b border-app-border bg-app-surface px-3 py-2">
      <svg class="shrink-0 text-app-muted" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        ref="searchInputEl"
        v-model="searchQuery"
        type="text"
        class="h-8 flex-1 rounded-md border border-app-border bg-app-surface-2 px-2.5 text-[13px] outline-none transition-colors placeholder:text-app-muted focus:border-app-accent"
        placeholder="Search in messages…"
        @input="computeMatches"
        @keydown="handleSearchKeydown"
      />
      <span v-if="matchIndices.length > 0" class="min-w-8 shrink-0 text-center text-xs text-app-muted">{{ currentMatchCount() }}</span>
      <span v-else-if="searchQuery && matchIndices.length === 0" class="min-w-8 shrink-0 text-center text-xs text-app-muted text-app-error">0</span>
      <button class="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-app-border bg-transparent text-base text-app-muted transition-all hover:border-app-muted hover:text-app-text disabled:cursor-default disabled:opacity-30" @click="prevMatch" :disabled="matchIndices.length === 0">‹</button>
      <button class="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-app-border bg-transparent text-base text-app-muted transition-all hover:border-app-muted hover:text-app-text disabled:cursor-default disabled:opacity-30" @click="nextMatch" :disabled="matchIndices.length === 0">›</button>
      <button class="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-xs text-app-muted transition-colors hover:text-app-error" @click="toggleSearch">✕</button>
    </div>

    <!-- Messages -->
    <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4" ref="scrollEl" @scroll="onScroll" @click="handleMessagesClick" @touchstart="onChatTouchStart" @touchmove="onChatTouchMove" @touchend="onChatTouchEnd">
      <!-- Pull-to-refresh indicator -->
      <div
        v-if="pullDelta > 0"
        class="flex items-center justify-center overflow-hidden transition-[height] duration-100"
        :style="{ height: pullDelta + 'px', opacity: pullDelta / 80 }"
      >
        <div class="size-5 rounded-full border-2 border-app-border border-t-app-accent" :class="{ active: gw.loadingMessages.value }" />
      </div>

      <!-- Loading state (messages fetch in progress) -->
      <div v-if="!hasMessages && gw.loadingMessages.value && !gw.error.value" class="flex flex-1 flex-col items-center justify-center gap-3">
        <div class="size-6 animate-spin rounded-full border-2 border-app-border border-t-app-accent" />
        <span class="text-[13px] text-app-muted">Loading messages…</span>
      </div>

      <div v-else-if="!hasMessages && !gw.error.value" class="flex flex-1 flex-col items-center justify-center gap-2 opacity-40">
        <div class="text-[32px]">💬</div>
        <div class="text-sm">Start a conversation</div>
      </div>

      <div v-if="gw.error.value && !hasMessages" class="rounded-lg border border-app-error/30 bg-app-error/10 px-3.5 py-2.5 text-center text-[13px] text-app-error">{{ gw.error.value }}</div>

      <template
        v-for="(msg, idx) in gw.messages.value"
        :key="messageKey(msg, idx)"
      >
      <!-- Date separator -->
      <div v-if="showDateSeparator(idx)" class="flex items-center gap-2.5 pt-3 pb-1">
        <span class="h-px flex-1 bg-app-border" />
        <span class="shrink-0 whitespace-nowrap text-[11px] font-medium tracking-[0.02em] text-app-muted">{{ getDateLabel(msg.timestamp) }}</span>
        <span class="h-px flex-1 bg-app-border" />
      </div>

      <div
        :data-msg-idx="idx"
        class="flex flex-col gap-1"
        :class="[
          msg.role === 'user' ? 'items-end' : 'items-start',
          {
            'search-match': isMatch(idx),
            'search-current': matchIndices[currentMatchIdx] === idx,
            '[content-visibility:auto] [contain-intrinsic-size:auto_260px]': shouldVirtualizeMessage(idx),
            'gap-0 px-0.5': isActivityMessage(msg),
          },
        ]"
      >
        <div
          class="max-w-[88%] break-words rounded-[14px] px-4 py-3 text-sm leading-[1.55]"
          :class="[
            msg.role === 'user'
              ? 'self-end rounded-br-[4px] bg-app-accent text-white'
              : msg.role === 'tool'
                ? 'w-full max-w-full self-stretch bg-transparent p-0'
                : 'self-start rounded-bl-[4px] border border-app-border bg-app-surface text-app-text',
            { 'border-app-error/40 bg-app-error/10 text-app-error': msg.error, editing: editingIdx === idx },
          ]"
          @touchstart="handleMessageLongPress($event, idx)"
          @touchend="handleMessageTouchEnd"
          @touchmove="handleMessageTouchEnd"
        >
          <!-- Edit mode for user messages -->
          <div v-if="editingIdx === idx" class="flex flex-col gap-2">
            <textarea
              ref="editEl"
              v-model="editText"
              class="min-h-9 max-h-[120px] w-full resize-none rounded-lg border border-app-border bg-app-bg px-2.5 py-2 text-sm leading-[1.4] outline-none transition-colors placeholder:text-app-muted focus:border-app-accent"
              rows="1"
              @keydown="handleEditKeydown"
              @input="autoResizeEdit"
            ></textarea>
            <div class="flex justify-end gap-2">
              <button class="flex cursor-pointer items-center gap-1 rounded-md border border-app-border bg-transparent px-3 py-1 text-xs font-medium transition-all disabled:cursor-default disabled:opacity-50 text-app-muted hover:border-app-muted hover:text-app-text" @click="cancelEdit" :disabled="editing">Cancel</button>
              <button class="flex cursor-pointer items-center gap-1 rounded-md border border-app-border bg-transparent px-3 py-1 text-xs font-medium transition-all disabled:cursor-default disabled:opacity-50 border-app-accent bg-app-accent text-white hover:not-disabled:bg-app-accent-hover" @click="saveEdit" :disabled="editing || !editText.trim()">
                <span v-if="editing" class="inline-block size-3.5 animate-spin rounded-full border-2 border-app-border border-t-app-accent"></span>
                <span v-else>Send</span>
              </button>
            </div>
          </div>

          <!-- Normal content (not editing) -->
          <template v-else>
            <!-- Consecutive tool results are grouped by the normaliser so one
                 tool-heavy agent turn occupies one compact timeline row. -->
            <details v-if="msg.role === 'tool'" class="my-1 w-full overflow-hidden rounded-lg border border-app-border bg-[color-mix(in_srgb,var(--surface)_88%,var(--accent))] [&>summary]:flex [&>summary]:cursor-pointer [&>summary]:items-center [&>summary]:gap-1.5 [&>summary]:bg-app-surface-2 [&>summary]:px-3 [&>summary]:py-2.5 [&>summary]:text-xs [&>summary]:font-medium [&>summary]:text-app-muted">
              <summary>
                <span class="text-[11px] text-app-success">✓</span>
                <span>{{ toolSummaryLabel(msg) }}</span>
                <span class="ml-auto text-[11px] text-app-muted opacity-70">completed</span>
              </summary>
              <div v-if="msg.activityThoughts?.length" class="">
                <details v-for="thought in msg.activityThoughts" :key="thought.id" class="border-t border-app-border [&>summary]:cursor-pointer [&>summary]:bg-app-surface/60 [&>summary]:px-2.5 [&>summary]:py-1.5 [&>summary]:text-xs [&>summary]:text-app-muted">
                  <summary>{{ activityThoughtLabel(thought.durationSeconds) }}</summary>
                  <div class="px-2.5 pb-2.5 text-xs leading-[1.5] whitespace-pre-wrap text-app-muted">{{ thought.content }}</div>
                </details>
              </div>
              <template v-if="toolResults(msg).length === 1">
                <div v-if="toolDiff(toolResults(msg)[0].content, toolResults(msg)[0].diff)" class="" aria-label="Diff view">
                  <div class="px-2.5 pt-1.5 pb-[3px] text-[11px] font-semibold uppercase tracking-[.04em] text-app-muted">Diff</div>
                  <PatchDiff :patch="toolDiff(toolResults(msg)[0].content, toolResults(msg)[0].diff)!" />
                </div>
                <pre v-else-if="toolResults(msg)[0].content" class="m-0 max-h-40 overflow-auto border-t border-app-border bg-app-bg p-2.5 font-mono text-[11px] leading-[1.5] whitespace-pre-wrap break-words text-[#b9bbc8]">{{ toolResults(msg)[0].content }}</pre>
              </template>
              <div v-else class="border-t border-app-border">
                <details v-for="tool in toolResults(msg)" :key="tool.id" class="border-b border-app-border last:border-b-0 [&>summary]:cursor-pointer [&>summary]:bg-app-surface/60 [&>summary]:px-2.5 [&>summary]:py-1.5 [&>summary]:text-xs [&>summary]:text-app-muted">
                  <summary>{{ tool.name }}</summary>
                  <div v-if="toolDiff(tool.content, tool.diff)" class="" aria-label="Diff view">
                    <div class="px-2.5 pt-1.5 pb-[3px] text-[11px] font-semibold uppercase tracking-[.04em] text-app-muted">Diff</div>
                    <PatchDiff :patch="toolDiff(tool.content, tool.diff)!" />
                  </div>
                  <pre v-else-if="tool.content" class="m-0 max-h-40 overflow-auto border-t border-app-border bg-app-bg p-2.5 font-mono text-[11px] leading-[1.5] whitespace-pre-wrap break-words text-[#b9bbc8]">{{ tool.content }}</pre>
                </details>
              </div>
            </details>

            <template v-else>
              <!-- The gateway sends reasoning in dedicated fields, not only <think> tags. -->
              <details v-if="msg.reasoning" class="mb-3 w-full overflow-hidden rounded-lg border border-app-border bg-[color-mix(in_srgb,var(--surface)_88%,var(--accent))] [&>summary]:cursor-pointer [&>summary]:bg-app-surface-2 [&>summary]:px-3 [&>summary]:py-2.5 [&>summary]:text-xs [&>summary]:font-medium [&>summary]:text-app-muted">
                <summary>{{ thoughtLabel(msg, idx) }}</summary>
                <div class="px-2.5 pb-2.5 text-xs leading-[1.5] whitespace-pre-wrap text-app-muted">{{ msg.reasoning }}</div>
              </details>

              <div v-if="msg.role === 'assistant' && msg.toolCalls?.length && !msg.content && !msg.reasoning" class="mb-1.5 text-xs text-app-muted">
                {{ msg.toolCalls.length }} {{ msg.toolCalls.length === 1 ? 'tool used' : 'tools used' }}
              </div>

              <!-- Error state -->
              <div v-if="msg.error" class="flex items-center gap-2 text-app-error">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span class="text-[13px] leading-[1.4]">{{ msg.content || 'Failed to send' }}</span>
                <button class="ml-auto cursor-pointer rounded-[5px] border border-app-error/25 bg-transparent px-2 py-1 text-xs font-semibold text-app-error hover:not-disabled:border-app-error/40 hover:not-disabled:bg-app-error/15 hover:not-disabled:text-white disabled:cursor-default disabled:opacity-50" :disabled="sending" @click.stop="retryFailed(idx)">Retry</button>
                <button class="cursor-pointer border-0 bg-transparent px-0 py-1 text-xs text-app-muted hover:text-app-text" @click.stop="dismissFailed(idx)" aria-label="Dismiss error">Dismiss</button>
              </div>

              <!-- Streaming thinking indicator -->
              <div v-else-if="msg.role === 'assistant' && isThinking(msg.content)" class="flex items-center gap-1 py-0.5">
                <span class="size-[5px] rounded-full bg-app-accent"></span>
                <span class="size-[5px] rounded-full bg-app-accent"></span>
                <span class="size-[5px] rounded-full bg-app-accent"></span>
                <span class="ml-1 text-xs text-app-muted">Thinking…</span>
              </div>

              <!-- Desktop-local image paths cannot be fetched by a phone. Show
                   portable image parts as thumbnails and local-only ones as a
                   concise attachment indicator rather than raw path text. -->
              <div v-if="msg.role === 'user' && msg.imageAttachments?.length" class="mb-2 flex flex-wrap gap-1.5">
                <template v-for="(attachment, attachmentIdx) in msg.imageAttachments" :key="`${attachment.label}-${attachmentIdx}`">
                  <button
                    v-if="imageAttachmentSrc(msg, attachment, attachmentIdx)"
                    type="button"
                    class="size-[76px] cursor-zoom-in overflow-hidden rounded-lg border border-app-border bg-app-surface-2 p-0"
                    :aria-label="`Preview ${attachment.label}`"
                    @click.stop="openAttachmentPreview(imageAttachmentSrc(msg, attachment, attachmentIdx), attachment.label)"
                  >
                    <img class="size-full object-cover" :src="imageAttachmentSrc(msg, attachment, attachmentIdx)" :alt="attachment.label" />
                  </button>
                  <span v-else class="inline-flex min-h-7 items-center rounded-[7px] border border-app-border px-2.5 text-xs text-app-muted">▧ {{ attachment.label }}</span>
                </template>
              </div>

              <!-- Rendered markdown content -->
              <div
                v-if="msg.content"
                class="md-content"
                v-html="searchQuery.trim() && isMatch(idx) ? highlightText(msg.content, searchQuery) : render(msg.content)"
              ></div>

              <!-- Empty assistant placeholder (streaming start) -->
              <div v-if="msg.role === 'assistant' && !msg.content && !msg.reasoning && !msg.toolCalls?.length" class="flex items-center gap-1 py-1">
                <span></span><span></span><span></span>
              </div>
            </template>
          </template>
        </div>

        <div v-if="!isActivityMessage(msg)" class="flex items-center gap-2 px-1" :class="msg.role === 'user' ? 'self-end' : 'self-start'">
          <span v-if="msg.timestamp" class="text-[11px] text-app-muted">{{ formatTime(msg.timestamp) }}</span>
          <button
            class="flex cursor-pointer items-center justify-center rounded border-0 bg-transparent px-1 py-0.5 text-app-muted opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100"
            @click.stop="openActionSheet(idx)"
            title="Actions"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" />
            </svg>
          </button>
        </div>
      </div>
      </template>
      <!-- Typing indicator -->
      <div v-if="sending && (gw.messages.value.length === 0 || gw.messages.value[gw.messages.value.length - 1].role !== 'assistant' || gw.messages.value[gw.messages.value.length - 1].content)" class="flex flex-col items-start gap-1">
        <div class="flex max-w-[88%] items-center gap-1 rounded-[14px] rounded-bl-[4px] border border-app-border bg-app-surface px-4 py-2 text-sm leading-[1.55]">
          <span></span><span></span><span></span>
        </div>
      </div>
    </div>

    <!-- Jump to bottom button -->
    <Transition name="jump-fade">
      <button v-if="showJumpToBottom" class="absolute right-4 bottom-[72px] z-10 flex size-9 cursor-pointer items-center justify-center rounded-full border border-app-border bg-app-surface text-app-muted shadow-[0_2px_8px_rgba(0,0,0,0.3)] transition-all hover:border-app-accent hover:bg-app-surface-2 hover:text-app-accent active:scale-90" @click="scrollToBottom">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    </Transition>

    <!-- Input -->
    <div class="relative flex shrink-0 items-end gap-2 border-t border-app-border bg-app-surface px-3 pt-2 pb-[max(8px,env(safe-area-inset-bottom))]">
      <div v-if="sending && elapsedDisplay" class="absolute left-3.5 bottom-full mb-1.5 flex items-center gap-1.5 rounded-md border border-app-border bg-app-surface-2 px-2.5 py-1">
        <span class="size-1.5 rounded-full bg-app-accent"></span>
        <span class="text-xs tabular-nums text-app-muted">{{ elapsedDisplay }}</span>
      </div>
      <div v-if="sending" class="flex flex-1 items-center justify-center">
        <button class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-app-error/30 bg-app-error/[.08] px-5 py-2.5 text-[13px] font-medium text-app-error transition-all hover:border-app-error/50 hover:bg-app-error/15 active:scale-[.98]" @click="handleStop">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
          <span>Stop generating</span>
        </button>
      </div>
      <template v-else>
        <textarea
          ref="inputEl"
          v-model="input"
          placeholder="Message…"
          rows="1"
          @keydown="handleKeydown"
          @input="autoResize"
        ></textarea>
        <button
          class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-[10px] border-0 bg-app-accent text-white transition-colors hover:not-disabled:bg-app-accent-hover disabled:cursor-default disabled:opacity-40"
          :disabled="!input.trim()"
          @click="handleSend"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
          </svg>
        </button>
      </template>
    </div>

    <!-- Model Picker Dropdown -->
    <Teleport to="body">
      <div v-if="modelPickerOpen" class="fixed inset-0 z-[1000] flex items-end justify-center bg-black/50" @click="closeModelPicker">
        <div class="flex max-h-[70vh] w-full max-w-[400px] flex-col overflow-hidden rounded-t-2xl border border-b-0 border-app-border bg-app-surface animate-[slideUp_.2s_ease]" @click.stop>
          <div class="flex items-center justify-between border-b border-app-border px-4 py-3.5">
            <span class="text-[15px] font-semibold tracking-[-0.02em]">Switch model</span>
            <button class="cursor-pointer rounded-md border-0 bg-transparent px-2 py-1 text-sm text-app-muted transition-colors hover:text-app-error" @click="closeModelPicker">✕</button>
          </div>
          <div v-if="modelLoading" class="flex items-center justify-center gap-2 px-4 py-8 text-[13px] text-app-muted">
            <span class="inline-block size-3.5 animate-spin rounded-full border-2 border-app-border border-t-app-accent" />
            <span>Loading models…</span>
          </div>
          <div v-else-if="modelProviders.length === 0" class="flex items-center justify-center gap-2 px-4 py-8 text-[13px] text-app-muted">
            No models available
          </div>
          <div v-else class="overflow-y-auto overscroll-contain py-2">
            <template v-for="provider in modelProviders" :key="provider.slug">
              <div class="px-2">
                <div class="px-2 py-1.5 pb-1 text-[11px] font-semibold uppercase tracking-[.05em] text-app-muted">{{ provider.name }}</div>
                <button
                  v-for="model in provider.models"
                  :key="model"
                  class="flex w-full cursor-pointer items-center justify-between rounded-lg border-0 bg-transparent px-3 py-2.5 text-left text-[13px] text-app-text transition-colors hover:not-[.disabled]:bg-app-surface-2"
                  :class="{
                    active: model === currentModel && provider.slug === currentProvider,
                    disabled: switchingModel,
                  }"
                  :disabled="switchingModel"
                  @click="selectModel(provider.slug, model)"
                >
                  <span class="flex-1 truncate">{{ gw.modelShort(model) }}</span>
                  <span v-if="model === currentModel && provider.slug === currentProvider" class="ml-2 font-semibold text-app-accent">✓</span>
                </button>
              </div>
            </template>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Image preview -->
    <Teleport to="body">
      <Transition name="image-preview-fade">
        <div v-if="imagePreview" class="fixed inset-0 z-[2100] grid place-items-center bg-black/[.82] p-6 pt-[max(24px,env(safe-area-inset-top,0px))] pb-[max(24px,env(safe-area-inset-bottom,0px))]" @click="closeImagePreview">
          <button class="absolute top-[max(12px,env(safe-area-inset-top,0px))] right-3 flex size-9 cursor-pointer items-center justify-center rounded-full border border-app-border bg-app-surface text-lg leading-none text-app-text" aria-label="Close image preview" @click="closeImagePreview">✕</button>
          <img
            class="block max-h-full max-w-full cursor-zoom-out rounded-lg object-contain"
            :src="imagePreview.src"
            :alt="imagePreview.alt"
            @click.stop
          />
        </div>
      </Transition>
    </Teleport>

    <!-- Message Action Sheet -->
    <Teleport to="body">
      <Transition name="sheet-fade">
        <div v-if="actionSheetOpen" class="fixed inset-0 z-[2000] flex items-end justify-center bg-black/55" @click="closeActionSheet">
          <div class="flex w-full max-w-[400px] flex-col rounded-t-2xl bg-app-surface px-3 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] animate-[sheetSlideUp_.22s_ease]" @click.stop>
            <div class="mx-auto mt-1 mb-2.5 h-1 w-9 shrink-0 rounded-sm bg-app-border" />
            <div class="mb-1 flex min-w-0 flex-col gap-1 border-b border-app-border px-3 py-2 pb-3" v-if="actionSheetMsg">
              <span class="text-[11px] font-semibold uppercase tracking-[.04em] text-app-muted">{{ actionSheetMsg.role === 'user' ? 'You' : 'Assistant' }}</span>
              <span class="line-clamp-3 text-[13px] leading-[1.4] text-app-text">{{ (actionSheetMsg.content || '').slice(0, 120) }}{{ (actionSheetMsg.content || '').length > 120 ? '…' : '' }}</span>
            </div>
            <div class="flex flex-col gap-0.5 py-1">
              <button class="flex w-full cursor-pointer items-center gap-3 rounded-[10px] border-0 bg-transparent px-3.5 py-3 text-left text-[15px] text-app-text transition-colors hover:bg-app-surface-2 active:bg-app-surface-3" @click="actionCopyText">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                <span>Copy text</span>
              </button>
              <button
                v-if="actionSheetMsg?.role === 'user' && !sending && editingIdx === null && !actionSheetMsg?.error"
                class="flex w-full cursor-pointer items-center gap-3 rounded-[10px] border-0 bg-transparent px-3.5 py-3 text-left text-[15px] text-app-text transition-colors hover:bg-app-surface-2 active:bg-app-surface-3"
                @click="actionEdit"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                <span>Edit message</span>
              </button>
              <button
                v-if="actionSheetMsg?.error && !sending"
                class="flex w-full cursor-pointer items-center gap-3 rounded-[10px] border-0 bg-transparent px-3.5 py-3 text-left text-[15px] text-app-text transition-colors hover:bg-app-surface-2 active:bg-app-surface-3"
                @click="actionRetry"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
                <span>Retry</span>
              </button>
              <button
                v-if="actionSheetMsg?.error"
                class="flex w-full cursor-pointer items-center gap-3 rounded-[10px] border-0 bg-transparent px-3.5 py-3 text-left text-[15px] text-app-text transition-colors hover:bg-app-surface-2 active:bg-app-surface-3"
                @click="actionDismissError"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                <span>Dismiss error</span>
              </button>
              <button
                v-if="actionSheetIsLastAssistant && !sending && actionSheetMsg?.content"
                class="flex w-full cursor-pointer items-center gap-3 rounded-[10px] border-0 bg-transparent px-3.5 py-3 text-left text-[15px] text-app-text transition-colors hover:bg-app-surface-2 active:bg-app-surface-3"
                @click="actionRegenerate"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
                <span>Regenerate</span>
              </button>
              <button
                v-if="actionSheetMsg?.content && hasShareApi"
                class="flex w-full cursor-pointer items-center gap-3 rounded-[10px] border-0 bg-transparent px-3.5 py-3 text-left text-[15px] text-app-text transition-colors hover:bg-app-surface-2 active:bg-app-surface-3"
                @click="actionShare"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                <span>Share</span>
              </button>
              <button
                v-if="actionSheetMsg?.role === 'user' && !sending && selectedSessionId"
                class="flex w-full cursor-pointer items-center gap-3 rounded-[10px] border-0 bg-transparent px-3.5 py-3 text-left text-[15px] text-app-text transition-colors hover:bg-app-surface-2 active:bg-app-surface-3 danger"
                @click="actionRestore"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M3.5 13A9 9 0 1 0 6 6.5L3 10"/></svg>
                <span>Restore from here</span>
              </button>
            </div>
            <button class="mt-1.5 w-full cursor-pointer rounded-[10px] border-0 bg-app-surface-2 p-3.5 text-[15px] font-semibold text-app-text transition-colors hover:bg-app-surface-3" @click="closeActionSheet">Cancel</button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
