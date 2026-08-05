<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Bot, Check, Info, Palette, Power, RefreshCw, UserRound } from '@lucide/vue'
import appPackage from '../../package.json'
import { useAuth } from '../composables/useAuth'
import { useGateway, type GatewayProfile, type ModelProvider } from '../composables/useGateway'
import { usePreferences, type Appearance } from '../composables/usePreferences'
import { useToast } from '../composables/useToast'
import { gatewayStatusSummary, profileDisplayName } from '../utils/settings'

const router = useRouter()
const auth = useAuth()
const gw = useGateway()
const preferences = usePreferences()
const toast = useToast()

const host = computed(() => {
  try {
    return new URL(auth.gatewayUrl.value).host
  } catch {
    return auth.gatewayUrl.value || 'Not connected'
  }
})
const currentModel = ref('')
const currentProvider = ref('')
const modelProviders = ref<ModelProvider[]>([])
const profiles = ref<GatewayProfile[]>([])
const status = ref<Record<string, unknown>>({})
const loading = ref(false)
const reconnecting = ref(false)
const selectingModel = ref(false)
const selectingProfile = ref(false)
const clearingCachedData = ref(false)
const diagnosticsError = ref('')
const appearanceOptions: Appearance[] = ['system', 'dark', 'light']

const statusSummary = computed(() => gatewayStatusSummary(status.value))
const activeProfile = computed(() => profiles.value.find(profile => profile.is_default) || profiles.value[0])

function modelShort(model: string) {
  return gw.modelShort(model)
}

async function refresh() {
  loading.value = true
  diagnosticsError.value = ''
  try {
    const [nextStatus, models, nextProfiles] = await Promise.all([
      auth.fetchStatus(),
      gw.fetchModels(auth.gatewayUrl.value),
      gw.fetchProfiles(auth.gatewayUrl.value),
    ])
    status.value = nextStatus || {}
    currentModel.value = models.model || ''
    currentProvider.value = models.provider || ''
    modelProviders.value = models.providers
    profiles.value = nextProfiles
  } catch (err: any) {
    diagnosticsError.value = err.message || 'Unable to refresh gateway details'
  } finally {
    loading.value = false
  }
}

async function reconnect() {
  reconnecting.value = true
  diagnosticsError.value = ''
  try {
    await auth.fetchStatus()
    gw.disconnectWs()
    await gw.connectWs(auth.gatewayUrl.value, auth.sessionCookie.value, auth.fetchWsTicket)
    auth.isConnected.value = true
    await refresh()
    toast.show('Gateway reconnected', 'success')
  } catch (err: any) {
    auth.isConnected.value = false
    diagnosticsError.value = err.message || 'Unable to reconnect gateway'
  } finally {
    reconnecting.value = false
  }
}

async function setModel(provider: string, model: string) {
  if (!provider || !model || (provider === currentProvider.value && model === currentModel.value)) return
  selectingModel.value = true
  const ok = await gw.setModel(auth.gatewayUrl.value, provider, model)
  selectingModel.value = false
  if (!ok) {
    toast.show('Unable to update default model', 'error')
    return
  }
  currentProvider.value = provider
  currentModel.value = model
  toast.show('Default model updated', 'success')
}

function selectModel(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  const separator = value.indexOf(':')
  if (separator === -1) return
  void setModel(value.slice(0, separator), value.slice(separator + 1))
}

async function setProfile(event: Event) {
  const profile = (event.target as HTMLSelectElement).value
  if (!profile || profile === activeProfile.value?.name) return
  selectingProfile.value = true
  const ok = await gw.activateProfile(auth.gatewayUrl.value, profile)
  selectingProfile.value = false
  if (!ok) {
    toast.show('Unable to set gateway profile', 'error')
    return
  }
  profiles.value = profiles.value.map(item => ({ ...item, is_default: item.name === profile }))
  toast.show(`Gateway profile set to ${profile}`, 'success')
}

async function setAppearance(value: Appearance) {
  await preferences.setAppearance(value)
}

