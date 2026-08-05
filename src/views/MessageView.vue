<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { renderMarkdown } from '../utils/markdown'
import { highlightRenderedHtml } from '../utils/renderedSearchHighlight'
import { messageMatchesSearch } from '../utils/messageSearch'
import { branchableMessageHistoryThrough, markLatestAssistantFailure, processNotification } from '../utils/sessionMessages'
import { summarizeToolActivity, thoughtActivityLabel, toolDiffFromResult } from '../utils/activitySummary'
import { summarizeFileActivity } from '../utils/fileActivity'
import PatchDiff from '../components/PatchDiff.vue'
import { isNearChatBottom, jumpToBottomOffset } from '../utils/chatScroll'
import { browseBackward, browseForward, deriveUserHistory, isBrowsingComposerHistory, resetComposerBrowse } from '../utils/composerInputHistory'
import { writeClipboardText } from '../utils/clipboard'
import { formatElapsedSeconds } from '../utils/elapsedTime'
import { createSessionExport, deliverSessionExport } from '../utils/sessionExport'
import { compactTokenCount, contextUsagePercent as getContextUsagePercent, contextUsageSummary as formatContextUsageSummary, type ContextUsage } from '../utils/contextUsage'
import { messageLoadErrorState } from '../utils/messageLoadState'
import { shouldOfferMessageExpansion } from '../utils/messageDisplay'
import { nextStreamActivityDeadline, streamActivityState, type StreamActivityState } from '../utils/streamStall'
import { beginSpeech, playSpeechDataUrl, sanitizeTextForSpeech, stopSpeech } from '../utils/speech'
import { useAuth } from '../composables/useAuth'
import { useGateway, type Message, type ModelProvider, type Session } from '../composables/useGateway'
import { useSharedDraft } from '../composables/useSharedDraft'
import { usePreferences } from '../composables/usePreferences'
import { useLastSession } from '../composables/useLastSession'
import { useToast } from '../composables/useToast'
import { useUnreads } from '../composables/useUnreads'
import { sessionMatchesStoredId } from '../utils/sessionList'
import { sessionMatchesSearch } from '../utils/sessionSearch'
import { sessionListTitle, sessionPreview } from '../utils/sessionTitle'
import { sessionPickerRowsForDisplay } from '../utils/sessionPicker'
import { linkifySessionRefs, parseSessionRefValue, sessionRefFallbackLabel, sessionRefFromMarkdownHref } from '../utils/sessionRefs'
import { previewName, previewTargetFromMarkdownHref } from '../utils/previewTargets'
import { attachmentError, attachmentKind, MAX_ATTACHMENTS, type PendingAttachment } from '../utils/composerAttachments'
import {
  appendQueuedMessage,
  clearQueuedMessages,
  dequeueQueuedMessage,
  getQueuedMessages,
  isQueuePaused,
  migrateQueuedMessages,
  pauseQueuedMessages,
  removeQueuedMessage,
  resumeQueuedMessages,
  setQueuedMessages,
  type QueuedMessage,
} from '../utils/composerQueue'
import { gatewayImageKey, gatewayImagePathFromMarkdownSrc, pendingGatewayImageRequests, type GatewayImageRequest } from '../utils/gatewayImageLoading'
import { imagePan, imageZoom, resetImageTransform, type ImageTransform } from '../utils/imageZoom'
import { isBackSwipe, SWIPE_BACK_EDGE_PX, type SwipeBackGesture } from '../utils/swipeBack'
import { modelPreferenceKey, type ModelPreference } from '../utils/modelPreferences'
import { sharedDraftToComposer } from '../utils/sharedDraft'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ArrowDown, ArrowLeft, BarChart3, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Compass, Copy, EllipsisVertical, FileImage, FileText, GitFork, History, Layers3, MessageCircle, MoreHorizontal, Paperclip, Pencil, RefreshCw, RotateCcw, Search, Send, Square, Star, Terminal, Volume2, VolumeX, X, ZoomIn, ZoomOut } from '@lucide/vue'

const router = useRouter()
const route = useRoute()
const auth = useAuth()
const toast = useToast()
const gw = useGateway()
const sharedDraft = useSharedDraft()
const preferences = usePreferences()
const lastSession = useLastSession()
const unreads = useUnreads()

const sending = ref(false)
const selectedSessionId = ref((route.params.id as string) || '')
const isNewSession = ref(!selectedSessionId.value)
const newSessionCwd = ref(typeof route.query.cwd === 'string' ? route.query.cwd.trim() : '')
const clarifyDraft = ref('')
const clarifying = ref(false)

// ── Model Picker ──
const modelPickerOpen = ref(false)
const headerMenuOpen = ref(false)
const modelProviders = ref<ModelProvider[]>([])
const currentModel = ref('')
const currentProvider = ref('')
const modelLoading = ref(false)
const switchingModel = ref(false)

interface ModelPickerOption extends ModelPreference {
  providerName: string
}

// Desktop exposes a context-usage status item for the focused session. Keep the
// mobile equivalent on demand so opening a chat does not add another gateway RPC.
const contextUsageOpen = ref(false)
const contextUsageLoading = ref(false)
const contextUsageData = ref<ContextUsage | null>(null)
const contextUsageError = ref('')
let contextUsageGeneration = 0

const contextUsageLabel = computed(() => {
  const usage = contextUsageData.value
  return usage ? formatContextUsageSummary(usage) : 'Tokens'
})

const contextUsagePercentLabel = computed(() => {
  const usage = contextUsageData.value
  return usage ? `${getContextUsagePercent(usage)}% full` : ''
})

async function loadContextUsage() {
  const sessionId = selectedSessionId.value
  if (!sessionId || contextUsageLoading.value) return

  const generation = ++contextUsageGeneration
  contextUsageLoading.value = true
  contextUsageError.value = ''
  try {
    const usage = await gw.fetchContextUsage(auth.gatewayUrl.value, sessionId)
    if (generation !== contextUsageGeneration || sessionId !== selectedSessionId.value) return
    contextUsageData.value = usage
    if (!usage) contextUsageError.value = 'Context usage is unavailable for this session.'
  } finally {
    if (generation === contextUsageGeneration) contextUsageLoading.value = false
  }
}

function closeContextUsage() {
  contextUsageGeneration += 1
  contextUsageOpen.value = false
  contextUsageLoading.value = false
}

function toggleContextUsage() {
  if (!selectedSessionId.value) return
  if (contextUsageOpen.value) {
    closeContextUsage()
    return
  }
  contextUsageOpen.value = true
  void loadContextUsage()
}

async function retryContextUsage() {
  contextUsageData.value = null
  await loadContextUsage()
}

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
      await preferences.recordModelRecent({ provider, model })
      modelPickerOpen.value = false
    }
  } finally {
    switchingModel.value = false
  }
}

const availableModelOptions = computed<ModelPickerOption[]>(() => modelProviders.value.flatMap(provider =>
  provider.models.map(model => ({ provider: provider.slug, providerName: provider.name, model })),
))

function resolvedModelOptions(values: readonly ModelPreference[]): ModelPickerOption[] {
  const byKey = new Map(availableModelOptions.value.map(option => [modelPreferenceKey(option.provider, option.model), option]))
  return values.flatMap(value => {
    const option = byKey.get(modelPreferenceKey(value.provider, value.model))
    return option ? [option] : []
  })
}

const favouriteModelOptions = computed(() => resolvedModelOptions(preferences.modelFavourites.value))
const favouriteModelKeys = computed(() => new Set(favouriteModelOptions.value.map(option => modelPreferenceKey(option.provider, option.model))))
const recentModelOptions = computed(() => resolvedModelOptions(preferences.modelRecents.value)
  .filter(option => !favouriteModelKeys.value.has(modelPreferenceKey(option.provider, option.model))))

function isFavouriteModel(provider: string, model: string): boolean {
  return favouriteModelKeys.value.has(modelPreferenceKey(provider, model))
}

function toggleModelFavourite(provider: string, model: string) {
  void preferences.toggleModelFavourite({ provider, model })
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

// Desktop exposes a dedicated session picker for quick resume/switch. Keep the
// same affordance on mobile so switching chats does not require returning to the
// full Sessions screen and losing the current conversation context.
const sessionPickerOpen = ref(false)
const sessionPickerQuery = ref('')
const sessionPickerLoading = ref(false)
const sessionPickerInputEl = ref<HTMLInputElement | null>(null)
// `null` means the auxiliary picker refresh has not produced a result yet.
// An empty array is authoritative and must remain empty rather than falling
// back to the sidebar cache.
const sessionPickerRows = ref<Session[] | null>(null)
const sessionPickerActiveIndex = ref(0)
let sessionPickerGeneration = 0

const sessionPickerSessions = computed(() => {
  const query = sessionPickerQuery.value.trim()
  const rows = sessionPickerRowsForDisplay(sessionPickerRows.value, gw.sessions.value)
  return rows.filter(session => sessionMatchesSearch(session, query))
})

function sessionPickerOptionId(id: string): string {
  return `session-picker-option-${encodeURIComponent(id)}`
}

function scrollToActiveSessionPickerRow() {
  const session = sessionPickerSessions.value[sessionPickerActiveIndex.value]
  if (!session) return
  nextTick(() => {
    document.getElementById(sessionPickerOptionId(session.id))?.scrollIntoView({ block: 'nearest' })
  })
}

function moveSessionPickerSelection(delta: number) {
  const count = sessionPickerSessions.value.length
  if (count === 0) return
  sessionPickerActiveIndex.value = (sessionPickerActiveIndex.value + delta + count) % count
  scrollToActiveSessionPickerRow()
}

function handleSessionPickerKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    closeSessionPicker()
    return
  }

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    moveSessionPickerSelection(e.key === 'ArrowDown' ? 1 : -1)
    return
  }

  if (e.key === 'Enter') {
    const session = sessionPickerSessions.value[sessionPickerActiveIndex.value]
    if (!session) return
    e.preventDefault()
    selectSessionFromPicker(session.id)
  }
}

watch(sessionPickerQuery, () => {
  sessionPickerActiveIndex.value = 0
})

watch(sessionPickerRows, rows => {
  const availableRows = rows || []
  if (sessionPickerQuery.value.trim()) {
    sessionPickerActiveIndex.value = 0
    return
  }
  const selectedIndex = availableRows.findIndex(session => session.id === selectedSessionId.value)
  sessionPickerActiveIndex.value = selectedIndex >= 0 ? selectedIndex : 0
})

watch(sessionPickerSessions, sessions => {
  if (sessions.length === 0) {
    sessionPickerActiveIndex.value = 0
  } else if (sessionPickerActiveIndex.value >= sessions.length) {
    sessionPickerActiveIndex.value = sessions.length - 1
  }
})

async function openSessionPicker() {
  headerMenuOpen.value = false
  sessionPickerOpen.value = true
  const generation = ++sessionPickerGeneration
  sessionPickerRows.value = gw.sessions.value
  const selectedIndex = sessionPickerRows.value.findIndex(session => session.id === selectedSessionId.value)
  sessionPickerActiveIndex.value = selectedIndex >= 0 ? selectedIndex : 0
  await nextTick()
  sessionPickerInputEl.value?.focus()
  scrollToActiveSessionPickerRow()

  // Desktop refreshes its picker query whenever the dialog opens. Do the same
  // here so older sessions remain discoverable even when the sidebar has only
  // loaded its first page; retain the cached rows if this auxiliary request
  // fails.
  if (auth.isConnected.value) {
    sessionPickerLoading.value = true
    try {
      const rows = await gw.fetchSessionPickerSessions(auth.gatewayUrl.value)
      if (generation === sessionPickerGeneration && rows !== null) {
        sessionPickerRows.value = rows
      }
    } finally {
      if (generation === sessionPickerGeneration) {
        sessionPickerLoading.value = false
      }
    }
  }
}

