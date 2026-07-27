import { createRouter, createWebHashHistory } from 'vue-router'
import ConnectView from './views/ConnectView.vue'
import SessionsView from './views/SessionsView.vue'
import MessageView from './views/MessageView.vue'
import CronView from './views/CronView.vue'

const routes = [
  { path: '/', name: 'connect', component: ConnectView },
  { path: '/sessions', name: 'sessions', component: SessionsView },
  { path: '/chat/:id?', name: 'chat', component: MessageView },
  { path: '/cron', name: 'cron', component: CronView },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
