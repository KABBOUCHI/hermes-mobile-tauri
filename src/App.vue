<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useAuth } from './composables/useAuth'
import { useGateway } from './composables/useGateway'
import { usePins } from './composables/usePins'

const router = useRouter()
const auth = useAuth()
const gw = useGateway()
const pins = usePins()

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
onMounted(async () => {
  document.addEventListener('click', handleGlobalClick, true)
  document.addEventListener('click', handleGlobalCopy, true)

  const bootTimer = setTimeout(() => {
    if (router.currentRoute.value.name === 'loading') {
      console.warn('[boot] stuck on loading, forcing connect view')
      router.replace({ name: 'connect' })
    }
  }, 5000)

  try {
    const ok = await auth.tryAutoLogin()
    if (ok) {
      await Promise.all([gw.fetchSessions(auth.gatewayUrl.value), pins.getPinnedIds()])
      await gw.connectWs(
        auth.gatewayUrl.value,
        auth.sessionCookie.value,
        auth.fetchWsTicket,
      )
      router.replace({ name: 'sessions' })
    } else {
      router.replace({ name: 'connect' })
    }
  } catch (err: any) {
    console.error('[boot] unexpected error:', err)
    router.replace({ name: 'connect' })
  } finally {
    clearTimeout(bootTimer)
  }
})

onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick, true)
  document.removeEventListener('click', handleGlobalCopy, true)
  gw.disconnectWs()
})
</script>

<template>
  <div class="Root">
    <!-- Loading state while boot resolves -->
    <div v-if="router.currentRoute.value.name === 'loading'" class="StateView">
      <div class="Loader" />
    </div>
    <router-view v-else />
  </div>
</template>

<style>
@import './assets/main.css';

.Root {
  background-color: var(--bg);
  height: 100%;
  height: 100dvh;
  display: flex;
  flex-direction: column;
}

.StateView {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.Loader {
  width: 28px;
  height: 28px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>