function closeSessionPicker() {
  sessionPickerGeneration += 1
  sessionPickerOpen.value = false
  sessionPickerQuery.value = ''
  sessionPickerRows.value = null
  sessionPickerActiveIndex.value = 0
  sessionPickerLoading.value = false
}

function selectSessionFromPicker(id: string) {
  closeSessionPicker()
  if (id !== selectedSessionId.value) {
    router.push({ name: 'chat', params: { id } })
  }
}

async function markCurrentSessionRead() {
  const sessionId = selectedSessionId.value
  if (!sessionId) return

  const session = gw.sessions.value.find(item => item.id === sessionId)
  if (!session) return

  // Sessions can be entered through boot restoration, a deep link, or the
  // in-chat picker rather than SessionsView.openSession. Keep the unread marker
  // aligned with the desktop contract: the focused session is considered read.
  await unreads.markSessionRead(session.id, session.message_count, session._lineage_root_id)
}

watch(
  () => {
    const session = gw.sessions.value.find(item => item.id === selectedSessionId.value)
    return `${selectedSessionId.value}:${session?.message_count ?? ''}:${session?._lineage_root_id ?? ''}`
  },
  () => { void markCurrentSessionRead() },
  { immediate: true },
)

// Load messages when entering with an existing session
onMounted(async () => {
  gatewayImageViewMounted = true
  ensureGatewayImageObserver()
  void resolveGatewayImageAttachments()
  syncQueuedMessages(selectedSessionId.value)
  await applyIncomingShare()

  if (selectedSessionId.value) {
    void lastSession.setLastSessionId(auth.gatewayUrl.value, selectedSessionId.value)
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
  observeComposerHeight()
})

onUnmounted(() => {
  gatewayImageViewMounted = false
  gatewayImageObserver?.disconnect()
  gatewayImageObserver = null
  gatewayImageElements.clear()
  closeContextUsage()
  stopSpeech()
  speakingMessageId.value = ''
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', onViewportResize)
  }
  composerResizeObserver?.disconnect()
  composerResizeObserver = null
  stopElapsedTimer()
  if (streamStallTimer) {
    clearTimeout(streamStallTimer)
    streamStallTimer = null
  }
})

function onViewportResize() {
  const vh = window.visualViewport?.height || window.innerHeight
  document.documentElement.style.setProperty('--app-height', `${vh}px`)
}

const input = ref('')
const scrollEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const fileInputEl = ref<HTMLInputElement | null>(null)
const pendingAttachments = ref<PendingAttachment[]>([])
const queuedMessages = ref<QueuedMessage[]>([])
const queuePaused = ref(false)
const steering = ref(false)
let queueDrainLock = false

async function applyIncomingShare(): Promise<void> {
  const draft = await sharedDraft.consume()
  if (!draft) return

  const composer = sharedDraftToComposer(draft)
  input.value = composer.text
  pendingAttachments.value = composer.attachments
  await nextTick()
  autoResize()
  toast.show('Shared content added to a new chat', 'info')
}

const composerEl = ref<HTMLElement | null>(null)
const composerHeight = ref(56)
const streamActivity = ref<StreamActivityState>('active')
const streamStalled = computed(() => streamActivity.value === 'stalled')
const streamQuiet = computed(() => streamActivity.value === 'quiet')
let streamStallTimer: ReturnType<typeof setTimeout> | null = null
let composerResizeObserver: ResizeObserver | null = null

const activeClarifyRequest = computed(() => {
  if (!selectedSessionId.value) return null
  const selectedSession = gw.sessions.value.find(session => session.id === selectedSessionId.value)
  const identity = selectedSession || { id: selectedSessionId.value }
  return Object.values(gw.clarifyRequests.value).find(request =>
    sessionMatchesStoredId(identity, request.sessionId)
  ) || null
})

watch(activeClarifyRequest, request => {
  if (!request) clarifyDraft.value = ''
})

async function submitClarify(answer: string) {
  const request = activeClarifyRequest.value
  const trimmedAnswer = answer.trim()
  if (!request || !trimmedAnswer || clarifying.value) return

  clarifying.value = true
  try {
    await gw.respondToClarify(auth.gatewayUrl.value, request.sessionId, request.requestId, trimmedAnswer)
    clarifyDraft.value = ''
  } catch (err: any) {
    toast.show(err?.message || 'Unable to send clarification', 'error')
  } finally {
    clarifying.value = false
  }
}

function handleClarifyKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void submitClarify(clarifyDraft.value)
  }
}

function observeComposerHeight() {
  const composer = composerEl.value
  if (!composer) return
  composerHeight.value = composer.getBoundingClientRect().height
  if (typeof ResizeObserver === 'undefined') return
  composerResizeObserver = new ResizeObserver(([entry]) => {
    composerHeight.value = entry.borderBoxSize[0]?.blockSize || entry.contentRect.height
  })
  composerResizeObserver.observe(composer)
}
// ── User message editing ──
const editingIdx = ref<number | null>(null)
const editText = ref('')
const editEl = ref<HTMLTextAreaElement | null>(null)
const editing = ref(false)
const expandedMessageIds = ref<Set<string>>(new Set())

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

function isExpandableUserMessage(message: { role: string; content: string }): boolean {
  return message.role === 'user' && shouldOfferMessageExpansion(message.content)
}

function isMessageExpanded(message: { id?: string; role: string; timestamp: number }, idx: number): boolean {
  return expandedMessageIds.value.has(messageKey(message, idx))
}