function clearOfflineData() {
  clearingCachedData.value = true
  try {
    gw.clearOfflineCache(auth.gatewayUrl.value)
    toast.show('Offline session cache cleared', 'success')
  } finally {
    clearingCachedData.value = false
  }
}

async function disconnect() {
  gw.disconnectWs()
  await auth.clearSession()
  router.replace({ name: 'connect' })
}

onMounted(async () => {
  await preferences.init()
  await refresh()
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto bg-app-bg px-4 py-5 font-sans text-app-text">
    <div class="mb-5">
      <h1 class="text-[20px] font-semibold tracking-[-0.03em]">Settings</h1>
      <p class="mt-1 text-[13px] text-app-muted">Connection and application preferences</p>
    </div>

    <div class="flex flex-col gap-4">
      <section class="overflow-hidden rounded-app border border-app-border bg-app-surface">
        <div class="flex items-center gap-3 px-4 py-3.5">
          <span class="size-2 shrink-0 rounded-full" :class="auth.isConnected.value ? 'bg-app-success shadow-[0_0_8px_rgba(34,197,94,0.45)]' : 'bg-app-error'" />
          <div class="min-w-0 flex-1">
            <div class="text-[13px] font-medium">Gateway connection</div>
            <div class="mt-0.5 truncate text-xs text-app-muted">{{ host }}</div>
          </div>
          <span class="text-[11px] font-medium" :class="auth.isConnected.value ? 'text-app-success' : 'text-app-error'">{{ auth.isConnected.value ? 'Connected' : 'Offline' }}</span>
        </div>
        <div class="grid grid-cols-2 border-t border-app-border text-xs">
          <div class="border-r border-app-border px-4 py-3"><div class="text-app-muted">Gateway</div><div class="mt-0.5 truncate font-medium">{{ statusSummary.mode }}</div></div>
          <div class="px-4 py-3"><div class="text-app-muted">Server version</div><div class="mt-0.5 truncate font-medium">{{ statusSummary.version }}</div></div>
        </div>
        <div v-if="diagnosticsError" class="border-t border-app-error/30 px-4 py-2.5 text-xs text-app-error">{{ diagnosticsError }}</div>
        <div class="grid grid-cols-2 gap-2 border-t border-app-border p-3">
          <button class="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-app-border bg-app-surface-2 text-[13px] font-medium text-app-text transition-colors hover:border-app-accent hover:text-app-accent disabled:cursor-wait disabled:opacity-60" :disabled="loading || reconnecting" @click="refresh"><RefreshCw :size="15" :stroke-width="1.8" :class="loading ? 'animate-spin' : ''" /> Refresh</button>
          <button class="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-app-border bg-app-surface-2 text-[13px] font-medium text-app-text transition-colors hover:border-app-accent hover:text-app-accent disabled:cursor-wait disabled:opacity-60" :disabled="reconnecting" @click="reconnect"><RefreshCw :size="15" :stroke-width="1.8" :class="reconnecting ? 'animate-spin' : ''" /> Reconnect</button>
        </div>
      </section>

      <section class="overflow-hidden rounded-app border border-app-border bg-app-surface">
        <div class="flex items-center gap-3 border-b border-app-border px-4 py-3"><Bot :size="16" :stroke-width="1.8" class="text-app-accent" /><div><div class="text-[13px] font-medium">Default AI model</div><div class="mt-0.5 text-xs text-app-muted">Used for new conversations</div></div></div>
        <div class="p-3">
          <select class="h-10 w-full cursor-pointer appearance-none rounded-md border border-app-border bg-app-surface-2 px-3 text-[13px] text-app-text outline-none focus:border-app-accent disabled:cursor-wait disabled:opacity-60" :disabled="selectingModel || modelProviders.length === 0" :value="`${currentProvider}:${currentModel}`" @change="selectModel">
            <option v-if="modelProviders.length === 0" value="">No models available</option>
            <optgroup v-for="provider in modelProviders" :key="provider.slug" :label="provider.name">
              <option v-for="model in provider.models" :key="model" :value="`${provider.slug}:${model}`">{{ modelShort(model) }}</option>
            </optgroup>
          </select>
        </div>
      </section>

      <section class="overflow-hidden rounded-app border border-app-border bg-app-surface">
        <div class="flex items-center gap-3 border-b border-app-border px-4 py-3"><UserRound :size="16" :stroke-width="1.8" class="text-app-accent" /><div><div class="text-[13px] font-medium">Gateway profile</div><div class="mt-0.5 text-xs text-app-muted">Sets the default for future gateway runs</div></div></div>
        <div class="p-3">
          <select class="h-10 w-full cursor-pointer appearance-none rounded-md border border-app-border bg-app-surface-2 px-3 text-[13px] text-app-text outline-none focus:border-app-accent disabled:cursor-wait disabled:opacity-60" :disabled="selectingProfile || profiles.length === 0" :value="activeProfile?.name" @change="setProfile">
            <option v-if="profiles.length === 0" value="">No profiles available</option>
            <option v-for="profile in profiles" :key="profile.name" :value="profile.name">{{ profileDisplayName(profile) }}{{ profile.model ? ` · ${modelShort(profile.model)}` : '' }}</option>
          </select>
        </div>
      </section>

      <section class="overflow-hidden rounded-app border border-app-border bg-app-surface">
        <div class="flex items-center gap-3 border-b border-app-border px-4 py-3"><Palette :size="16" :stroke-width="1.8" class="text-app-accent" /><div><div class="text-[13px] font-medium">Appearance</div><div class="mt-0.5 text-xs text-app-muted">Choose the app color scheme</div></div></div>
        <div class="grid grid-cols-3 gap-2 p-3">
          <button v-for="option in appearanceOptions" :key="option" class="flex h-9 cursor-pointer items-center justify-center rounded-md border text-[12px] font-medium capitalize transition-colors" :class="preferences.appearance.value === option ? 'border-app-accent bg-app-accent/15 text-app-accent' : 'border-app-border bg-app-surface-2 text-app-muted hover:text-app-text'" @click="setAppearance(option)"><Check v-if="preferences.appearance.value === option" :size="14" :stroke-width="2" class="mr-1" />{{ option }}</button>
        </div>
      </section>

      <section class="overflow-hidden rounded-app border border-app-border bg-app-surface">
        <div class="flex items-center gap-3 border-b border-app-border px-4 py-3"><Info :size="16" :stroke-width="1.8" class="text-app-accent" /><div><div class="text-[13px] font-medium">Offline data</div><div class="mt-0.5 text-xs text-app-muted">Cached sessions and transcripts stay on this device for seven days</div></div></div>
        <div class="p-3"><button class="h-9 w-full cursor-pointer rounded-md border border-app-border bg-app-surface-2 text-[13px] font-medium text-app-text transition-colors hover:border-app-accent hover:text-app-accent disabled:cursor-wait disabled:opacity-60" :disabled="clearingCachedData" @click="clearOfflineData">{{ clearingCachedData ? 'Clearing…' : 'Clear offline cache' }}</button></div>
      </section>

      <section class="overflow-hidden rounded-app border border-app-border bg-app-surface">
        <div class="flex items-center gap-3 px-4 py-3"><Info :size="16" :stroke-width="1.8" class="text-app-accent" /><div class="min-w-0 flex-1"><div class="text-[13px] font-medium">About Hermes</div><div class="mt-0.5 text-xs text-app-muted">Mobile gateway client</div></div><span class="text-xs font-medium text-app-muted">v{{ appPackage.version }}</span></div>
      </section>

      <button class="mb-2 flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-app-error/30 bg-transparent text-[13px] font-medium text-app-error transition-colors hover:bg-app-error/10" @click="disconnect"><Power :size="15" :stroke-width="1.8" /> Disconnect gateway</button>
    </div>
  </div>
</template>
