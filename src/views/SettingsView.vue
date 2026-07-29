<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { useGateway } from '../composables/useGateway'
import { Power } from '@lucide/vue'

const router = useRouter()
const auth = useAuth()
const gw = useGateway()

const host = computed(() => {
  try {
    return new URL(auth.gatewayUrl.value).host
  } catch {
    return auth.gatewayUrl.value || 'Not connected'
  }
})

async function disconnect() {
  gw.disconnectWs()
  await auth.clearSession()
  router.replace({ name: 'connect' })
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto bg-app-bg px-4 py-5 font-sans text-app-text">
    <div class="mb-5">
      <h1 class="text-[20px] font-semibold tracking-[-0.03em]">Settings</h1>
      <p class="mt-1 text-[13px] text-app-muted">Connection and application preferences</p>
    </div>

    <section class="overflow-hidden rounded-app border border-app-border bg-app-surface">
      <div class="flex items-center gap-3 px-4 py-3.5">
        <span class="size-2 shrink-0 rounded-full" :class="auth.isConnected.value ? 'bg-app-success shadow-[0_0_8px_rgba(34,197,94,0.45)]' : 'bg-app-error'" />
        <div class="min-w-0 flex-1">
          <div class="text-[13px] font-medium">Gateway connection</div>
          <div class="mt-0.5 truncate text-xs text-app-muted">{{ host }}</div>
        </div>
        <span class="text-[11px] font-medium" :class="auth.isConnected.value ? 'text-app-success' : 'text-app-error'">{{ auth.isConnected.value ? 'Connected' : 'Offline' }}</span>
      </div>
      <div class="border-t border-app-border px-4 py-3">
        <button class="flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-app-error/30 bg-transparent text-[13px] font-medium text-app-error transition-colors hover:bg-app-error/10" @click="disconnect">
          <Power :size="15" :stroke-width="1.8" />
          Disconnect gateway
        </button>
      </div>
    </section>
  </div>
</template>