function toggleMessageExpansion(message: { id?: string; role: string; timestamp: number }, idx: number) {
  const key = messageKey(message, idx)
  const next = new Set(expandedMessageIds.value)
  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }
  expandedMessageIds.value = next
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
    // editMessage restores the discarded local branch on transport failure, so
    // surface the error without incorrectly marking the prior assistant reply.
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
watch([() => route.params.id, () => route.query.cwd, () => route.query.shared], async ([newId, cwd, shared]) => {
  stopSpeech()
  speakingMessageId.value = ''
  resetComposerBrowse(selectedSessionId.value)
  selectedSessionId.value = (newId as string) || ''
  isNewSession.value = !selectedSessionId.value
  newSessionCwd.value = typeof cwd === 'string' ? cwd.trim() : ''
  syncQueuedMessages(selectedSessionId.value)
  if (selectedSessionId.value) {
    void lastSession.setLastSessionId(auth.gatewayUrl.value, selectedSessionId.value)
  }
  // The module-level message store is reused across routes. Clear it in Vue's
  // synchronous route phase so the outgoing session cannot paint beneath the
  // next session title while its request is starting.
  gw.messages.value = []
  gw.error.value = ''
  searchQuery.value = ''
  searchOpen.value = false
  clarifyDraft.value = ''
  clarifying.value = false
  editingIdx.value = null
  editText.value = ''
  expandedMessageIds.value = new Set()
  pendingAttachments.value = []
  closeActionSheet()
  closeSessionPicker()
  closeContextUsage()
  contextUsageData.value = null
  contextUsageError.value = ''
  matchIndices.value = []
  currentMatchIdx.value = -1
  shouldFollowMessages.value = true
  if (typeof shared === 'string' && shared) {
    await applyIncomingShare()
  }
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
    // The transcript exposes reasoning and grouped tool detail in disclosures;
    // search that visible semantic content too, rather than only the main bubble.
    if (messageMatchesSearch(msg, q)) {
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
  return highlightRenderedHtml(renderMarkdown(linkifySessionRefs(content, sessionReferenceLabel)), query)
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

// Keep chat navigation lightweight on mobile: a deliberate gesture from the
// left edge returns to the session list, while ordinary vertical transcript
// scrolling remains untouched.
const swipeBackGesture = ref<SwipeBackGesture | null>(null)
const swipeBackHandled = ref(false)

function handleSwipeBackStart(e: TouchEvent) {
  swipeBackHandled.value = false
  if (e.touches.length !== 1 || e.touches[0].clientX > SWIPE_BACK_EDGE_PX) {
    swipeBackGesture.value = null
    return
  }

  const touch = e.touches[0]
  pullStart.value = 0
  pullDelta.value = 0
  swipeBackGesture.value = {
    startX: touch.clientX,
    startY: touch.clientY,
    currentX: touch.clientX,
    currentY: touch.clientY,
  }
}

function handleSwipeBackMove(e: TouchEvent) {
  const gesture = swipeBackGesture.value
  if (!gesture || e.touches.length !== 1) return

  const touch = e.touches[0]
  const next = {
    ...gesture,
    currentX: touch.clientX,
    currentY: touch.clientY,
  }
  const distanceX = next.currentX - next.startX
  const distanceY = Math.abs(next.currentY - next.startY)

  // Cancel as soon as the finger is clearly moving back into transcript
  // scrolling. The regular touch handlers can then resume normally.
  if (distanceX < 0 || (distanceX < 16 && distanceY > 16) || distanceY > Math.max(24, distanceX * 0.85)) {
    swipeBackGesture.value = null
    return
  }

  swipeBackGesture.value = next
}

function handleSwipeBackEnd() {
  const gesture = swipeBackGesture.value
  swipeBackGesture.value = null
  if (!gesture || !isBackSwipe(gesture)) return

  swipeBackHandled.value = true
  goBack()
}

function handleSwipeBackCancel() {
  swipeBackGesture.value = null
  swipeBackHandled.value = false
}

function syncQueuedMessages(sessionId = selectedSessionId.value) {
  const id = sessionId.trim()
  queuedMessages.value = id ? getQueuedMessages(id) : []
  queuePaused.value = id ? isQueuePaused(id) : false
}

function queueMessageForSession(sessionId: string, text: string): void {
  const targetSessionId = sessionId.trim()
  const trimmed = text.trim()
  if (!targetSessionId || !trimmed) return

  const result = appendQueuedMessage(getQueuedMessages(targetSessionId), trimmed, [])
  setQueuedMessages(targetSessionId, result.queue)
  resumeQueuedMessages(targetSessionId)

  // A redirect can fail after the reader has navigated away. Keep the fallback
  // attached to the session that was being steered instead of the newly focused
  // chat, and do not clear the new chat's draft while doing so.
  const isCurrentSession = selectedSessionId.value === targetSessionId
  if (isCurrentSession) {
    queuedMessages.value = result.queue
    queuePaused.value = false
    input.value = ''
    if (inputEl.value) inputEl.value.style.height = 'auto'
  }
  toast.show(isCurrentSession ? 'Message queued' : 'Message queued for that session', 'info')
}

function queueCurrentMessage(text: string): void {
  queueMessageForSession(selectedSessionId.value, text)
}

function removeQueued(id: string): void {
  const sessionId = selectedSessionId.value
  if (!sessionId) return
  const next = removeQueuedMessage(getQueuedMessages(sessionId), id)
  setQueuedMessages(sessionId, next)
  queuedMessages.value = next
  queuePaused.value = isQueuePaused(sessionId)
}

function clearCurrentQueue(): void {
  const sessionId = selectedSessionId.value
  if (!sessionId) return
  clearQueuedMessages(sessionId)
  queuedMessages.value = []
  queuePaused.value = false
}

function resumeQueue(): void {
  const sessionId = selectedSessionId.value
  if (!sessionId) return
  resumeQueuedMessages(sessionId)
  queuePaused.value = false
  void drainQueuedMessages(sessionId)
}

async function drainQueuedMessages(sessionId: string): Promise<void> {
  if (
    !sessionId
    || queueDrainLock
    || sending.value
    || selectedSessionId.value !== sessionId
    || isQueuePaused(sessionId)
  ) return

  const current = getQueuedMessages(sessionId)
  queuedMessages.value = current
  const { entry } = dequeueQueuedMessage(current)
  if (!entry) return

  queueDrainLock = true
  let sent = false
  try {
    sent = await sendText(entry.text, false, entry.attachments, true, sessionId)
  } finally {
    queueDrainLock = false
  }

  if (!sent) return

  const next = removeQueuedMessage(getQueuedMessages(sessionId), entry.id)
  setQueuedMessages(sessionId, next)
  if (selectedSessionId.value === sessionId) {
    queuedMessages.value = next
    queuePaused.value = isQueuePaused(sessionId)
    void drainQueuedMessages(sessionId)
  }
}

function handleSend() {
  if (isViewingOfflineTranscript.value) return
  const text = input.value.trim()
  if (sending.value) {
    if (text) void handleSteer()
    return
  }
  if (!text && pendingAttachments.value.length === 0) return
  void sendText(text)
}

function insertSteeringMessage(text: string): Message {
  const message: Message = {
    id: `steer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content: text,
    timestamp: Date.now() / 1000,
  }
  const activeReplyIndex = [...gw.messages.value].map(item => item.role).lastIndexOf('assistant')
  if (activeReplyIndex >= 0) {
    gw.messages.value.splice(activeReplyIndex, 0, message)
  } else {
    gw.messages.value.push(message)
  }
  return message
}

async function handleSteer() {
  const text = input.value.trim()
  const sessionId = selectedSessionId.value
  const runtimeId = gw.activeRuntimeId.value
  if (!text || !sessionId || !sending.value || steering.value) return
  if (!runtimeId) {
    queueCurrentMessage(text)
    return
  }

  const optimisticMessage = insertSteeringMessage(text)
  input.value = ''
  if (inputEl.value) inputEl.value.style.height = 'auto'
  steering.value = true

  try {
    const result = await gw.redirectSession(sessionId, text)
    if (selectedSessionId.value !== sessionId) return
    if (result === 'queued') {
      const index = gw.messages.value.indexOf(optimisticMessage)
      if (index >= 0) {
        gw.messages.value.splice(index, 1)
        gw.messages.value.push(optimisticMessage)
      }
      toast.show('Correction queued', 'info')
    }
  } catch {
    const index = gw.messages.value.indexOf(optimisticMessage)
    if (index >= 0) gw.messages.value.splice(index, 1)
    // Preserve a failed redirect against the original target even if the user
    // changed sessions while the RPC was in flight. The route watcher will
    // hydrate this per-session queue when they return.
    queueMessageForSession(sessionId, text)
  } finally {
    steering.value = false
  }
}

async function sendText(
  text: string,
  preserveUserMessage = false,
  attachments: readonly PendingAttachment[] = pendingAttachments.value,
  fromQueue = false,
  queueSessionId?: string,
): Promise<boolean> {
  if (isViewingOfflineTranscript.value) return false
  sending.value = true
  shouldFollowMessages.value = true

  // Generate session ID for new sessions. Queue entries created while this
  // first turn is running are migrated when the gateway assigns the stored id.
  if (!selectedSessionId.value) {
    selectedSessionId.value = crypto.randomUUID()
  }
  let activeQueueSessionId = queueSessionId || selectedSessionId.value
  const requestSessionId = selectedSessionId.value
  const requestIsNewSession = isNewSession.value
  resetComposerBrowse(requestSessionId)

  // A failed turn already has its user message in the thread. Preserve that
  // record when retrying so the chat does not display the same prompt twice.
  if (!preserveUserMessage) {
    const attachmentLabels = attachments.map(attachment => `Attached: ${attachment.name}`)
    const displayText = [text, ...attachmentLabels].filter(Boolean).join('\n')
    const imageAttachments = attachments
      .filter(attachment => attachment.kind === 'image')
      .map(attachment => ({ label: attachment.name, src: attachment.dataUrl }))
    gw.messages.value.push({
      role: 'user',
      content: displayText,
      timestamp: Date.now() / 1000,
      ...(imageAttachments.length ? { imageAttachments } : {}),
    })
  }

  input.value = ''
  if (inputEl.value) inputEl.value.style.height = 'auto'

  let succeeded = false
  try {
    const result = await gw.sendMessage(auth.gatewayUrl.value, requestSessionId, text, requestIsNewSession, attachments, newSessionCwd.value)
    pendingAttachments.value = pendingAttachments.value.filter(attachment => !attachments.includes(attachment))
    if (result?.newSessionId) {
      migrateQueuedMessages(activeQueueSessionId, result.newSessionId)
      activeQueueSessionId = result.newSessionId
      selectedSessionId.value = result.newSessionId
      isNewSession.value = false
      syncQueuedMessages(result.newSessionId)
      void lastSession.setLastSessionId(auth.gatewayUrl.value, result.newSessionId)
    }
    succeeded = true
    return true
  } catch (err: any) {
    const message = err.message || 'Unknown error'
    pauseQueuedMessages(activeQueueSessionId)
    if (selectedSessionId.value === activeQueueSessionId) queuePaused.value = true
    // sendMessage adds an assistant bubble before submitting. Retain any
    // streamed partial response and make that same bubble retryable instead
    // of appending a duplicate error after it.
    const last = gw.messages.value[gw.messages.value.length - 1]
    if (last?.role === 'assistant') {
      markLatestAssistantFailure(gw.messages.value, message)
    } else {
      gw.messages.value.push({
        role: 'assistant',
        content: message,
        timestamp: Date.now() / 1000,
        error: true,
      })
    }
    return false
  } finally {
    sending.value = false
    // Explicit Stop and failed turns pause the queue. A successful ordinary
    // turn drains its FIFO head; queued turns drain one-by-one through their
    // own `fromQueue` calls.
    if (succeeded && !fromQueue && !isQueuePaused(activeQueueSessionId)) {
      syncQueuedMessages(activeQueueSessionId)
      void drainQueuedMessages(activeQueueSessionId)
    }
  }
}


function retryFailed(failedMsgIdx: number) {
  if (sending.value) return
  // Find the user message that preceded this failed assistant message.
  for (let i = failedMsgIdx - 1; i >= 0; i--) {
    if (gw.messages.value[i].role === 'user') {
      const userText = gw.messages.value[i].content
        .split('\n')
        .filter(line => !line.startsWith('Attached: '))
        .join('\n')
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
  if (e.key === 'ArrowUp') {
    // Match Desktop: an ordinary typed draft keeps its keyboard behavior. Once
    // browsing has started, further ArrowUp presses move through older prompts.
    if (input.value.trim() && !isBrowsingComposerHistory(selectedSessionId.value)) return

    const entry = browseBackward(
      selectedSessionId.value,
      input.value,
      deriveUserHistory(gw.messages.value, message => message.content),
    )
    if (entry !== null) {
      e.preventDefault()
      input.value = entry
      nextTick(autoResize)
    }
    return
  }

  if (e.key === 'ArrowDown') {
    if (!isBrowsingComposerHistory(selectedSessionId.value)) return

    e.preventDefault()
    const result = browseForward(
      selectedSessionId.value,
      deriveUserHistory(gw.messages.value, message => message.content),
    )
    if (result) {
      input.value = result.text
      nextTick(autoResize)
    }
    return
  }

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
  if (swipeBackGesture.value) return
  if (scrollEl.value && scrollEl.value.scrollTop === 0) {
    pullStart.value = e.touches[0].clientY
  }
}

function onChatTouchMove(e: TouchEvent) {
  if (swipeBackGesture.value) return
  if (pullStart.value === 0) return
  const delta = e.touches[0].clientY - pullStart.value
  if (delta > 0 && scrollEl.value && scrollEl.value.scrollTop === 0) {
    pullDelta.value = Math.min(delta * 0.5, 80)
  }
}

async function onChatTouchEnd() {
  if (swipeBackHandled.value) {
    swipeBackHandled.value = false
    pullStart.value = 0
    pullDelta.value = 0
    return
  }
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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}`))
    reader.readAsDataURL(file)
  })
}

function openAttachmentPicker() {
  if (!sending.value) fileInputEl.value?.click()
}

async function handleAttachmentPick(event: Event) {
  const inputElement = event.target as HTMLInputElement
  const files = Array.from(inputElement.files || [])
  inputElement.value = ''
  if (!files.length) return

  let count = pendingAttachments.value.length
  for (const file of files) {
    const error = attachmentError(file.name, file.size, count)
    if (error) {
      toast.show(error, 'error')
      continue
    }

    try {
      pendingAttachments.value = [
        ...pendingAttachments.value,
        {
          id: crypto.randomUUID(),
          kind: attachmentKind(file.name, file.type),
          name: file.name || 'attachment',
          mimeType: file.type || 'application/octet-stream',
          dataUrl: await readFileAsDataUrl(file),
          size: file.size,
        },
      ]
      count++
    } catch (err: any) {
      toast.show(err?.message || `Could not read ${file.name}`, 'error')
    }
  }
}

function removePendingAttachment(id: string) {
  pendingAttachments.value = pendingAttachments.value.filter(attachment => attachment.id !== id)
}

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function sessionReferenceLabel(value: string): string {
  const { sessionId } = parseSessionRefValue(value)
  const session = gw.sessions.value.find(item => item.id === sessionId || item._lineage_root_id === sessionId)
  return session?.title?.trim() || session?.preview?.trim() || sessionRefFallbackLabel(value)
}

function render(content: string): string {
  return renderMarkdown(linkifySessionRefs(content, sessionReferenceLabel))
}

// Desktop opens rendered images in a dedicated zoomable viewer. Keep the mobile
// equivalent local to the message surface so the markdown renderer stays pure.
interface ImagePreviewState {
  src: string
  alt: string
  transform: ImageTransform
}

const imagePreview = ref<ImagePreviewState | null>(null)
const imagePreviewDrag = ref<{ pointerId: number; x: number; y: number } | null>(null)

const imagePreviewStyle = computed(() => {
  const transform = imagePreview.value?.transform
  if (!transform) return undefined
  return {
    transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
  }
})

function openImagePreview(image: HTMLImageElement) {
  const src = image.currentSrc || image.src
  if (!src) return
  imagePreview.value = { src, alt: image.alt || 'Image preview', transform: resetImageTransform() }
}

function openAttachmentPreview(src: string, label: string) {
  if (!src) return
  imagePreview.value = { src, alt: label, transform: resetImageTransform() }
}

function zoomImagePreview(factor: number, originX = 0, originY = 0) {
  const preview = imagePreview.value
  if (!preview) return
  imagePreview.value = { ...preview, transform: imageZoom(preview.transform, factor, originX, originY) }
}

function resetImagePreview() {
  if (!imagePreview.value) return
  imagePreview.value = { ...imagePreview.value, transform: resetImageTransform() }
}

function handleImagePreviewPointerDown(e: PointerEvent) {
  const preview = imagePreview.value
  const target = e.currentTarget
  if (!preview || !(target instanceof HTMLElement)) return
  target.setPointerCapture(e.pointerId)
  imagePreviewDrag.value = {
    pointerId: e.pointerId,
    x: e.clientX,
    y: e.clientY,
  }
}

function handleImagePreviewPointerMove(e: PointerEvent) {
  const drag = imagePreviewDrag.value
  if (!drag || drag.pointerId !== e.pointerId || !imagePreview.value) return
  imagePreview.value = {
    ...imagePreview.value,
    transform: imagePan(imagePreview.value.transform, e.clientX - drag.x, e.clientY - drag.y),
  }
  drag.x = e.clientX
  drag.y = e.clientY
}

function handleImagePreviewPointerEnd(e: PointerEvent) {
  if (imagePreviewDrag.value?.pointerId === e.pointerId) imagePreviewDrag.value = null
}

function handleImagePreviewWheel(e: WheelEvent) {
  const target = e.currentTarget
  if (!(target instanceof HTMLElement)) return
  const rect = target.getBoundingClientRect()
  const originX = e.clientX - rect.left - rect.width / 2
  const originY = e.clientY - rect.top - rect.height / 2
  zoomImagePreview(e.deltaY < 0 ? 1.1 : 1 / 1.1, originX, originY)
}

