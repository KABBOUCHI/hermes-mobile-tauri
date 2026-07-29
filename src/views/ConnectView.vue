<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { useGateway } from '../composables/useGateway'
import { usePins } from '../composables/usePins'

const router = useRouter()
const auth = useAuth()
const gw = useGateway()
const pins = usePins()

const url = ref('https://hermes.kabbouchi.cloud')
const user = ref('admin')
const pass = ref('')
const showPass = ref(false)
const loading = ref(false)
const error = ref('')

const canConnect = computed(() => url.value.trim() && user.value.trim() && pass.value && !loading.value)

async function handleConnect() {
  if (!canConnect.value) return
  loading.value = true
  error.value = ''

  auth.gatewayUrl.value = url.value.trim()
  auth.username.value = user.value
  auth.password.value = pass.value

  try {
    await auth.connect()
    await Promise.all([gw.fetchSessions(auth.gatewayUrl.value), pins.getPinnedIds()])
    await gw.connectWs(
      auth.gatewayUrl.value,
      auth.sessionCookie.value,
      auth.fetchWsTicket,
    )
    router.push({ name: 'sessions' })
  } catch (err: any) {
    error.value = err.message || 'Connection failed'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen w-full max-w-[400px] mx-auto flex-col items-center bg-app-bg px-6 pt-10 text-app-text font-sans">
    <div class="w-full flex flex-col gap-6 rounded-app border border-app-border bg-app-surface px-6 py-8">
      <div class="mb-2 flex flex-col items-center gap-1.5">
        <div class="flex size-12 items-center justify-center rounded-[14px] border border-app-accent/20 bg-app-accent/10">
          <span class="text-2xl text-app-accent">☤</span>
        </div>
        <h1 class="text-[28px] font-bold tracking-[-0.03em]">Hermes</h1>
        <span class="text-sm uppercase tracking-[0.5px] text-app-muted">Remote Gateway</span>
      </div>

      <form class="flex flex-col gap-4" @submit.prevent="handleConnect">
        <div class="flex flex-col gap-1.5">
          <label class="text-[13px] font-medium tracking-[0.3px] text-app-muted">Gateway URL</label>
          <input
            v-model="url"
            type="url"
            class="h-12 rounded-[10px] border border-app-border bg-app-bg px-3.5 text-[15px] tracking-[-0.1px] outline-none transition-colors placeholder:text-app-muted focus:border-app-accent"
            placeholder="https://hermes.example.com"
            autocomplete="url"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-[13px] font-medium tracking-[0.3px] text-app-muted">Username</label>
          <input
            v-model="user"
            type="text"
            class="h-12 rounded-[10px] border border-app-border bg-app-bg px-3.5 text-[15px] tracking-[-0.1px] outline-none transition-colors placeholder:text-app-muted focus:border-app-accent"
            placeholder="Username"
            autocomplete="username"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-[13px] font-medium tracking-[0.3px] text-app-muted">Password</label>
          <div class="relative">
            <input
              v-model="pass"
              :type="showPass ? 'text' : 'password'"
              class="h-12 w-full rounded-[10px] border border-app-border bg-app-bg px-3.5 pr-12 text-[15px] tracking-[-0.1px] outline-none transition-colors placeholder:text-app-muted focus:border-app-accent"
              placeholder="Password"
              autocomplete="current-password"
            />
            <button
              type="button"
              class="absolute right-2 top-1/2 p-1 text-base leading-none -translate-y-1/2 cursor-pointer"
              @click="showPass = !showPass"
              tabindex="-1"
            >
              {{ showPass ? '🙈' : '👁' }}
            </button>
          </div>
        </div>

        <div v-if="error" class="rounded-[10px] border border-app-error/20 bg-app-error/10 px-3.5 py-2.5">
          <span class="whitespace-pre-line text-[13px] leading-5 tracking-[-0.1px] text-app-error">{{ error }}</span>
        </div>

        <button
          type="submit"
          class="mt-2 flex h-12 items-center justify-center rounded-[10px] bg-app-accent text-[15px] font-semibold tracking-[-0.2px] text-white transition-opacity hover:not-disabled:opacity-90 active:not-disabled:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!canConnect"
        >
          <span v-if="loading" class="size-[18px] animate-spin rounded-full border-2 border-white/30 border-t-white" />
          <span v-else>Connect</span>
        </button>
      </form>
    </div>
  </div>
</template>
