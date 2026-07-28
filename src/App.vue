<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
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
      router.replace({ name: 'sessions' })
    } else {
      router.replace({ name: 'connect' })
    }
  } catch (err: any) {
    console.error('[boot] unexpected error:', err)
    router.replace({ name: 'connect' })
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
  <div class="Root">
    <router-view />

    <!-- Toast notifications -->
    <Teleport to="body">
      <div class="ToastContainer">
        <TransitionGroup name="toast">
          <div
            v-for="t in toast.toasts.value"
            :key="t.id"
            class="Toast"
            :class="t.type"
            @click="toast.dismiss(t.id)"
          >
            <span class="ToastIcon">{{ t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : 'ℹ' }}</span>
            <span class="ToastMsg">{{ t.message }}</span>
          </div>
        </TransitionGroup>
      </div>
    </Teleport>
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
  padding-top: env(safe-area-inset-top, 48px);
}

/* ── Toast notifications ── */
.ToastContainer {
  position: fixed;
  top: 56px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}
.Toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  cursor: pointer;
  max-width: 320px;
  text-align: center;
}
.Toast.info {
  background: rgba(94, 106, 210, 0.15);
  border: 1px solid rgba(94, 106, 210, 0.3);
  color: var(--accent);
}
.Toast.success {
  background: rgba(34, 197, 94, 0.15);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: var(--success);
}
.Toast.error {
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: var(--error);
}
.ToastIcon { font-size: 14px; line-height: 1; }
.ToastMsg { line-height: 1.3; }
.toast-enter-active { animation: toast-in 0.25s ease-out; }
.toast-leave-active { animation: toast-out 0.2s ease-in; }
@keyframes toast-in { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes toast-out { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-10px); } }
</style>
