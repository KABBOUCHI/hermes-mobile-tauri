<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{ patch: string }>()

const host = ref<HTMLElement>()
let instances: Array<{ cleanUp: () => void }> = []

async function renderPatch() {
  await nextTick()
  if (!host.value) return

  for (const instance of instances) instance.cleanUp()
  instances = []
  host.value.replaceChildren()

  try {
    const { FileDiff, parsePatchFiles } = await import('@pierre/diffs')
    const files = parsePatchFiles(props.patch).flatMap(patch => patch.files)

    for (const fileDiff of files) {
      const container = document.createElement('div')
      host.value.append(container)
      const instance = new FileDiff({ theme: 'pierre-dark' })
      instance.render({ containerWrapper: container, fileDiff })
      instances.push(instance)
    }
  } catch {
    // Invalid historical output remains available through the parent tool disclosure.
  }
}

watch(() => props.patch, () => { void renderPatch() }, { immediate: true })
onBeforeUnmount(() => {
  for (const instance of instances) instance.cleanUp()
})
</script>

<template>
  <div ref="host" class="patch-diff" aria-label="Diff view" />
</template>

<style scoped>
.patch-diff {
  max-height: 300px;
  overflow: auto;
  overscroll-behavior: contain;
}
</style>
