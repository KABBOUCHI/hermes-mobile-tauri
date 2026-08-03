<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Check, Folder, FolderKanban, Plus, RefreshCw, Send, X } from '@lucide/vue'
import { useGateway } from '../composables/useGateway'
import { useToast } from '../composables/useToast'
import { projectPrimaryPath, type Project } from '../utils/projects'

const router = useRouter()
const gw = useGateway()
const toast = useToast()

const loading = ref(false)
const loadError = ref('')
const createOpen = ref(false)
const projectName = ref('')
const primaryPath = ref('')
const creating = ref(false)
const activeProjectAction = ref('')

const visibleProjects = computed(() => gw.projects.value.filter(project => !project.archived))
const archivedCount = computed(() => gw.projects.value.length - visibleProjects.value.length)

function folderCount(project: Project): string {
  const count = project.folders.length
  return `${count} folder${count === 1 ? '' : 's'}`
}

async function refresh() {
  loading.value = true
  loadError.value = ''
  try {
    await gw.fetchProjects()
    if (!gw.projects.value.length && gw.error.value) loadError.value = gw.error.value
  } finally {
    loading.value = false
  }
}

async function activateProject(project: Project): Promise<boolean> {
  if (activeProjectAction.value) return false
  activeProjectAction.value = project.id
  const ok = await gw.setActiveProject(project.id)
  activeProjectAction.value = ''
  if (!ok) {
    toast.show(gw.error.value || 'Unable to set active project', 'error')
    return false
  }
  toast.show(`${project.name} is now active`, 'success')
  return true
}

async function startProjectChat(project: Project) {
  const cwd = projectPrimaryPath(project)
  if (!cwd) {
    toast.show('This project needs a primary folder before starting a chat', 'error')
    return
  }
  if (!await activateProject(project)) return
  await router.push({ name: 'chat', query: { cwd } })
}

async function createProject() {
  const name = projectName.value.trim()
  const path = primaryPath.value.trim()
  if (!name || !path || creating.value) return

  creating.value = true
  const project = await gw.createProject(name, path)
  creating.value = false
  if (!project) {
    toast.show(gw.error.value || 'Unable to create project', 'error')
    return
  }

  projectName.value = ''
  primaryPath.value = ''
  createOpen.value = false
  toast.show(`${project.name} created`, 'success')
}

