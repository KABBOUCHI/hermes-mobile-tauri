import { createRouter, createWebHashHistory } from 'vue-router'
import ConnectView from './views/ConnectView.vue'
import SessionsView from './views/SessionsView.vue'
import MessageView from './views/MessageView.vue'
import CronView from './views/CronView.vue'
import SettingsView from './views/SettingsView.vue'
import { useAuth } from './composables/useAuth'

const routes = [
  { path: '/', name: 'connect', component: ConnectView },
  { path: '/sessions', name: 'sessions', component: SessionsView },
  { path: '/chat/:id?', name: 'chat', component: MessageView },
  { path: '/cron', name: 'cron', component: CronView },
  { path: '/settings', name: 'settings', component: SettingsView },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

// Redirect to connect if not authenticated
router.beforeEach((to) => {
  const auth = useAuth()
  // Saved-cookie validation is asynchronous. Keep the intended route mounted
  // behind the app shell until it settles, rather than flashing ConnectView.
  if (auth.isBooting.value) return true

  const publicRoutes = ['connect']
  if (!publicRoutes.includes(to.name as string) && !auth.isConnected.value) {
    return { name: 'connect' }
  }
})

export default router
