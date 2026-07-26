<script setup lang="ts">
import { ref, computed } from 'vue'

const emit = defineEmits<{
  (e: 'connect', url: string, user: string, pass: string): void
}>()

const props = defineProps<{
  loading: boolean
  error: string
}>()

const url = ref('https://hermes.kabbouchi.cloud')
const user = ref('admin')
const pass = ref('')
const showPass = ref(false)

const canConnect = computed(() => url.value.trim() && user.value.trim() && pass.value && !props.loading)

function handleConnect() {
  if (!canConnect.value) return
  emit('connect', url.value.trim(), user.value, pass.value)
}
</script>

<template>
  <div class="ConnectView">
    <div class="ConnectCard">
      <!-- Header -->
      <div class="Header">
        <div class="IconWrap">
          <span class="Icon">☤</span>
        </div>
        <h1 class="Title">Hermes</h1>
        <span class="Subtitle">Remote Gateway</span>
      </div>

      <!-- Form -->
      <form class="Form" @submit.prevent="handleConnect">
        <div class="Field">
          <label class="Label">Gateway URL</label>
          <input
            v-model="url"
            type="url"
            class="Input"
            placeholder="https://hermes.example.com"
            autocomplete="url"
          />
        </div>

        <div class="Field">
          <label class="Label">Username</label>
          <input
            v-model="user"
            type="text"
            class="Input"
            placeholder="Username"
            autocomplete="username"
          />
        </div>

        <div class="Field">
          <label class="Label">Password</label>
          <div class="PassWrap">
            <input
              v-model="pass"
              :type="showPass ? 'text' : 'password'"
              class="Input"
              placeholder="Password"
              autocomplete="current-password"
            />
            <button
              type="button"
              class="EyeBtn"
              @click="showPass = !showPass"
              tabindex="-1"
            >
              {{ showPass ? '🙈' : '👁' }}
            </button>
          </div>
        </div>

        <div v-if="error" class="ErrorBox">
          <span class="ErrorText">{{ error }}</span>
        </div>

        <button
          type="submit"
          class="Button"
          :class="{ 'Button--disabled': !canConnect }"
          :disabled="!canConnect"
        >
          <span v-if="loading" class="Spinner" />
          <span v-else>Connect</span>
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.ConnectView {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: 400px;
  padding: 24px;
  padding-top: 40px;
  margin: 0 auto;
  min-height: 100vh;
}

.ConnectCard {
  width: 100%;
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 32px 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.Header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.IconWrap {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: rgba(94, 106, 210, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(94, 106, 210, 0.2);
}

.Icon {
  font-size: 24px;
  color: var(--accent);
}

.Title {
  font-size: 28px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.03em;
}

.Subtitle {
  font-size: 14px;
  color: var(--text-muted);
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.Form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.Field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.Label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
  letter-spacing: 0.3px;
}

.Input {
  height: 48px;
  background-color: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0 14px;
  color: var(--text);
  font-size: 15px;
  letter-spacing: -0.1px;
  outline: none;
  transition: border-color 0.15s;
}

.Input:focus {
  border-color: var(--accent);
}

.Input::placeholder {
  color: var(--text-muted);
}

.PassWrap {
  position: relative;
}

.PassWrap .Input {
  width: 100%;
  padding-right: 48px;
}

.EyeBtn {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  padding: 4px;
  line-height: 1;
}

.ErrorBox {
  background-color: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 10px;
  padding: 10px 14px;
}

.ErrorText {
  font-size: 13px;
  color: var(--error);
  letter-spacing: -0.1px;
  white-space: pre-line;
  line-height: 1.5;
}

.Button {
  height: 48px;
  background-color: var(--accent);
  border: none;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 8px;
  cursor: pointer;
  transition: opacity 0.15s;
  font-size: 15px;
  font-weight: 600;
  color: #ffffff;
  letter-spacing: -0.2px;
}

.Button:hover:not(:disabled) { opacity: 0.9; }
.Button:active:not(:disabled) { transform: scale(0.98); }
.Button--disabled { opacity: 0.5; cursor: not-allowed; }

.Spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>