onMounted(() => { void refresh() })
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto bg-app-bg px-4 py-5 font-sans text-app-text">
    <div class="mb-5 flex items-start justify-between gap-3">
      <div>
        <h1 class="text-[20px] font-semibold tracking-[-0.03em]">Projects</h1>
        <p class="mt-1 text-[13px] text-app-muted">Choose the workspace for your next chat</p>
      </div>
      <button class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-app-border bg-app-surface-2 text-app-muted transition-colors hover:border-app-accent hover:text-app-accent disabled:cursor-wait disabled:opacity-60" :disabled="loading" aria-label="Refresh projects" @click="refresh">
        <RefreshCw :size="16" :stroke-width="1.8" :class="loading ? 'animate-spin' : ''" />
      </button>
    </div>

    <section class="mb-4 overflow-hidden rounded-app border border-app-border bg-app-surface">
      <button class="flex w-full cursor-pointer items-center justify-between gap-3 border-0 bg-transparent px-4 py-3.5 text-left" @click="createOpen = !createOpen">
        <span class="flex min-w-0 items-center gap-3"><span class="grid size-8 shrink-0 place-items-center rounded-md bg-app-accent/15 text-app-accent"><Plus :size="17" :stroke-width="2" /></span><span><span class="block text-[13px] font-medium">New project</span><span class="mt-0.5 block text-xs text-app-muted">Name a workspace and choose its primary folder</span></span></span>
        <X v-if="createOpen" :size="16" :stroke-width="1.8" class="shrink-0 text-app-muted" />
        <Plus v-else :size="16" :stroke-width="1.8" class="shrink-0 text-app-muted" />
      </button>
      <form v-if="createOpen" class="flex flex-col gap-3 border-t border-app-border p-3" @submit.prevent="createProject">
        <label class="flex flex-col gap-1.5"><span class="text-xs font-medium text-app-muted">Project name</span><input v-model="projectName" class="h-10 w-full rounded-md border border-app-border bg-app-surface-2 px-3 text-[13px] text-app-text outline-none placeholder:text-app-muted focus:border-app-accent" placeholder="Hermes Mobile" autocomplete="off" /></label>
        <label class="flex flex-col gap-1.5"><span class="text-xs font-medium text-app-muted">Primary folder</span><input v-model="primaryPath" class="h-10 w-full rounded-md border border-app-border bg-app-surface-2 px-3 font-mono text-[12px] text-app-text outline-none placeholder:text-app-muted focus:border-app-accent" placeholder="/home/hermes/project" autocomplete="off" /></label>
        <div class="flex justify-end gap-2"><button type="button" class="h-9 cursor-pointer rounded-md border border-app-border bg-transparent px-3 text-[12px] font-medium text-app-muted transition-colors hover:text-app-text" @click="createOpen = false">Cancel</button><button type="submit" class="flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-app-accent px-3 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60" :disabled="!projectName.trim() || !primaryPath.trim() || creating"><RefreshCw v-if="creating" :size="14" class="animate-spin" /><Plus v-else :size="14" :stroke-width="2" />{{ creating ? 'Creating…' : 'Create project' }}</button></div>
      </form>
    </section>

    <div v-if="loadError" class="mb-4 rounded-app border border-app-error/30 bg-app-error/10 px-3 py-2.5 text-xs text-app-error">{{ loadError }}</div>

    <div v-if="loading && visibleProjects.length === 0" class="flex flex-1 items-center justify-center py-16 text-[13px] text-app-muted"><RefreshCw :size="16" class="mr-2 animate-spin" /> Loading projects…</div>
    <div v-else-if="visibleProjects.length === 0" class="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center"><span class="mb-3 grid size-11 place-items-center rounded-lg border border-app-border bg-app-surface text-app-muted"><FolderKanban :size="22" :stroke-width="1.6" /></span><h2 class="text-[14px] font-medium">No projects yet</h2><p class="mt-1 max-w-[260px] text-[12px] leading-5 text-app-muted">Create a named workspace to keep new chats anchored to the right repository.</p></div>

    <div v-else class="flex flex-col gap-3 pb-2">
      <article v-for="project in visibleProjects" :key="project.id" class="overflow-hidden rounded-app border border-app-border bg-app-surface">
        <div class="flex items-start gap-3 px-4 pt-4 pb-3">
          <span class="grid size-8 shrink-0 place-items-center rounded-md bg-app-surface-2" :class="gw.activeProjectId.value === project.id ? 'text-app-accent' : 'text-app-muted'"><FolderKanban :size="17" :stroke-width="1.8" /></span>
          <div class="min-w-0 flex-1"><div class="flex items-center gap-2"><h2 class="truncate text-[14px] font-medium">{{ project.name }}</h2><span v-if="gw.activeProjectId.value === project.id" class="inline-flex shrink-0 items-center gap-1 rounded-full bg-app-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-app-accent"><Check :size="11" :stroke-width="2.4" /> Active</span></div><p v-if="project.description" class="mt-1 text-[12px] leading-4 text-app-muted">{{ project.description }}</p><div class="mt-2 flex items-center gap-1.5 text-[11px] text-app-muted"><Folder :size="13" :stroke-width="1.8" /><span>{{ folderCount(project) }}</span></div></div>
        </div>
        <div v-if="projectPrimaryPath(project)" class="mx-4 mb-3 truncate rounded-md border border-app-border bg-app-surface-2 px-2.5 py-2 font-mono text-[11px] text-app-muted">{{ projectPrimaryPath(project) }}</div>
        <div class="grid grid-cols-2 gap-2 border-t border-app-border p-3"><button class="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border text-[12px] font-medium transition-colors disabled:cursor-wait disabled:opacity-60" :class="gw.activeProjectId.value === project.id ? 'border-app-accent/30 bg-app-accent/10 text-app-accent' : 'border-app-border bg-app-surface-2 text-app-text hover:border-app-accent hover:text-app-accent'" :disabled="Boolean(activeProjectAction) || gw.activeProjectId.value === project.id" @click="activateProject(project)"><Check :size="14" :stroke-width="2" />{{ gw.activeProjectId.value === project.id ? 'Active project' : 'Use project' }}</button><button class="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-app-accent text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60" :disabled="Boolean(activeProjectAction) || !projectPrimaryPath(project)" @click="startProjectChat(project)"><Send :size="14" :stroke-width="2" />New chat</button></div>
      </article>
    </div>

    <p v-if="archivedCount > 0" class="mt-4 text-center text-[11px] text-app-muted">{{ archivedCount }} archived project{{ archivedCount === 1 ? '' : 's' }} hidden</p>
  </div>
</template>
