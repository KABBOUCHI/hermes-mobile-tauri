<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { fetch } from '@tauri-apps/plugin-http'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
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

function goBack() {
  router.push({ name: 'sessions' })
}

onMounted(fetchJobs)
</script>

<template>
  <div class="CronView">
    <!-- Header -->
    <div class="Header">
      <button class="BackBtn" @click="goBack">
        <span class="BackArrow">←</span>
        <span class="BackText">Back</span>
      </button>
      <span class="HeaderTitle">Cron Jobs</span>
      <button class="RefreshBtn" @click="fetchJobs">↻</button>
    </div>

    <!-- Loading -->
    <div v-if="loading && jobs.length === 0" class="StateView">
      <div class="Loader" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="StateView">
      <span class="ErrorText">{{ error }}</span>
      <button class="RetryBtn" @click="fetchJobs">Retry</button>
    </div>

    <!-- Empty -->
    <div v-else-if="jobs.length === 0" class="StateView">
      <span class="EmptyIcon">⏰</span>
      <span class="StateText">No cron jobs</span>
    </div>

    <!-- Jobs list -->
    <div v-else class="JobList">
      <div v-for="job in jobs" :key="job.id" class="JobCard">
        <div class="JobTop">
          <span class="JobName">{{ job.name || job.id }}</span>
          <span v-if="job.is_running" class="RunningBadge">running</span>
          <span v-else-if="job.enabled" class="StatusDot enabled" />
          <span v-else class="StatusDot disabled" />
        </div>
        <span class="JobSchedule">{{ job.schedule?.display || job.schedule }}</span>
        <span v-if="job.prompt" class="JobPrompt">{{ truncate(job.prompt, 120) }}</span>
        <div class="JobMeta">
          <span class="MetaLabel">Last:</span>
          <span class="MetaValue">{{ job.last_run_at ? relativeTime(new Date(job.last_run_at).getTime() / 1000) : 'never' }}</span>
          <span class="MetaDot">·</span>
          <span class="MetaLabel">Next:</span>
          <span class="MetaValue">{{ job.next_run_at ? relativeTime(new Date(job.next_run_at).getTime() / 1000) : '—' }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.CronView {
  background-color: var(--bg);
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100vh;
}

/* ── Header ── */
.Header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 16px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.BackBtn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--accent);
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  padding: 0;
}

.BackArrow { font-size: 18px; }

.HeaderTitle {
  font-size: 17px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.02em;
}

.RefreshBtn {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background-color: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s;
}

.RefreshBtn:hover { background-color: var(--surface-2); }

/* ── States ── */
.StateView {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 12px;
}

.Loader {
  width: 28px;
  height: 28px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.StateText { font-size: 15px; color: var(--text-muted); }
.EmptyIcon { font-size: 40px; }
.ErrorText { font-size: 14px; color: var(--error); }

.RetryBtn {
  height: 40px;
  padding: 0 24px;
  background-color: var(--accent);
  border: none;
  border-radius: 8px;
  color: #ffffff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}

.RetryBtn:hover { opacity: 0.9; }

@keyframes spin { to { transform: rotate(360deg); } }

/* ── Job list ── */
.JobList {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.JobCard {
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.JobTop {
  display: flex;
  align-items: center;
  gap: 8px;
}

.JobName {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  flex: 1;
  letter-spacing: -0.02em;
}

.RunningBadge {
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
  background-color: rgba(94, 106, 210, 0.12);
  border-radius: 4px;
  padding: 1px 6px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.StatusDot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.StatusDot.enabled {
  background-color: var(--success);
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.4);
}

.StatusDot.disabled {
  background-color: var(--text-muted);
  opacity: 0.5;
}

.JobSchedule {
  font-size: 13px;
  color: var(--accent);
  font-family: 'SF Mono', 'Fira Code', monospace;
  letter-spacing: 0.02em;
}

.JobPrompt {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.4;
}

.JobMeta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

.MetaLabel {
  font-size: 12px;
  color: var(--text-muted);
  opacity: 0.7;
}

.MetaValue {
  font-size: 12px;
  color: var(--text-muted);
}

.MetaDot {
  font-size: 12px;
  color: var(--text-muted);
  opacity: 0.5;
}
</style>