// Desktop's Markdown renderer resolves absolute image paths through the gateway
// media API. A mobile webview cannot read those host paths directly, so retry
// failed Markdown images through the authenticated endpoint instead of leaving a
// broken thumbnail in the transcript.
const markdownImageDataUrls = new Map<string, string>()
const markdownImageRequests = new Map<string, Promise<string | null>>()

function markdownImageCacheKey(path: string): string {
  return `${auth.gatewayUrl.value}\u0000${path}`
}

async function resolveMarkdownImage(path: string): Promise<string | null> {
  const key = markdownImageCacheKey(path)
  const cached = markdownImageDataUrls.get(key)
  if (cached) return cached

  const existing = markdownImageRequests.get(key)
  if (existing) return existing

  const request = gw.fetchMediaDataUrl(auth.gatewayUrl.value, path)
    .then(dataUrl => {
      if (dataUrl) markdownImageDataUrls.set(key, dataUrl)
      return dataUrl
    })
    .catch(() => null)
    .finally(() => {
      markdownImageRequests.delete(key)
    })
  markdownImageRequests.set(key, request)
  return request
}

async function handleMarkdownImageError(e: Event) {
  const image = e.target instanceof HTMLImageElement ? e.target : null
  if (!image || !image.classList.contains('md-img')) return

  const path = gatewayImagePathFromMarkdownSrc(image.getAttribute('src') || '')
  if (!path || image.dataset.gatewayImageState) return

  image.dataset.gatewayImagePath = path
  image.dataset.gatewayImageState = 'loading'
  const dataUrl = await resolveMarkdownImage(path)
  if (image.dataset.gatewayImagePath !== path) return

  if (dataUrl) {
    image.dataset.gatewayImageState = 'resolved'
    image.src = dataUrl
  } else {
    image.dataset.gatewayImageState = 'failed'
    image.title = `Unable to load ${image.alt || 'image'}`
  }
}

const resolvedGatewayImages = ref<Record<string, string>>({})
const resolvingGatewayImages = new Set<string>()
const gatewayImageElements = new Map<Element, GatewayImageRequest>()
let gatewayImageObserver: IntersectionObserver | null = null
let gatewayImageViewMounted = false

function imageAttachmentKey(
  message: { id?: string; timestamp: number },
  attachment: { src?: string; gatewayPath?: string },
  index: number,
): string {
  return gatewayImageKey(selectedSessionId.value, message, attachment, index)
}

function imageAttachmentSrc(
  message: { id?: string; timestamp: number },
  attachment: { src?: string; gatewayPath?: string },
  index: number,
): string {
  return attachment.src || resolvedGatewayImages.value[imageAttachmentKey(message, attachment, index)] || ''
}

function pendingGatewayImages(): GatewayImageRequest[] {
  return pendingGatewayImageRequests(
    gw.messages.value,
    selectedSessionId.value,
    new Set(Object.keys(resolvedGatewayImages.value)),
    resolvingGatewayImages,
  )
}

async function resolveGatewayImage(request: GatewayImageRequest): Promise<void> {
  if (resolvedGatewayImages.value[request.key] || resolvingGatewayImages.has(request.key)) return

  resolvingGatewayImages.add(request.key)
  try {
    const src = await gw.fetchMediaDataUrl(auth.gatewayUrl.value, request.path)
    if (src) resolvedGatewayImages.value = { ...resolvedGatewayImages.value, [request.key]: src }
  } finally {
    resolvingGatewayImages.delete(request.key)
  }
}

function detachGatewayImageElement(element: Element): void {
  gatewayImageObserver?.unobserve(element)
  gatewayImageElements.delete(element)
}

function observeGatewayImage(
  message: { id?: string; timestamp: number },
  attachment: { src?: string; gatewayPath?: string },
  index: number,
  value: Element | { $el: Element } | null,
): void {
  const element = value instanceof Element ? value : value?.$el
  const path = attachment.gatewayPath?.trim()
  const key = imageAttachmentKey(message, attachment, index)

  if (!element || !path) {
    for (const [candidate, request] of gatewayImageElements) {
      if (request.key === key) detachGatewayImageElement(candidate)
    }
    return
  }

  gatewayImageElements.set(element, { key, path })
  if (gatewayImageObserver && !resolvedGatewayImages.value[key] && !resolvingGatewayImages.has(key)) {
    gatewayImageObserver.observe(element)
  }
}

function ensureGatewayImageObserver(): void {
  if (gatewayImageObserver || typeof IntersectionObserver === 'undefined') return

  gatewayImageObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const request = gatewayImageElements.get(entry.target)
      if (!request) continue
      gatewayImageObserver?.unobserve(entry.target)
      void resolveGatewayImage(request)
    }
  }, {
    root: scrollEl.value,
    rootMargin: '200px',
  })

  for (const element of gatewayImageElements.keys()) {
    gatewayImageObserver.observe(element)
  }
}

async function resolveGatewayImageAttachments(): Promise<void> {
  if (!gatewayImageViewMounted) return

  // Tauri's supported webviews provide IntersectionObserver, but keep the old
  // eager behaviour as a compatibility path for older embedded runtimes.
  if (typeof IntersectionObserver !== 'undefined') {
    ensureGatewayImageObserver()
    return
  }

  await Promise.all(pendingGatewayImages().map(resolveGatewayImage))
}

const imageAttachmentSignature = computed(() => gw.messages.value
  .flatMap(message => (message.imageAttachments || []).map(attachment => `${message.id || message.timestamp}:${attachment.gatewayPath || attachment.src || ''}`))
  .join('|'))

watch(imageAttachmentSignature, () => {
  void resolveGatewayImageAttachments()
}, { immediate: true })

function closeImagePreview() {
  imagePreviewDrag.value = null
  imagePreview.value = null
}

function openPreviewTarget(href: string) {
  const target = previewTargetFromMarkdownHref(href)
  if (!target) {
    toast.show('Invalid preview target', 'error')
    return
  }

  let url: URL
  try {
    url = new URL(target)
  } catch {
    toast.show(`Local preview unavailable on mobile: ${previewName(target)}`, 'info')
    return
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    toast.show(`Local preview unavailable on mobile: ${previewName(target)}`, 'info')
    return
  }

  openUrl(url.href).catch(() => toast.show('Unable to open preview', 'error'))
}

