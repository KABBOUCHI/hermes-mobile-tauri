<script setup lang="ts">
import { ref, onMounted } from 'vue'

import { fetch } from '@tauri-apps/plugin-http'
import { AlarmClock, Pause, Play, RefreshCw, Zap } from '@lucide/vue'
import { useAuth } from '../composables/useAuth'
import { cronActionUrl, type CronAction } from '../utils/cronActions'

const auth = useAuth()

interface CronJob {
  id: string
  name: string
  schedule: { kind: string; display: string }
  prompt: string
  enabled: boolean
  last_run_at: string | null
  next_run_at: string | null
  created_at: string
  last_status: string | null
  is_running?: boolean
  latest_execution?: { status: string }
}

const jobs = ref<CronJob[]>([])
const loading = ref(true)
const error = ref('')
const pendingActions = ref<Record<string, CronAction | undefined>>({})
const actionErrors = ref<Record<string, string | undefined>>({})

function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

async function fetchJobs() {
  loading.value = true
  error.value = ''
  try {
    const base = auth.gatewayUrl.value.replace(/\/$/, '')
    const headers: Record<string, string> = {}
    if (auth.sessionCookie.value) headers['Cookie'] = auth.sessionCookie.value
    const resp = await fetchWithTimeout(
      `${base}/api/cron/jobs?profile=all`,
      { method: 'GET', headers, credentials: 'same-origin' },
      10000
    )
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    const data = await resp.json()
    jobs.value = Array.isArray(data) ? data : (data.jobs || [])
  } catch (err: any) {
    error.value = err.message || 'Failed to load cron jobs'
  } finally {
    loading.value = false
  }
}

function actionPending(jobId: string, action: CronAction): boolean {
  return pendingActions.value[jobId] === action
}

async function runJobAction(job: CronJob, action: CronAction) {
  if (pendingActions.value[job.id]) return

  pendingActions.value = { ...pendingActions.value, [job.id]: action }
  actionErrors.value = { ...actionErrors.value, [job.id]: undefined }
  try {
    const headers: Record<string, string> = {}
    if (auth.sessionCookie.value) headers['Cookie'] = auth.sessionCookie.value
    const resp = await fetchWithTimeout(
      cronActionUrl(auth.gatewayUrl.value, job.id, action),
      { method: 'POST', headers, credentials: 'same-origin' },
      10000,
    )
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    await fetchJobs()
  } catch (err: any) {
    actionErrors.value = { ...actionErrors.value, [job.id]: err.message || `Failed to ${action} job` }
  } finally {
    pendingActions.value = { ...pendingActions.value, [job.id]: undefined }
  }
}

function relativeTime(ts: number | null): string {
  if (!ts) return 'never'
  const now = Date.now() / 1000
  const diff = now - ts
  if (diff < 0) {
    const abs = Math.abs(diff)
    if (abs < 60) return 'in ' + Math.floor(abs) + 's'
    if (abs < 3600) return 'in ' + Math.floor(abs / 60) + 'm'
    if (abs < 86400) return 'in ' + Math.floor(abs / 3600) + 'h'
    return 'in ' + Math.floor(abs / 86400) + 'd'
  }
  if (diff < 60) return 'just now'
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'
  return Math.floor(diff / 86400) + 'd ago'
}

function truncate(text: string, max: number): string {
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '…' : text
}

