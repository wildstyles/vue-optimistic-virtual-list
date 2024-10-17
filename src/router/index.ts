import { createRouter, createWebHistory } from 'vue-router'
import VirtualScrollView from '../views/VirtualScroll.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'virtual-scroll',
      component: VirtualScrollView,
    },
    {
      path: '/socket-optimisation',
      name: 'socket-optimisation',
      // route level code-splitting
      // this generates a separate chunk (About.[hash].js) for this route
      // which is lazy-loaded when the route is visited.
      component: () => import('../views/SocketOptimisation.vue'),
    },
  ],
})

export default router