function handleMessagesClick(e: Event) {
  const clickedImage = (e.target as HTMLElement).closest('img.md-img') as HTMLImageElement | null
  if (clickedImage) {
    e.preventDefault()
    e.stopPropagation()
    openImagePreview(clickedImage)
    return
  }

  const clickedPreview = (e.target as HTMLElement).closest('a.md-preview-link') as HTMLAnchorElement | null
  if (clickedPreview) {
    e.preventDefault()
    e.stopPropagation()
    openPreviewTarget(clickedPreview.getAttribute('href') || '')
    return
  }

  const clickedLink = (e.target as HTMLElement).closest('a.md-link') as HTMLAnchorElement | null
  if (clickedLink) {
    e.preventDefault()
    e.stopPropagation()

    const sessionValue = sessionRefFromMarkdownHref(clickedLink.getAttribute('href') || '')
    if (sessionValue) {
      const { sessionId } = parseSessionRefValue(sessionValue)
      if (!sessionId) {
        toast.show('Invalid session reference', 'error')
        return
      }

      // A compressed session may be referenced by its lineage root. Prefer the
      // currently visible durable row when available, otherwise use the ID from
      // the reference and let normal history hydration report a missing session.
      const matchingSession = gw.sessions.value.find(item => item.id === sessionId || item._lineage_root_id === sessionId)
      const targetSessionId = matchingSession?.id || sessionId
      void lastSession.setLastSessionId(auth.gatewayUrl.value, targetSessionId)
      void router.push({ name: 'chat', params: { id: targetSessionId } })
      return
    }

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
const speakingMessageId = ref('')
const actionSheetMsg = computed(() => {
  if (actionSheetMsgIdx.value < 0) return null
  return gw.messages.value[actionSheetMsgIdx.value] || null
})
const actionSheetIsLastAssistant = computed(() => {
  const msgs = gw.messages.value
  const idx = actionSheetMsgIdx.value
  return idx >= 0 && msgs[idx]?.role === 'assistant' && idx === msgs.length - 1
})
function messageActionId(message: { id?: string; role: string; timestamp: number }, idx: number): string {
  return `${selectedSessionId.value || 'new'}:${message.id || `${message.role}-${message.timestamp}-${idx}`}`
}

const actionSheetIsSpeaking = computed(() => {
  const message = actionSheetMsg.value
  if (!message) return false
  return speakingMessageId.value === messageActionId(message, actionSheetMsgIdx.value)
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

function actionReadAloud() {
  const idx = actionSheetMsgIdx.value
  const message = actionSheetMsg.value
  if (!message?.content || message.role !== 'assistant') {
    closeActionSheet()
    return
  }

  const id = messageActionId(message, idx)
  closeActionSheet()
  if (speakingMessageId.value === id) {
    stopSpeech()
    speakingMessageId.value = ''
    return
  }

  const requestId = beginSpeech()
  speakingMessageId.value = id
  void (async () => {
    try {
      const spokenText = sanitizeTextForSpeech(message.content)
      const response = await gw.speakText(auth.gatewayUrl.value, spokenText)
      const spoken = await playSpeechDataUrl(response.data_url, requestId)
      if (speakingMessageId.value !== id) return
      speakingMessageId.value = ''
      if (!spoken) toast.show('Unable to play read aloud audio', 'error')
    } catch {
      if (speakingMessageId.value !== id) return
      speakingMessageId.value = ''
      toast.show('Unable to read this message aloud', 'error')
    }
  })()
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

// Desktop branches from an assistant turn into a separate child session, so the
// original transcript remains untouched while the new direction has its own
// durable history. Navigate only after the gateway returns the stored identity.
async function actionBranch() {
  const msg = actionSheetMsg.value
  const messageIndex = actionSheetMsgIdx.value
  const session = gw.sessions.value.find(item => sessionMatchesStoredId(item, selectedSessionId.value))
  closeActionSheet()
  if (sending.value || !selectedSessionId.value || !msg || msg.role !== 'assistant' || !msg.content.trim()) return

  const branchMessages = branchableMessageHistoryThrough(gw.messages.value, messageIndex)
  if (!branchMessages.length) return

  try {
    const branchSessionId = await gw.branchSession(selectedSessionId.value, branchMessages, session?.cwd)
    await router.push({ name: 'chat', params: { id: branchSessionId } })
  } catch (err: any) {
    toast.show(err?.message || 'Unable to branch this message', 'error')
  }
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

function canRestoreMessage(message: Message | null | undefined, idx: number): boolean {
  return Boolean(
    selectedSessionId.value
    && !sending.value
    && editingIdx.value !== idx
    && message?.role === 'user'
    && message.content.trim(),
  )
}

async function restoreMessageAt(idx: number) {
  const message = gw.messages.value[idx]
  if (!canRestoreMessage(message, idx)) return
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

async function actionRestore() {
  const idx = actionSheetMsgIdx.value
  closeActionSheet()
  await restoreMessageAt(idx)
}

function isThinking(content: string): boolean {
  return content.includes('<think>') && !content.includes('</think>')
}

function messageKey(message: { id?: string; role: string; timestamp: number }, idx: number): string {
  return `${selectedSessionId.value || 'new'}:${message.id || `${message.role}-${message.timestamp}-${idx}`}`
}

function toolResults(message: {
  toolResults?: { id: string; name: string; content: string; timestamp: number; diff?: string; filePaths?: string[]; failed?: boolean }[]
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

function activityHasDiff(message: Parameters<typeof toolResults>[0]): boolean {
  return toolResults(message).some(tool => Boolean(toolDiffFromResult(tool)))
}

function fileActivitySummary(message: Parameters<typeof toolResults>[0]) {
  return summarizeFileActivity(toolResults(message))
}

function isActivityMessage(message: { role: string; content: string; reasoning?: string; toolCalls?: unknown[] }): boolean {
  return message.role === 'tool' || (message.role === 'assistant' && !message.content && Boolean(message.reasoning || message.toolCalls?.length))
}

function processNoteFor(message: { role: string; content: string }) {
  return message.role === 'user' ? processNotification(message.content) : null
}

function thoughtLabel(message: { timestamp: number }, idx: number): string {
  const next = gw.messages.value.slice(idx + 1).find(item => item.timestamp > message.timestamp)
  return thoughtActivityLabel(next ? next.timestamp - message.timestamp : 0)
}

function activityThoughtLabel(seconds: number): string {
  return thoughtActivityLabel(seconds)
}

const hasMessages = computed(() => gw.messages.value.length > 0)
const isViewingOfflineTranscript = computed(() => Boolean(
  selectedSessionId.value
  && gw.viewingCachedTranscriptSessionId.value === selectedSessionId.value,
))
const loadErrorState = computed(() => messageLoadErrorState(gw.error.value, hasMessages.value))

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

function startElapsedTimer() {
  if (elapsedTimer) return
  elapsedTimer = setInterval(() => {
    if (gw.turnStartedAt.value) {
      elapsedDisplay.value = formatElapsedSeconds((Date.now() - gw.turnStartedAt.value) / 1000)
    }
  }, 1000)
  if (gw.turnStartedAt.value) {
    elapsedDisplay.value = formatElapsedSeconds((Date.now() - gw.turnStartedAt.value) / 1000)
  }
}

function stopElapsedTimer() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer)
    elapsedTimer = null
  }
  elapsedDisplay.value = ''
}

// Visible deltas are primary. Fresh WebSocket traffic turns a quiet response into
// an informative "working quietly" state rather than a false stall diagnosis.
function resetStreamStallTimer() {
  if (streamStallTimer) {
    clearTimeout(streamStallTimer)
    streamStallTimer = null
  }

  const now = Date.now()
  streamActivity.value = streamActivityState(
    gw.turnStartedAt.value,
    gw.lastStreamActivityAt.value,
    gw.lastStreamTransportActivityAt.value,
    now,
  )
  const deadline = nextStreamActivityDeadline(
    gw.turnStartedAt.value,
    gw.lastStreamActivityAt.value,
    gw.lastStreamTransportActivityAt.value,
    now,
  )
  if (deadline === null) return
  streamStallTimer = setTimeout(resetStreamStallTimer, Math.max(0, deadline - now))
}

watch(
  () => [gw.turnStartedAt.value, gw.lastStreamActivityAt.value, gw.lastStreamTransportActivityAt.value],
  resetStreamStallTimer,
  { immediate: true },
)

watch(() => gw.turnStartedAt.value, (val) => {
  if (val) {
    startElapsedTimer()
  } else {
    stopElapsedTimer()
  }
}, { immediate: true })

watch(() => gw.turnStartedAt.value, (val, previous) => {
  if (previous && val === null && contextUsageOpen.value) {
    contextUsageData.value = null
    void nextTick().then(() => loadContextUsage())
  }
})

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
// Desktop exports the durable transcript shape instead of rendered HTML. Build
// that same portable payload before selecting the best delivery path for Tauri
// mobile, where a browser-style download is not consistently available.
async function exportChat() {
  const msgs = gw.messages.value
  if (!msgs.length) {
    toast.show('No messages to export', 'info')
    return
  }

  const title = selectedSessionTitle.value || 'Hermes Chat'
  const session = gw.sessions.value.find(item => item.id === selectedSessionId.value) || null
  const { fileName, serialized } = createSessionExport({
    sessionId: selectedSessionId.value,
    title,
    session,
    messages: msgs,
  })

  try {
    const delivery = await deliverSessionExport({ fileName, serialized }, title)
    if (delivery === 'file') {
      toast.show('Chat export ready to share', 'success')
    } else if (delivery === 'text') {
      toast.show('Chat JSON ready to share', 'success')
    } else if (delivery === 'clipboard') {
      toast.show('Chat JSON copied to clipboard', 'success')
    } else if (delivery === 'unavailable') {
      toast.show('Export not available on this device', 'error')
    }
  } catch (err: any) {
    toast.show(err?.message || 'Export failed', 'error')
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
    const message = err.message || 'Regenerate failed'
    markLatestAssistantFailure(gw.messages.value, message)
    toast.show(message, 'error')
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
  if (selectedSessionId.value && queuedMessages.value.length > 0) {
    pauseQueuedMessages(selectedSessionId.value)
    queuePaused.value = true
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
    <div class="flex min-h-12 shrink-0 items-center gap-2 border-b border-app-border bg-app-surface px-3 py-2.5">
      <button class="flex cursor-pointer items-center justify-center border-0 bg-transparent px-1 text-app-accent" @click="goBack" aria-label="Back to sessions"><ArrowLeft :size="22" :stroke-width="2" /></button>
      <button
        class="flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-1 py-1 text-left text-[15px] font-semibold tracking-[-0.02em] text-app-text transition-colors hover:bg-app-surface-2"
        type="button"
        aria-label="Switch session"
        title="Switch session"
        @click="openSessionPicker"
      >
        <span class="min-w-0 flex-1 truncate">{{ selectedSessionTitle }}</span>
        <ChevronDown class="shrink-0 text-app-muted" :size="14" :stroke-width="2" />
      </button>
      <button
        v-if="selectedSessionId"
        class="flex max-w-[104px] shrink-0 cursor-pointer items-center gap-1 rounded-md border border-app-border bg-app-surface-2 px-2 py-1 text-xs font-medium text-app-muted transition-all hover:border-app-accent hover:bg-app-accent/10 hover:text-app-accent"
        type="button"
        :class="{ 'border-app-accent/40 bg-app-accent/10 text-app-accent': contextUsageOpen }"
        aria-label="Show token usage"
        title="Show token usage"
        @click="toggleContextUsage"
      >
        <BarChart3 class="shrink-0" :size="13" :stroke-width="2" />
        <span class="truncate">{{ contextUsageLabel }}</span>
      </button>
      <button class="flex max-w-[120px] shrink-0 cursor-pointer items-center gap-1 rounded-md border border-app-border bg-app-surface-2 px-2 py-1 text-xs font-medium text-app-muted transition-all hover:border-app-accent hover:bg-app-accent/10 hover:text-app-accent" @click="toggleModelPicker" :class="{ active: modelPickerOpen }">
        <span class="truncate">{{ currentModelShort }}</span>
        <ChevronDown :size="10" :stroke-width="2.5" />
      </button>
      <div class="relative shrink-0">
        <button
          class="flex cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-1.5 text-app-muted transition-colors hover:bg-app-surface-2 hover:text-app-text"
          :class="{ active: headerMenuOpen }"
          aria-label="Chat actions"
          @click="headerMenuOpen = !headerMenuOpen"
        >
          <MoreHorizontal :size="18" :stroke-width="2" />
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
      <Search class="shrink-0 text-app-muted" :size="14" :stroke-width="2" />
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
      <button class="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-app-border bg-transparent text-app-muted transition-all hover:border-app-muted hover:text-app-text disabled:cursor-default disabled:opacity-30" @click="prevMatch" :disabled="matchIndices.length === 0" aria-label="Previous match"><ChevronLeft :size="16" :stroke-width="2" /></button>
      <button class="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-app-border bg-transparent text-app-muted transition-all hover:border-app-muted hover:text-app-text disabled:cursor-default disabled:opacity-30" @click="nextMatch" :disabled="matchIndices.length === 0" aria-label="Next match"><ChevronRight :size="16" :stroke-width="2" /></button>
      <button class="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-app-muted transition-colors hover:text-app-error" @click="toggleSearch" aria-label="Close search"><X :size="16" :stroke-width="2" /></button>
    </div>

    <!-- Messages -->
    <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto overscroll-contain px-3 py-3" ref="scrollEl" @scroll="onScroll" @error.capture="handleMarkdownImageError" @click="handleMessagesClick" @touchstart.capture="handleSwipeBackStart" @touchmove.capture="handleSwipeBackMove" @touchend.capture="handleSwipeBackEnd" @touchcancel.capture="handleSwipeBackCancel" @touchstart="onChatTouchStart" @touchmove="onChatTouchMove" @touchend="onChatTouchEnd">
      <div v-if="isViewingOfflineTranscript" class="flex items-center justify-between gap-3 rounded-lg border border-app-accent/30 bg-app-accent/10 px-3 py-2 text-[13px] text-app-muted">
        <span>Offline — viewing a cached, read-only transcript</span>
        <button class="shrink-0 cursor-pointer rounded-md border-0 bg-transparent px-1 font-medium text-app-accent hover:text-app-accent-hover" @click="refreshMessages">Retry</button>
      </div>
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
        <MessageCircle :size="32" :stroke-width="1.6" />
        <div class="text-sm">Start a conversation</div>
      </div>

      <!-- A transcript fetch can fail before any cached history is available.
           Match desktop's recovery contract: state the failure plainly and leave
           a direct, bounded retry in the same place rather than a dead thread. -->
      <div v-if="loadErrorState.kind === 'empty'" class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <div class="rounded-lg border border-app-error/30 bg-app-error/10 px-3.5 py-2.5 text-[13px] text-app-error">{{ loadErrorState.message }}</div>
        <button
          class="h-9 cursor-pointer rounded-lg border-0 bg-app-accent px-4 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-40"
          :disabled="gw.loadingMessages.value || !selectedSessionId"
          @click="refreshMessages"
        >{{ gw.loadingMessages.value ? 'Retrying…' : 'Retry' }}</button>
      </div>

      <div v-if="loadErrorState.kind === 'inline'" class="flex items-center justify-between gap-3 rounded-lg border border-app-error/30 bg-app-error/10 px-3 py-2 text-[13px] text-app-error">
        <span class="min-w-0 flex-1">{{ loadErrorState.message }}</span>
        <button
          class="shrink-0 cursor-pointer rounded-md border border-app-error/30 bg-transparent px-2.5 py-1 text-xs font-semibold text-app-error transition-colors hover:border-app-error/50 hover:bg-app-error/15 disabled:cursor-default disabled:opacity-40"
          :disabled="gw.loadingMessages.value || !selectedSessionId"
          @click="refreshMessages"
        >{{ gw.loadingMessages.value ? 'Retrying…' : 'Retry' }}</button>
      </div>

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
        <div v-if="processNoteFor(msg)" class="flex max-w-[min(86%,44rem)] flex-col gap-0.5 self-center px-2 py-0.5 text-[11px] leading-5 text-app-muted/60">
          <span class="flex items-center gap-1.5">
            <Terminal class="shrink-0 text-app-muted/55" :size="12" :stroke-width="2" />
            <span class="break-words">{{ processNoteFor(msg)?.headline }}</span>
          </span>
          <details v-if="processNoteFor(msg)?.detail" class="pl-[21px]">
            <summary class="cursor-pointer select-none text-app-muted/45 hover:text-app-muted/70">output</summary>
            <pre class="mt-0.5 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-4 text-app-muted/55">{{ processNoteFor(msg)?.detail }}</pre>
          </details>
        </div>

        <div
          v-else
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
            <details v-if="msg.role === 'tool'" :open="activityHasDiff(msg)" class="my-1 w-full overflow-hidden rounded-lg border border-app-border bg-[color-mix(in_srgb,var(--surface)_88%,var(--accent))] [&>summary]:flex [&>summary]:cursor-pointer [&>summary]:items-center [&>summary]:gap-1.5 [&>summary]:bg-app-surface-2 [&>summary]:px-3 [&>summary]:py-2.5 [&>summary]:text-xs [&>summary]:font-medium [&>summary]:text-app-muted">
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
              <details v-if="fileActivitySummary(msg)" class="border-t border-app-border [&>summary]:cursor-pointer [&>summary]:bg-app-surface/60 [&>summary]:px-2.5 [&>summary]:py-1.5 [&>summary]:text-xs [&>summary]:text-app-muted">
                <summary class="flex items-center gap-1.5"><FileText :size="13" :stroke-width="1.8" />{{ fileActivitySummary(msg)!.label }}</summary>
                <ul class="m-0 list-none px-2.5 pb-2.5 pt-1 font-mono text-[11px] leading-5 text-app-muted">
                  <li v-for="path in fileActivitySummary(msg)!.paths" :key="path" class="truncate">{{ path }}</li>
                </ul>
              </details>
              <template v-if="toolResults(msg).length === 1">
                <div v-if="toolDiffFromResult(toolResults(msg)[0])" class="" aria-label="Diff view">
                  <div class="px-2.5 pt-1.5 pb-[3px] text-[11px] font-semibold uppercase tracking-[.04em] text-app-muted">Diff</div>
                  <PatchDiff :patch="toolDiffFromResult(toolResults(msg)[0])!" />
                </div>
                <pre v-else-if="toolResults(msg)[0].content" class="m-0 max-h-40 overflow-auto border-t border-app-border bg-app-bg p-2.5 font-mono text-[11px] leading-[1.5] whitespace-pre-wrap break-words text-[#b9bbc8]">{{ toolResults(msg)[0].content }}</pre>
              </template>
              <div v-else class="border-t border-app-border">
                <details v-for="tool in toolResults(msg)" :key="tool.id" :open="Boolean(toolDiffFromResult(tool))" class="border-b border-app-border last:border-b-0 [&>summary]:cursor-pointer [&>summary]:bg-app-surface/60 [&>summary]:px-2.5 [&>summary]:py-1.5 [&>summary]:text-xs [&>summary]:text-app-muted">
                  <summary>{{ tool.name }}</summary>
                  <div v-if="toolDiffFromResult(tool)" class="" aria-label="Diff view">
                    <div class="px-2.5 pt-1.5 pb-[3px] text-[11px] font-semibold uppercase tracking-[.04em] text-app-muted">Diff</div>
                    <PatchDiff :patch="toolDiffFromResult(tool)!" />
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
                <CircleAlert :size="14" :stroke-width="2" />
                <span class="text-[13px] leading-[1.4]">{{ msg.content || 'Failed to send' }}</span>
                <button class="ml-auto cursor-pointer rounded-[5px] border border-app-error/25 bg-transparent px-2 py-1 text-xs font-semibold text-app-error hover:not-disabled:border-app-error/40 hover:not-disabled:bg-app-error/15 hover:not-disabled:text-white disabled:cursor-default disabled:opacity-50" :disabled="sending" @click.stop="retryFailed(idx)">Retry</button>
                <button class="cursor-pointer border-0 bg-transparent px-0 py-1 text-xs text-app-muted hover:text-app-text" @click.stop="dismissFailed(idx)" aria-label="Dismiss error">Dismiss</button>
              </div>

              <!-- Streaming thinking indicator -->
              <div v-else-if="msg.role === 'assistant' && isThinking(msg.content)" class="flex items-center gap-1 py-0.5">
                <span class="size-[5px] rounded-full bg-app-accent"></span>
                <span class="size-[5px] rounded-full bg-app-accent"></span>
                <span class="size-[5px] rounded-full bg-app-accent"></span>
                <span class="ml-1 text-xs tabular-nums text-app-muted">Thinking<span v-if="elapsedDisplay"> · {{ elapsedDisplay }}</span><span v-else>…</span></span>
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
                    <img class="size-full object-cover" loading="lazy" decoding="async" :src="imageAttachmentSrc(msg, attachment, attachmentIdx)" :alt="attachment.label" />
                  </button>
                  <span
                    v-else-if="attachment.gatewayPath"
                    :ref="el => observeGatewayImage(msg, attachment, attachmentIdx, el)"
                    class="inline-flex min-h-7 items-center gap-1 rounded-[7px] border border-app-border px-2.5 text-xs text-app-muted"
                  ><FileImage :size="14" :stroke-width="2" /> Loading {{ attachment.label }}…</span>
                  <span v-else class="inline-flex min-h-7 items-center gap-1 rounded-[7px] border border-app-border px-2.5 text-xs text-app-muted"><FileImage :size="14" :stroke-width="2" /> {{ attachment.label }}</span>
                </template>
              </div>

              <!-- Rendered markdown content -->
              <div
                v-if="msg.content"
                class="md-content"
                :class="isExpandableUserMessage(msg) && !isMessageExpanded(msg, idx) ? 'max-h-[6.5rem] overflow-hidden' : ''"
                v-html="searchQuery.trim() && isMatch(idx) ? highlightText(msg.content, searchQuery) : render(msg.content)"
              ></div>
              <button
                v-if="isExpandableUserMessage(msg)"
                type="button"
                class="mt-1 cursor-pointer border-0 bg-transparent px-0 text-xs font-medium text-app-accent hover:text-app-accent-hover"
                :aria-expanded="isMessageExpanded(msg, idx)"
                @click.stop="toggleMessageExpansion(msg, idx)"
              >
                {{ isMessageExpanded(msg, idx) ? 'Show less' : 'Show more' }}
              </button>

              <!-- Desktop keeps a response-loading indicator in the assistant
                   bubble itself. On mobile, include the authoritative turn timer
                   here as well so it remains visible when the composer is offscreen. -->
              <div v-if="msg.role === 'assistant' && !msg.content && !msg.reasoning && !msg.toolCalls?.length" class="flex items-center gap-1.5 py-1">
                <span class="size-[5px] rounded-full bg-app-accent"></span>
                <span class="size-[5px] rounded-full bg-app-accent"></span>
                <span class="size-[5px] rounded-full bg-app-accent"></span>
                <span v-if="sending && idx === gw.messages.value.length - 1" class="ml-1 text-xs tabular-nums text-app-muted">Thinking<span v-if="elapsedDisplay"> · {{ elapsedDisplay }}</span><span v-else>…</span></span>
              </div>

              <!-- Fresh gateway frames mean the agent may simply be using a tool;
                   reserve the stronger warning for a quiet transport as well. -->
              <div
                v-if="msg.role === 'assistant' && (streamQuiet || streamStalled) && idx === gw.messages.value.length - 1 && !msg.error && !isThinking(msg.content) && Boolean(msg.content || msg.reasoning || msg.toolCalls?.length)"
                class="mt-1 flex items-center gap-1.5 text-xs text-app-muted"
                role="status"
                aria-live="polite"
              >
                <span class="size-[5px] animate-pulse rounded-full bg-app-accent"></span>
                <span>{{ streamQuiet ? 'Working quietly' : 'Stream is quiet' }}<span v-if="elapsedDisplay"> · {{ elapsedDisplay }}</span>…</span>
              </div>
            </template>
          </template>
        </div>

        <div v-if="!isActivityMessage(msg) && !processNoteFor(msg) && !msg.interim" class="flex items-center gap-2 px-1" :class="msg.role === 'user' ? 'self-end' : 'self-start'">
          <span v-if="msg.timestamp" class="text-[11px] text-app-muted">{{ formatTime(msg.timestamp) }}</span>
          <button
            v-if="canRestoreMessage(msg, idx)"
            class="flex cursor-pointer items-center justify-center rounded border-0 bg-transparent px-1 py-0.5 text-app-muted opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100"
            aria-label="Restore from here"
            title="Restore from here"
            @click.stop="restoreMessageAt(idx)"
          >
            <History :size="14" :stroke-width="2" />
          </button>
          <button
            class="flex cursor-pointer items-center justify-center rounded border-0 bg-transparent px-1 py-0.5 text-app-muted opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100"
            @click.stop="openActionSheet(idx)"
            title="Actions"
          >
            <EllipsisVertical :size="14" :stroke-width="2" />
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
      <button v-if="showJumpToBottom" class="absolute right-4 z-10 flex size-9 cursor-pointer items-center justify-center rounded-full border border-app-border bg-app-surface text-app-muted shadow-[0_2px_8px_rgba(0,0,0,0.3)] transition-all hover:border-app-accent hover:bg-app-surface-2 hover:text-app-accent active:scale-90" :style="{ bottom: `${jumpToBottomOffset(composerHeight)}px` }" @click="scrollToBottom" aria-label="Scroll to bottom">
        <ArrowDown :size="16" :stroke-width="2.5" />
      </button>
    </Transition>

    <div ref="composerEl" class="shrink-0">
      <div v-if="isViewingOfflineTranscript" class="border-t border-app-border bg-app-surface px-3 py-3 text-center text-[13px] text-app-muted">Sending is unavailable while viewing cached history.</div>
      <template v-else>
      <!-- Clarification prompt -->
    <div v-if="activeClarifyRequest" class="shrink-0 border-t border-app-border bg-app-surface px-3 py-2.5">
      <div class="rounded-lg border border-app-accent/30 bg-app-accent/10 p-2.5">
        <div class="mb-2 text-[13px] font-medium text-app-text">{{ activeClarifyRequest.question }}</div>
        <div v-if="activeClarifyRequest.choices?.length" class="mb-2 flex flex-wrap gap-1.5">
          <button
            v-for="choice in activeClarifyRequest.choices"
            :key="choice"
            class="cursor-pointer rounded-md border border-app-accent/35 bg-app-surface px-2.5 py-1.5 text-xs text-app-text transition-colors hover:bg-app-accent/15 disabled:cursor-default disabled:opacity-50"
            :disabled="clarifying"
            @click="submitClarify(choice)"
          >{{ choice }}</button>
        </div>
        <div class="flex items-end gap-2">
          <textarea
            v-model="clarifyDraft"
            rows="1"
            class="min-h-9 min-w-0 flex-1 resize-none rounded-md border border-app-border bg-app-bg px-2.5 py-2 text-[13px] text-app-text outline-none placeholder:text-app-muted focus:border-app-accent"
            placeholder="Or type an answer…"
            :disabled="clarifying"
            @keydown="handleClarifyKeydown"
          ></textarea>
          <button
            class="h-9 shrink-0 cursor-pointer rounded-md border-0 bg-app-accent px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-40"
            :disabled="clarifying || !clarifyDraft.trim()"
            @click="submitClarify(clarifyDraft)"
          >{{ clarifying ? 'Sending…' : 'Answer' }}</button>
        </div>
      </div>
    </div>

    <!-- Input -->
    <div class="relative flex shrink-0 flex-col border-t border-app-border bg-app-surface px-3 py-2 pb-[max(8px,env(safe-area-inset-bottom))]">
      <div v-if="pendingAttachments.length" class="mb-2 flex flex-wrap items-center gap-1.5">
        <div
          v-for="attachment in pendingAttachments"
          :key="attachment.id"
          class="flex max-w-full items-center gap-1.5 rounded-md border border-app-border bg-app-surface-2 px-2 py-1 text-xs text-app-muted"
        >
          <img v-if="attachment.kind === 'image'" class="size-6 rounded object-cover" :src="attachment.dataUrl" :alt="attachment.name" />
          <FileText v-else :size="14" :stroke-width="2" />
          <span class="max-w-40 truncate">{{ attachment.name }}</span>
          <span class="shrink-0 text-[10px] opacity-60">{{ formatAttachmentSize(attachment.size) }}</span>
          <button class="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-app-muted hover:text-app-error" type="button" :aria-label="`Remove ${attachment.name}`" @click="removePendingAttachment(attachment.id)"><X :size="13" :stroke-width="2" /></button>
        </div>
        <span class="text-[10px] text-app-muted">{{ pendingAttachments.length }}/{{ MAX_ATTACHMENTS }}</span>
      </div>
      <div v-if="queuedMessages.length" class="mb-2 rounded-lg border border-app-border bg-app-surface-2/70 px-2.5 py-2">
        <div class="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-app-muted">
          <span>{{ queuedMessages.length }} queued {{ queuedMessages.length === 1 ? 'message' : 'messages' }}<span v-if="queuePaused"> · paused</span></span>
          <button v-if="queuePaused && !sending" class="ml-auto cursor-pointer border-0 bg-transparent px-1 text-app-accent hover:text-app-accent-hover" type="button" @click="resumeQueue">Resume</button>
          <button class="cursor-pointer border-0 bg-transparent px-1 text-app-muted hover:text-app-error" type="button" @click="clearCurrentQueue">Clear</button>
        </div>
        <div v-for="entry in queuedMessages" :key="entry.id" class="flex min-w-0 items-center gap-2 border-t border-app-border/60 py-1.5 first:border-t-0">
          <span class="min-w-0 flex-1 line-clamp-2 text-xs leading-[1.35] text-app-text">{{ entry.text }}</span>
          <button class="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-app-muted hover:text-app-error" type="button" :aria-label="`Remove queued message: ${entry.text}`" @click="removeQueued(entry.id)"><X :size="14" :stroke-width="2" /></button>
        </div>
      </div>
      <div v-if="sending && elapsedDisplay" class="absolute left-3.5 bottom-full mb-1.5 flex items-center gap-1.5 rounded-md border border-app-border bg-app-surface-2 px-2.5 py-1">
        <span class="size-1.5 rounded-full bg-app-accent"></span>
        <span class="text-xs tabular-nums text-app-muted">{{ elapsedDisplay }}</span>
      </div>
      <div v-if="sending" class="flex flex-col gap-2">
        <div class="flex min-w-0 items-end gap-2">
          <textarea
            ref="inputEl"
            v-model="input"
            placeholder="Steer the current run…"
            rows="1"
            @keydown="handleKeydown"
            @input="autoResize"
            class="min-h-9 max-h-32 min-w-0 flex-1 resize-none rounded-[10px] border border-app-border bg-app-bg px-3 py-2 text-sm leading-5 text-app-text outline-none transition-colors placeholder:text-app-muted focus:border-app-accent"
          ></textarea>
          <button
            v-if="input.trim()"
            class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-[10px] border border-app-border bg-transparent text-app-muted transition-colors hover:border-app-accent hover:bg-app-accent/10 hover:text-app-accent"
            aria-label="Queue message"
            title="Queue message"
            @click="queueCurrentMessage(input.trim())"
          >
            <Layers3 :size="18" :stroke-width="2" />
          </button>
          <button
            class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-[10px] border-0 bg-app-accent text-white transition-colors hover:not-disabled:bg-app-accent-hover disabled:cursor-default disabled:opacity-40"
            :disabled="!input.trim() || steering"
            aria-label="Steer current run"
            title="Steer current run"
            @click="handleSend"
          >
            <Compass :size="18" :stroke-width="2" />
          </button>
        </div>
        <button class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-app-error/30 bg-app-error/[.08] px-5 py-2.5 text-[13px] font-medium text-app-error transition-all hover:border-app-error/50 hover:bg-app-error/15 active:scale-[.98]" @click="handleStop">
          <Square :size="16" fill="currentColor" :stroke-width="2" />
          <span>Stop generating</span>
        </button>
      </div>
      <template v-else>
        <input ref="fileInputEl" class="hidden" type="file" multiple @change="handleAttachmentPick" />
        <div class="flex min-w-0 items-end gap-2">
          <button
            class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-[10px] border border-app-border bg-transparent text-app-muted transition-colors hover:border-app-accent hover:bg-app-accent/10 hover:text-app-accent disabled:cursor-default disabled:opacity-40"
            type="button"
            :disabled="pendingAttachments.length >= MAX_ATTACHMENTS"
            aria-label="Attach files"
            title="Attach files"
            @click="openAttachmentPicker"
          >
            <Paperclip :size="18" :stroke-width="2" />
          </button>
          <textarea
            ref="inputEl"
            v-model="input"
            placeholder="Message…"
            rows="1"
            @keydown="handleKeydown"
            @input="autoResize"
            class="min-h-9 max-h-32 min-w-0 flex-1 resize-none rounded-[10px] border border-app-border bg-app-bg px-3 py-2 text-sm leading-5 text-app-text outline-none transition-colors placeholder:text-app-muted focus:border-app-accent"
          ></textarea>
          <button
            class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-[10px] border-0 bg-app-accent text-white transition-colors hover:not-disabled:bg-app-accent-hover disabled:cursor-default disabled:opacity-40"
            :disabled="!input.trim() && pendingAttachments.length === 0"
            @click="handleSend"
          >
            <Send :size="18" :stroke-width="2" />
          </button>
        </div>
      </template>
    </div>
      </template>
    </div>

    <!-- Session Picker -->
    <Teleport to="body">
      <div v-if="sessionPickerOpen" class="fixed inset-0 z-[1100] flex items-end justify-center bg-black/50" @click="closeSessionPicker">
        <div class="flex max-h-[78vh] w-full max-w-[400px] flex-col overflow-hidden rounded-t-2xl border border-b-0 border-app-border bg-app-surface animate-[slideUp_.2s_ease]" @click.stop>
          <div class="flex items-center justify-between border-b border-app-border px-4 py-3.5">
            <span class="text-[15px] font-semibold tracking-[-0.02em]">Switch session</span>
            <button class="flex cursor-pointer items-center justify-center rounded-md border-0 bg-transparent px-2 py-1 text-app-muted transition-colors hover:text-app-error" type="button" @click="closeSessionPicker" aria-label="Close session picker"><X :size="16" :stroke-width="2" /></button>
          </div>
          <div class="shrink-0 border-b border-app-border px-3 py-2.5">
            <input
              ref="sessionPickerInputEl"
              v-model="sessionPickerQuery"
              type="search"
              class="h-9 w-full rounded-md border border-app-border bg-app-surface-2 px-2.5 text-[13px] outline-none transition-colors placeholder:text-app-muted focus:border-app-accent"
              placeholder="Search sessions…"
              aria-label="Search sessions"
              :aria-activedescendant="sessionPickerSessions.length > 0 ? sessionPickerOptionId(sessionPickerSessions[sessionPickerActiveIndex].id) : undefined"
              @keydown="handleSessionPickerKeydown"
            />
          </div>
          <div v-if="sessionPickerLoading && sessionPickerSessions.length === 0" class="flex items-center justify-center gap-2 px-4 py-8 text-[13px] text-app-muted">
            <span class="inline-block size-3.5 animate-spin rounded-full border-2 border-app-border border-t-app-accent" />
            <span>Loading sessions…</span>
          </div>
          <div v-else-if="sessionPickerSessions.length === 0" class="flex items-center justify-center px-4 py-8 text-[13px] text-app-muted">
            {{ sessionPickerQuery ? 'No matching sessions' : 'No sessions available' }}
          </div>
          <div v-else class="overflow-y-auto overscroll-contain p-2" role="listbox" aria-label="Sessions">
            <button
              v-for="(session, index) in sessionPickerSessions"
              :id="sessionPickerOptionId(session.id)"
              :key="session.id"
              class="flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-3 py-2.5 text-left transition-colors hover:bg-app-surface-2"
              :class="{
                'bg-app-accent/10 text-app-accent': session.id === selectedSessionId,
                'bg-app-surface-2': index === sessionPickerActiveIndex,
              }"
              type="button"
              role="option"
              :aria-selected="index === sessionPickerActiveIndex"
              @mouseenter="sessionPickerActiveIndex = index"
              @click="selectSessionFromPicker(session.id)"
            >
              <MessageCircle class="shrink-0 text-app-muted" :size="16" :stroke-width="1.8" />
              <span class="flex min-w-0 flex-1 flex-col gap-0.5 leading-snug">
                <span class="truncate text-[13px] font-medium">{{ sessionListTitle(session) }}</span>
                <span class="truncate text-xs text-app-muted">{{ sessionPreview(session) }}</span>
              </span>
              <Check v-if="session.id === selectedSessionId" class="shrink-0 text-app-accent" :size="16" :stroke-width="2.5" />
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Context usage -->
    <Teleport to="body">
      <div v-if="contextUsageOpen" class="fixed inset-0 z-[1050] flex items-end justify-center bg-black/50" @click="closeContextUsage">
        <div class="flex max-h-[72vh] w-full max-w-[400px] flex-col overflow-hidden rounded-t-2xl border border-b-0 border-app-border bg-app-surface" @click.stop>
          <div class="flex items-center justify-between border-b border-app-border px-4 py-3.5">
            <div class="min-w-0">
              <div class="text-[15px] font-semibold tracking-[-0.02em]">Context usage</div>
              <div v-if="contextUsageData?.model" class="truncate text-[11px] text-app-muted">{{ gw.modelShort(contextUsageData.model) }}</div>
            </div>
            <button class="flex cursor-pointer items-center justify-center rounded-md border-0 bg-transparent px-2 py-1 text-app-muted transition-colors hover:text-app-error" type="button" @click="closeContextUsage" aria-label="Close context usage"><X :size="16" :stroke-width="2" /></button>
          </div>
          <div v-if="contextUsageLoading" class="flex items-center justify-center gap-2 px-4 py-8 text-[13px] text-app-muted">
            <span class="inline-block size-3.5 animate-spin rounded-full border-2 border-app-border border-t-app-accent" />
            <span>Loading token usage…</span>
          </div>
          <div v-else-if="contextUsageData" class="flex flex-col gap-4 overflow-y-auto p-4">
            <div class="flex items-baseline justify-between gap-3">
              <span class="text-[13px] text-app-muted">Context window</span>
              <span class="text-sm font-semibold tabular-nums text-app-text">
                {{ compactTokenCount(contextUsageData.contextUsed) }}<span v-if="contextUsageData.contextMax"> / {{ compactTokenCount(contextUsageData.contextMax) }}</span> tokens
              </span>
            </div>
            <div class="flex flex-col gap-1.5">
              <div class="h-2 overflow-hidden rounded-full bg-app-surface-3">
                <div class="h-full rounded-full bg-app-accent transition-[width]" :style="{ width: `${getContextUsagePercent(contextUsageData)}%` }" />
              </div>
              <div class="flex justify-between text-[11px] text-app-muted">
                <span>{{ contextUsagePercentLabel }}</span>
                <span v-if="contextUsageData.estimatedTotal">~{{ compactTokenCount(contextUsageData.estimatedTotal) }} estimated total</span>
              </div>
            </div>
            <ul v-if="contextUsageData.categories.length" class="flex flex-col gap-2 border-t border-app-border pt-3">
              <li v-for="category in contextUsageData.categories" :key="category.id" class="flex items-center justify-between gap-2 text-xs">
                <span class="flex min-w-0 items-center gap-2 text-app-muted"><span class="size-2 shrink-0 rounded-[2px]" :style="{ background: category.color }" /><span class="truncate">{{ category.label }}</span></span>
                <span class="shrink-0 tabular-nums text-app-text">{{ compactTokenCount(category.tokens) }}</span>
              </li>
            </ul>
            <div v-else class="text-[11px] text-app-muted">No context breakdown was returned.</div>
          </div>
          <div v-else class="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <span class="text-[13px] text-app-muted">{{ contextUsageError || 'Context usage is unavailable.' }}</span>
            <button class="h-9 cursor-pointer rounded-lg border border-app-border bg-transparent px-4 text-[13px] font-medium text-app-text transition-colors hover:border-app-accent hover:bg-app-accent/10" type="button" @click="retryContextUsage">Retry</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Model Picker Dropdown -->
    <Teleport to="body">
      <div v-if="modelPickerOpen" class="fixed inset-0 z-[1000] flex items-end justify-center bg-black/50" @click="closeModelPicker">
        <div class="flex max-h-[70vh] w-full max-w-[400px] flex-col overflow-hidden rounded-t-2xl border border-b-0 border-app-border bg-app-surface animate-[slideUp_.2s_ease]" @click.stop>
          <div class="flex items-center justify-between border-b border-app-border px-4 py-3.5">
            <span class="text-[15px] font-semibold tracking-[-0.02em]">Switch model</span>
            <button class="flex cursor-pointer items-center justify-center rounded-md border-0 bg-transparent px-2 py-1 text-app-muted transition-colors hover:text-app-error" @click="closeModelPicker" aria-label="Close model picker"><X :size="16" :stroke-width="2" /></button>
          </div>
          <div v-if="modelLoading" class="flex items-center justify-center gap-2 px-4 py-8 text-[13px] text-app-muted">
            <span class="inline-block size-3.5 animate-spin rounded-full border-2 border-app-border border-t-app-accent" />
            <span>Loading models…</span>
          </div>
          <div v-else-if="modelProviders.length === 0" class="flex items-center justify-center gap-2 px-4 py-8 text-[13px] text-app-muted">
            No models available
          </div>
          <div v-else class="overflow-y-auto overscroll-contain py-2">
            <div v-if="favouriteModelOptions.length" class="px-2 pb-2">
              <div class="px-2 py-1.5 pb-1 text-[11px] font-semibold uppercase tracking-[.05em] text-app-muted">Favourites</div>
              <div v-for="option in favouriteModelOptions" :key="`favourite-${option.provider}-${option.model}`" class="flex items-center gap-1 rounded-lg px-1 transition-colors hover:bg-app-surface-2">
                <button class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent px-2 py-2.5 text-left text-[13px] text-app-text disabled:cursor-wait disabled:opacity-60" :disabled="switchingModel" @click="selectModel(option.provider, option.model)">
                  <span class="min-w-0 flex-1 truncate">{{ gw.modelShort(option.model) }}</span>
                  <span class="shrink-0 text-[11px] text-app-muted">{{ option.providerName }}</span>
                  <Check v-if="option.model === currentModel && option.provider === currentProvider" :size="16" :stroke-width="2.5" class="shrink-0 text-app-accent" />
                </button>
                <button class="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-app-accent hover:bg-app-surface-3 disabled:cursor-wait disabled:opacity-50" :disabled="switchingModel" :aria-label="`Remove ${option.model} from favourites`" @click="toggleModelFavourite(option.provider, option.model)"><Star :size="16" :stroke-width="2" fill="currentColor" /></button>
              </div>
            </div>
            <div v-if="recentModelOptions.length" class="border-t border-app-border px-2 py-2">
              <div class="px-2 py-1.5 pb-1 text-[11px] font-semibold uppercase tracking-[.05em] text-app-muted">Recent</div>
              <div v-for="option in recentModelOptions" :key="`recent-${option.provider}-${option.model}`" class="flex items-center gap-1 rounded-lg px-1 transition-colors hover:bg-app-surface-2">
                <button class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent px-2 py-2.5 text-left text-[13px] text-app-text disabled:cursor-wait disabled:opacity-60" :disabled="switchingModel" @click="selectModel(option.provider, option.model)">
                  <span class="min-w-0 flex-1 truncate">{{ gw.modelShort(option.model) }}</span>
                  <span class="shrink-0 text-[11px] text-app-muted">{{ option.providerName }}</span>
                  <Check v-if="option.model === currentModel && option.provider === currentProvider" :size="16" :stroke-width="2.5" class="shrink-0 text-app-accent" />
                </button>
              </div>
            </div>
            <template v-for="provider in modelProviders" :key="provider.slug">
              <div class="border-t border-app-border px-2 py-2">
                <div class="px-2 py-1.5 pb-1 text-[11px] font-semibold uppercase tracking-[.05em] text-app-muted">{{ provider.name }}</div>
                <div v-for="model in provider.models" :key="model" class="flex items-center gap-1 rounded-lg px-1 transition-colors hover:bg-app-surface-2">
                  <button class="flex min-w-0 flex-1 cursor-pointer items-center justify-between border-0 bg-transparent px-2 py-2.5 text-left text-[13px] text-app-text disabled:cursor-wait disabled:opacity-60" :disabled="switchingModel" @click="selectModel(provider.slug, model)">
                    <span class="flex-1 truncate">{{ gw.modelShort(model) }}</span>
                    <Check v-if="model === currentModel && provider.slug === currentProvider" :size="16" :stroke-width="2.5" class="ml-2 shrink-0 text-app-accent" />
                  </button>
                  <button class="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-app-muted transition-colors hover:bg-app-surface-3 hover:text-app-accent disabled:cursor-wait disabled:opacity-50" :class="isFavouriteModel(provider.slug, model) ? 'text-app-accent' : ''" :disabled="switchingModel" :aria-label="`${isFavouriteModel(provider.slug, model) ? 'Remove' : 'Add'} ${model} ${isFavouriteModel(provider.slug, model) ? 'from' : 'to'} favourites`" @click="toggleModelFavourite(provider.slug, model)"><Star :size="16" :stroke-width="2" :fill="isFavouriteModel(provider.slug, model) ? 'currentColor' : 'none'" /></button>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Image preview -->
    <Teleport to="body">
      <Transition name="image-preview-fade">
        <div v-if="imagePreview" class="fixed inset-0 z-[2100] flex flex-col bg-black/[.82] p-6 pt-[max(24px,env(safe-area-inset-top,0px))] pb-[max(24px,env(safe-area-inset-bottom,0px))]" @click="closeImagePreview">
          <button class="absolute top-[max(12px,env(safe-area-inset-top,0px))] right-3 z-10 flex size-9 cursor-pointer items-center justify-center rounded-full border border-app-border bg-app-surface text-app-text" aria-label="Close image preview" @click.stop="closeImagePreview"><X :size="18" :stroke-width="2" /></button>
          <div
            class="relative flex min-h-0 min-w-0 flex-1 touch-none select-none items-center justify-center overflow-hidden"
            @click.stop
            @pointerdown.stop="handleImagePreviewPointerDown"
            @pointermove.stop="handleImagePreviewPointerMove"
            @pointerup.stop="handleImagePreviewPointerEnd"
            @pointercancel.stop="handleImagePreviewPointerEnd"
            @wheel.prevent.stop="handleImagePreviewWheel"
          >
            <div class="origin-center" :style="imagePreviewStyle">
              <img class="block max-h-full max-w-full cursor-grab rounded-lg object-contain" :src="imagePreview.src" :alt="imagePreview.alt" @click.stop />
            </div>
          </div>
          <div class="flex shrink-0 items-center justify-center gap-1 pt-3">
            <button class="flex size-9 cursor-pointer items-center justify-center rounded-full border border-app-border bg-app-surface text-app-muted transition-colors hover:bg-app-surface-2 hover:text-app-text" aria-label="Zoom out" title="Zoom out" @click.stop="zoomImagePreview(1 / 1.25)"><ZoomOut :size="17" :stroke-width="2" /></button>
            <button class="flex size-9 cursor-pointer items-center justify-center rounded-full border border-app-border bg-app-surface text-app-muted transition-colors hover:bg-app-surface-2 hover:text-app-text" aria-label="Reset image zoom" title="Reset zoom" @click.stop="resetImagePreview"><RefreshCw :size="16" :stroke-width="2" /></button>
            <button class="flex size-9 cursor-pointer items-center justify-center rounded-full border border-app-border bg-app-surface text-app-muted transition-colors hover:bg-app-surface-2 hover:text-app-text" aria-label="Zoom in" title="Zoom in" @click.stop="zoomImagePreview(1.25)"><ZoomIn :size="17" :stroke-width="2" /></button>
          </div>
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
                <Copy :size="18" :stroke-width="2" />
                <span>Copy text</span>
              </button>
              <button
                v-if="actionSheetMsg?.role === 'assistant' && actionSheetMsg?.content"
                class="flex w-full cursor-pointer items-center gap-3 rounded-[10px] border-0 bg-transparent px-3.5 py-3 text-left text-[15px] text-app-text transition-colors hover:bg-app-surface-2 active:bg-app-surface-3" @click="actionReadAloud">
                <VolumeX v-if="actionSheetIsSpeaking" :size="18" :stroke-width="2" />
                <Volume2 v-else :size="18" :stroke-width="2" />
                <span>{{ actionSheetIsSpeaking ? 'Stop reading' : 'Read aloud' }}</span>
              </button>
              <button
                v-if="actionSheetMsg?.role === 'user' && !sending && editingIdx === null && !actionSheetMsg?.error"
                class="flex w-full cursor-pointer items-center gap-3 rounded-[10px] border-0 bg-transparent px-3.5 py-3 text-left text-[15px] text-app-text transition-colors hover:bg-app-surface-2 active:bg-app-surface-3"
                @click="actionEdit"
              >
                <Pencil :size="18" :stroke-width="2" />
                <span>Edit message</span>
              </button>
              <button
                v-if="actionSheetMsg?.error && !sending"
                class="flex w-full cursor-pointer items-center gap-3 rounded-[10px] border-0 bg-transparent px-3.5 py-3 text-left text-[15px] text-app-text transition-colors hover:bg-app-surface-2 active:bg-app-surface-3"
                @click="actionRetry"
              >
                <RotateCcw :size="18" :stroke-width="2" />
                <span>Retry</span>
              </button>
              <button
                v-if="actionSheetMsg?.error"
                class="flex w-full cursor-pointer items-center gap-3 rounded-[10px] border-0 bg-transparent px-3.5 py-3 text-left text-[15px] text-app-text transition-colors hover:bg-app-surface-2 active:bg-app-surface-3"
                @click="actionDismissError"
              >
                <X :size="18" :stroke-width="2" />
                <span>Dismiss error</span>
              </button>
              <button
                v-if="actionSheetIsLastAssistant && !sending && actionSheetMsg?.content"
                class="flex w-full cursor-pointer items-center gap-3 rounded-[10px] border-0 bg-transparent px-3.5 py-3 text-left text-[15px] text-app-text transition-colors hover:bg-app-surface-2 active:bg-app-surface-3"
                @click="actionRegenerate"
              >
                <RotateCcw :size="18" :stroke-width="2" />
                <span>Regenerate</span>
              </button>
              <button
                v-if="actionSheetMsg?.role === 'assistant' && !sending && actionSheetMsg?.content"
                class="flex w-full cursor-pointer items-center gap-3 rounded-[10px] border-0 bg-transparent px-3.5 py-3 text-left text-[15px] text-app-text transition-colors hover:bg-app-surface-2 active:bg-app-surface-3"
                @click="actionBranch"
              >
                <GitFork :size="18" :stroke-width="2" />
                <span>Branch into new chat</span>
              </button>
              <button
                v-if="actionSheetMsg?.content && hasShareApi"
                class="flex w-full cursor-pointer items-center gap-3 rounded-[10px] border-0 bg-transparent px-3.5 py-3 text-left text-[15px] text-app-text transition-colors hover:bg-app-surface-2 active:bg-app-surface-3"
                @click="actionShare"
              >
                <Share :size="18" :stroke-width="2" />
                <span>Share</span>
              </button>
              <button
                v-if="actionSheetMsg?.role === 'user' && !sending && selectedSessionId"
                class="flex w-full cursor-pointer items-center gap-3 rounded-[10px] border-0 bg-transparent px-3.5 py-3 text-left text-[15px] text-app-text transition-colors hover:bg-app-surface-2 active:bg-app-surface-3 danger"
                @click="actionRestore"
              >
                <History :size="18" :stroke-width="2" />
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