onMounted(fetchJobs)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col bg-app-bg font-sans text-app-text flex min-h-0 flex-1 flex-col bg-app-bg text-app-text font-sans">
    <!-- Header -->
    <div class="flex h-[68px] shrink-0 items-center justify-between border-b border-app-border px-4">
      <div>
        <span class="text-[17px] font-semibold tracking-[-0.03em]">Cron jobs</span>
        <div class="mt-0.5 text-[11px] text-app-muted">Automations and schedules</div>
      </div>
      <button class="flex size-9 cursor-pointer items-center justify-center rounded-lg border border-app-border bg-app-surface text-app-muted transition-colors hover:bg-app-surface-2" @click="fetchJobs" aria-label="Refresh cron jobs"><RefreshCw :size="16" :stroke-width="2" /></button>
    </div>

    <!-- Loading -->
    <div v-if="loading && jobs.length === 0" class="flex flex-1 flex-col items-center justify-center gap-3 p-10">
      <div class="size-7 animate-spin rounded-full border-2 border-app-border border-t-app-accent" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex flex-1 flex-col items-center justify-center gap-3 p-10">
      <span class="text-sm text-app-error">{{ error }}</span>
      <button class="h-10 cursor-pointer rounded-lg border-0 bg-app-accent px-6 text-[15px] font-semibold text-white transition-opacity hover:opacity-90" @click="fetchJobs">Retry</button>
    </div>

    <!-- Empty -->
    <div v-else-if="jobs.length === 0" class="flex flex-1 flex-col items-center justify-center gap-3 p-10">
      <AlarmClock :size="40" :stroke-width="1.6" class="text-app-muted" />
      <span class="text-[15px] text-app-muted">No cron jobs</span>
    </div>

    <!-- Jobs list -->
    <div v-else class="flex flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-4 py-3">
      <div v-for="job in jobs" :key="job.id" class="flex flex-col gap-1.5 rounded-app border border-app-border bg-app-surface px-4 py-3.5">
        <div class="flex items-center gap-2">
          <span class="flex-1 text-[15px] font-semibold tracking-[-0.02em]">{{ job.name || job.id }}</span>
          <span v-if="job.is_running" class="rounded px-1.5 py-px text-[11px] font-semibold uppercase tracking-[0.04em] text-app-accent bg-app-accent/10">running</span>
          <span v-else-if="job.enabled" class="size-2 shrink-0 rounded-full bg-app-success shadow-[0_0_6px_rgba(34,197,94,0.4)]" />
          <span v-else class="size-2 shrink-0 rounded-full bg-app-muted opacity-50" />
        </div>
        <span class="font-mono text-[13px] tracking-[0.02em] text-app-accent">{{ job.schedule?.display || job.schedule }}</span>
        <span v-if="job.prompt" class="text-[13px] leading-[1.4] text-app-muted">{{ truncate(job.prompt, 120) }}</span>
        <div class="mt-0.5 flex items-center gap-1.5">
          <span class="text-xs text-app-muted opacity-70">Last:</span>
          <span class="text-xs text-app-muted">{{ job.last_run_at ? relativeTime(new Date(job.last_run_at).getTime() / 1000) : 'never' }}</span>
          <span class="text-xs text-app-muted opacity-50">·</span>
          <span class="text-xs text-app-muted opacity-70">Next:</span>
          <span class="text-xs text-app-muted">{{ job.next_run_at ? relativeTime(new Date(job.next_run_at).getTime() / 1000) : '—' }}</span>
        </div>
        <div class="mt-2 flex items-center gap-2 border-t border-app-border pt-2.5">
          <button
            class="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-app-border bg-transparent px-2.5 text-xs font-medium text-app-muted transition-colors hover:border-app-accent hover:bg-app-accent/10 hover:text-app-accent disabled:cursor-default disabled:opacity-50"
            :disabled="!!pendingActions[job.id]"
            @click="runJobAction(job, job.enabled ? 'pause' : 'resume')"
          >
            <span v-if="actionPending(job.id, job.enabled ? 'pause' : 'resume')" class="size-3 animate-spin rounded-full border-2 border-app-border border-t-app-accent" />
            <Pause v-else-if="job.enabled" :size="14" :stroke-width="2" />
            <Play v-else :size="14" :stroke-width="2" />
            {{ job.enabled ? 'Pause' : 'Resume' }}
          </button>
          <button
            class="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-app-border bg-transparent px-2.5 text-xs font-medium text-app-muted transition-colors hover:border-app-accent hover:bg-app-accent/10 hover:text-app-accent disabled:cursor-default disabled:opacity-50"
            :disabled="!!pendingActions[job.id] || job.is_running"
            @click="runJobAction(job, 'trigger')"
          >
            <span v-if="actionPending(job.id, 'trigger')" class="size-3 animate-spin rounded-full border-2 border-app-border border-t-app-accent" />
            <Zap v-else :size="14" :stroke-width="2" />
            Trigger now
          </button>
          <span v-if="actionErrors[job.id]" class="min-w-0 truncate text-xs text-app-error">{{ actionErrors[job.id] }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
