<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useAuth } from './composables/useAuth'
import { useGateway } from './composables/useGateway'
import { usePins } from './composables/usePins'
import { useToast } from './composables/useToast'

const router = useRouter()
const route = useRoute()
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
const showWorkspaceNav = computed(() => ['sessions', 'cron', 'settings'].includes(route.name as string))

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
    <nav v-if="bootReady && showWorkspaceNav" class="grid shrink-0 grid-cols-3 border-t border-app-border bg-app-surface px-2 pt-1 pb-[calc(env(safe-area-inset-bottom,0px)+4px)]" aria-label="Workspace navigation">
      <button class="flex min-h-12 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md border-0 bg-transparent text-[11px] transition-colors" :class="route.name === 'sessions' ? 'text-app-accent' : 'text-app-muted hover:text-app-text'" @click="router.push({ name: 'sessions' })">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h7M7 16h5"/></svg>
        Sessions
      </button>
      <button class="flex min-h-12 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md border-0 bg-transparent text-[11px] transition-colors" :class="route.name === 'cron' ? 'text-app-accent' : 'text-app-muted hover:text-app-text'" @click="router.push({ name: 'cron' })">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5M9 2h6M12 2v3"/></svg>
        Cron jobs
      </button>
      <button class="flex min-h-12 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md border-0 bg-transparent text-[11px] transition-colors" :class="route.name === 'settings' ? 'text-app-accent' : 'text-app-muted hover:text-app-text'" @click="router.push({ name: 'settings' })">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.2 2.2-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V21h-3.1v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-2.2-2.2.06-.06A1.7 1.7 0 0 0 6.82 15a1.7 1.7 0 0 0-1.55-1H5.2v-3.1h.07a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.2-2.2.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1-1.55V4.5h3.1v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.2 2.2-.06.06A1.7 1.7 0 0 0 19.4 9.9a1.7 1.7 0 0 0 1.55 1h.07V14h-.07a1.7 1.7 0 0 0-1.55 1Z"/></svg>
        Settings
      </button>
    </nav>

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