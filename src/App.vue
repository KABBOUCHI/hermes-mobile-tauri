<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Store } from '@tauri-apps/plugin-store'

const greetMsg = ref('')
const name = ref('')
const store = ref<Store | null>(null)
const counter = ref(0)

async function greet() {
  // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
  // @ts-expect-error invoke is injected by tauri
  greetMsg.value = await window.__TAURI__.core.invoke('greet', { name: name.value })
}

onMounted(async () => {
  store.value = await Store.load('settings.json')
  const saved = await store.value.get<number>('counter')
  if (saved !== null) counter.value = saved
})

async function increment() {
  counter.value++
  await store.value?.set('counter', counter.value)
  await store.value?.save()
}
</script>

<template>
  <main class="container">
    <h1>Hermes Mobile</h1>
    <p class="subtitle">Tauri + Vue</p>

    <div class="card">
      <button class="counter-btn" @click="increment">
        Count: {{ counter }}
      </button>
      <p class="counter-hint">Persisted via Tauri Store</p>
    </div>

    <div class="card">
      <input id="greet-input" v-model="name" placeholder="Enter a name..." />
      <button class="greet-btn" @click="greet">Greet</button>
      <p v-if="greetMsg">{{ greetMsg }}</p>
    </div>
  </main>
</template>

<style>
:root {
  --bg: #010102;
  --surface: #0d0d0f;
  --surface-2: #16161a;
  --accent: #5e6ad2;
  --text: #e8e8ec;
  --text-muted: #6b6b76;
  --border: #232328;
  --radius: 12px;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  -webkit-font-smoothing: antialiased;
}

.container {
  max-width: 420px;
  margin: 0 auto;
  padding: 48px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  min-height: 100vh;
  justify-content: center;
}

h1 {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.03em;
}

.subtitle {
  color: var(--text-muted);
  font-size: 14px;
  letter-spacing: -0.01em;
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
}

input {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  padding: 10px 14px;
  font-size: 14px;
  width: 100%;
  outline: none;
  transition: border-color 0.15s;
}

input:focus {
  border-color: var(--accent);
}

.greet-btn,
.counter-btn {
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 8px;
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  letter-spacing: -0.01em;
  transition: opacity 0.15s;
  width: 100%;
}

.greet-btn:hover,
.counter-btn:hover {
  opacity: 0.9;
}

.counter-btn {
  background: var(--surface-2);
  border: 1px solid var(--border);
  font-size: 16px;
}

.counter-hint {
  color: var(--text-muted);
  font-size: 12px;
}

p {
  font-size: 14px;
  color: var(--accent);
}
</style>
