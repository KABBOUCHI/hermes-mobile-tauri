<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useAuth } from './composables/useAuth'
import { useGateway } from './composables/useGateway'
import { usePins } from './composables/usePins'
import { useToast } from './composables/useToast'

const router = useRouter()
const auth = useAuth()
const gw = useGateway()
const pins = usePins()
const toast = useToast()

// ── Global link handler: open external links in system browser ──
function handleGlobalClick(e: Event) {
  const target = e.target as HTMLElement
  const anchor = target.closest('a') as HTMLAnchorElement | null
  if (!anchor) return

  const href = anchor.getAttribute('href')
  if (!href) return

  if (href.startsWith('http://') || href.startsWith('https://')) {
    e.preventDefault()
    e.stopPropagation()
    openUrl(href).catch(() => {
      window.open(href, '_blank')
    })
    return
  }

  if (href.startsWith('mailto:') || href.startsWith('tel:')) {
    e.preventDefault()
    e.stopPropagation()
    openUrl(href).catch(() => {})
    return
  }
}

// ── Global code copy handler (delegated) ──
function handleGlobalCopy(e: Event) {
  const target = e.target as HTMLElement
  if (!target.classList.contains('md-code-copy')) return

  e.preventDefault()
  e.stopPropagation()

  const codeWrap = target.closest('.md-code-wrap')
  if (!codeWrap) return
  const codeEl = codeWrap.querySelector('code')
  if (!codeEl) return

  const text = codeEl.textContent || ''
  navigator.clipboard.writeText(text).then(() => {
    target.textContent = 'Copied!'
    setTimeout(() => { target.textContent = 'Copy' }, 1500)
  }).catch(() => {
    const range = document.createRange()
    range.selectNodeContents(codeEl)
    const sel = window.getSelection()
    if (sel) {
      sel.removeAllRanges()
      sel.addRange(range)
      document.execCommand('copy')
      sel.removeAllRanges()
      target.textContent = 'Copied!'
      setTimeout(() => { target.textContent = 'Copy' }, 1500)
    }
  })
}

// ── Boot ───────────────────────────────────────────
let booted = false
const bootReady = ref(false)

async function boot() {
  if (booted) return
  booted = true

  try {
    const ok = await auth.tryAutoLogin()
    if (ok) {
      await Promise.all([gw.fetchSessions(auth.gatewayUrl.value), pins.getPinnedIds()])
      await gw.connectWs(
        auth.gatewayUrl.value,
        auth.sessionCookie.value,
        auth.fetchWsTicket,
      )
      // Preserve a deep link to an existing conversation. The ordinary launch
      // route is ConnectView, so only that route becomes the session list.
      if (router.currentRoute.value.name === 'connect') {
        await router.replace({ name: 'sessions' })
      }
    } else {
      await router.replace({ name: 'connect' })
    }
  } catch (err: any) {
    console.error('[boot] unexpected error:', err)
    await router.replace({ name: 'connect' })
  } finally {
    bootReady.value = true
  }
}

onMounted(() => {
  document.addEventListener('click', handleGlobalClick, true)
  document.addEventListener('click', handleGlobalCopy, true)
  boot()
})

onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick, true)
  document.removeEventListener('click', handleGlobalCopy, true)
  // Don't disconnect WS here — let it persist across route changes
})
</script>

<template>
  <div class="flex h-[var(--app-height,100dvh)] min-h-0 flex-col box-border bg-app-bg pt-[env(safe-area-inset-top,48px)] font-sans text-app-text">
    <div v-if="!bootReady" class="grid flex-1 place-content-center justify-items-center gap-2.5 bg-app-bg p-8" role="status" aria-label="Connecting to Hermes">
      <div class="text-[31px] leading-none text-app-accent">☤</div>
      <div class="text-[17px] font-semibold tracking-[-0.04em]">Hermes</div>
      <div class="h-0.5 w-28 overflow-hidden bg-app-surface-3"><span class="block h-full w-[46%] animate-[boot-progress_1.15s_ease-in-out_infinite] bg-app-accent" /></div>
      <div class="text-xs text-app-muted">Restoring your workspace…</div>
    </div>
    <router-view v-else class="AppRoute min-h-0 flex-1" />

    <!-- Toast notifications -->
    <Teleport to="body">
      <div class="fixed top-14 left-1/2 z-[9999] flex -translate-x-1/2 flex-col items-center gap-2 pointer-events-none">
        <TransitionGroup name="toast">
          <div
            v-for="t in toast.toasts.value"
            :key="t.id"
            :class="[
              'pointer-events-auto flex max-w-80 cursor-pointer items-center gap-2 rounded-[10px] px-4 py-2.5 text-center text-[13px] font-medium shadow-[0_4px_16px_rgba(0,0,0,0.4)] backdrop-blur-md',
              t.type === 'info' && 'border border-app-accent/30 bg-app-accent/15 text-app-accent',
              t.type === 'success' && 'border border-app-success/30 bg-app-success/15 text-app-success',
              t.type === 'error' && 'border border-app-error/30 bg-app-error/15 text-app-error',
            ]"
            @click="toast.dismiss(t.id)"
          >
            <span class="text-sm leading-none">{{ t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : 'ℹ' }}</span>
            <span class="leading-[1.3]">{{ t.message }}</span>
          </div>
        </TransitionGroup>
      </div>
    </Teleport>
  </div>
</template>